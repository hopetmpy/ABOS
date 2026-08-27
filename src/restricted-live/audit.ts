import fs from "node:fs";
import path from "node:path";
import { initializeLiveRoot, LIVE_PATHS } from "./mode.js";

const SECRET_KEYS = /private|secret|seed|signature|api.?key|authorization/i;

function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, SECRET_KEYS.test(k) ? "[REDACTED]" : sanitize(v)]));
  return value;
}

export class RestrictedLiveAudit {
  private readonly file: string;
  constructor(file = path.join(LIVE_PATHS.logs, "audit.jsonl")) { initializeLiveRoot(); this.file = file; }
  record(event: string, metadata: Record<string, unknown> = {}): void {
    const safeMetadata = sanitize(metadata) as Record<string, unknown>;
    fs.appendFileSync(this.file, `${JSON.stringify({ ...safeMetadata, timestamp: new Date().toISOString(), mode: "restricted-live", event })}\n`, { encoding: "utf8", mode: 0o600 });
  }
}
