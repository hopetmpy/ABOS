/**
 * Dashboard HTTP Server
 *
 * Lightweight HTTP server that serves the sales/marketing dashboard.
 * Reads from the same SQLite database the agent uses.
 * No external dependencies beyond Node.js built-ins and better-sqlite3.
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type BetterSqlite3 from "better-sqlite3";
import { handleApiRequest } from "./routes/api.js";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("dashboard");

// ─── Rate Limiting ──────────────────────────────────────────────────
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 120; // per window per IP

interface RateBucket {
  count: number;
  resetAt: number;
}

const rateBuckets = new Map<string, RateBucket>();

function getRateLimitKey(req: http.IncomingMessage): string {
  // Use X-Forwarded-For if behind a proxy, otherwise remoteAddress
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) return (Array.isArray(forwarded) ? forwarded[0] : forwarded.split(",")[0]).trim();
  return req.socket.remoteAddress || "unknown";
}

function isRateLimited(req: http.IncomingMessage): boolean {
  const key = getRateLimitKey(req);
  const now = Date.now();
  const bucket = rateBuckets.get(key);

  if (!bucket || now >= bucket.resetAt) {
    rateBuckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }

  bucket.count++;
  return bucket.count > RATE_LIMIT_MAX_REQUESTS;
}

function setRateLimitHeaders(res: http.ServerResponse, req: http.IncomingMessage): void {
  const key = getRateLimitKey(req);
  const bucket = rateBuckets.get(key);
  if (bucket) {
    const remaining = Math.max(0, RATE_LIMIT_MAX_REQUESTS - bucket.count);
    res.setHeader("X-RateLimit-Limit", RATE_LIMIT_MAX_REQUESTS);
    res.setHeader("X-RateLimit-Remaining", remaining);
    res.setHeader("X-RateLimit-Reset", Math.ceil(bucket.resetAt / 1000));
  }
}

// Clean up stale buckets every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of rateBuckets) {
    if (now >= bucket.resetAt) rateBuckets.delete(key);
  }
}, 300_000).unref();

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

let server: http.Server | null = null;

function getStaticDir(): string {
  // In production (dist/), static files are alongside the compiled JS
  // In dev (src/), they're in src/dashboard/static/
  const thisFile = fileURLToPath(import.meta.url);
  const thisDir = path.dirname(thisFile);

  // Check dist location first (compiled output)
  const distStatic = path.join(thisDir, "static");
  if (fs.existsSync(distStatic)) return distStatic;

  // Fallback to src location (development)
  const srcStatic = path.join(process.cwd(), "src", "dashboard", "static");
  if (fs.existsSync(srcStatic)) return srcStatic;

  return distStatic; // default
}

function serveStatic(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  staticDir: string,
): boolean {
  let urlPath = req.url || "/";

  // Strip query strings
  const qIndex = urlPath.indexOf("?");
  if (qIndex !== -1) urlPath = urlPath.slice(0, qIndex);

  // Default to index.html for SPA routing
  if (urlPath === "/" || urlPath === "") urlPath = "/index.html";

  // Prevent directory traversal
  const safePath = path.normalize(urlPath).replace(/^(\.\.(\/|\\|$))+/, "");
  const filePath = path.join(staticDir, safePath);

  // Ensure we're still within the static directory
  if (!filePath.startsWith(staticDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return true;
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    return false;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";

  const content = fs.readFileSync(filePath);
  res.writeHead(200, {
    "Content-Type": contentType,
    "Cache-Control": "no-cache",
  });
  res.end(content);
  return true;
}

/**
 * Start the dashboard server.
 */
export function startDashboard(db: BetterSqlite3.Database, port = 3141): Promise<http.Server> {
  const staticDir = getStaticDir();

  return new Promise((resolve, reject) => {
    server = http.createServer(async (req, res) => {
      // CORS headers
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      // Rate limiting (API routes only — static files are not limited)
      const url = req.url || "/";
      if (url.startsWith("/api/") && isRateLimited(req)) {
        setRateLimitHeaders(res, req);
        res.writeHead(429, { "Content-Type": "application/json", "Retry-After": "60" });
        res.end(JSON.stringify({ error: "Too many requests. Try again later.", status: 429 }));
        return;
      }
      if (url.startsWith("/api/")) setRateLimitHeaders(res, req);

      try {
        // Unsubscribe page (public, no auth)
        if (url.startsWith("/unsubscribe")) {
          const qs = new URL(url, "http://localhost").searchParams;
          const email = qs.get("email") || "";
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribe</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#f5f5f5;color:#333}
.card{background:#fff;border-radius:12px;padding:40px;max-width:420px;box-shadow:0 2px 12px rgba(0,0,0,.08);text-align:center}
h1{font-size:22px;margin:0 0 8px}p{color:#666;line-height:1.5}
input[type=email]{width:100%;padding:10px 12px;border:1px solid #ddd;border-radius:6px;font-size:15px;margin:12px 0;box-sizing:border-box}
button{background:#6366f1;color:#fff;border:none;padding:12px 24px;border-radius:6px;font-size:15px;cursor:pointer;width:100%}
button:hover{background:#4f46e5}.success{color:#059669;font-weight:600}.gdpr{margin-top:16px;font-size:13px}
.gdpr a{color:#6366f1;cursor:pointer;text-decoration:underline}</style></head>
<body><div class="card"><h1>Unsubscribe</h1><p>We're sorry to see you go. Enter your email to unsubscribe from all future messages.</p>
<form id="f"><input type="email" id="email" required placeholder="your@email.com" value="${email.replace(/"/g, "&quot;")}">
<button type="submit">Unsubscribe</button></form><div id="msg"></div>
<div class="gdpr">Want all your data deleted? <a onclick="gdprDelete()">Request GDPR deletion</a></div>
<script>
document.getElementById('f').onsubmit=async e=>{e.preventDefault();const em=document.getElementById('email').value;
const r=await fetch('/api/unsubscribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:em})});
const d=await r.json();document.getElementById('msg').innerHTML='<p class=\"success\">'+d.message+'</p>';document.getElementById('f').style.display='none'};
async function gdprDelete(){const em=document.getElementById('email').value;if(!em){alert('Enter email first');return}
if(!confirm('This will permanently delete ALL your data. Continue?'))return;
const r=await fetch('/api/gdpr/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:em})});
const d=await r.json();document.getElementById('msg').innerHTML='<p class=\"success\">'+d.message+'</p>';document.getElementById('f').style.display='none'}
</script></div></body></html>`);
          return;
        }

        // API routes
        if (url.startsWith("/api/")) {
          await handleApiRequest(req, res, db);
          return;
        }

        // Static files
        if (serveStatic(req, res, staticDir)) return;

        // SPA fallback — serve index.html for any unmatched route
        const indexPath = path.join(staticDir, "index.html");
        if (fs.existsSync(indexPath)) {
          const content = fs.readFileSync(indexPath);
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(content);
          return;
        }

        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not found", status: 404 }));
      } catch (err: any) {
        logger.error("Dashboard request error", err);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal server error", status: 500 }));
      }
    });

    server.on("error", (err) => {
      logger.error("Dashboard server error", err);
      reject(err);
    });

    server.listen(port, () => {
      logger.info(`Dashboard running at http://localhost:${port}`);
      resolve(server!);
    });
  });
}

/**
 * Stop the dashboard server.
 */
export function stopDashboard(): Promise<void> {
  return new Promise((resolve) => {
    if (server) {
      server.close(() => {
        server = null;
        resolve();
      });
    } else {
      resolve();
    }
  });
}
