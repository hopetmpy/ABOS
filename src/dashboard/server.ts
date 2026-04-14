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

      const url = req.url || "/";

      try {
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
