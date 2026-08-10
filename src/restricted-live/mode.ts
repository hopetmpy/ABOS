import fs from "node:fs";
import path from "node:path";
import { REPOSITORY_ROOT } from "../safety/safe-mode.js";

function flag(name: string): boolean {
  const value = process.env[name];
  if (value === undefined) return false;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be exactly "true" or "false" when set`);
}

export const RESTRICTED_LIVE_MODE = flag("AUTOMATON_RESTRICTED_LIVE");
export const LIVE_DRY_RUN = flag("AUTOMATON_LIVE_DRY_RUN");

export const LIVE_ROOT = path.join(REPOSITORY_ROOT, ".automaton-live");
export const LIVE_PATHS = Object.freeze({
  root: LIVE_ROOT,
  state: path.join(LIVE_ROOT, "state"),
  wallet: path.join(LIVE_ROOT, "wallet"),
  logs: path.join(LIVE_ROOT, "logs"),
  workspace: path.join(LIVE_ROOT, "workspace"),
});

export const RESTRICTED_LIVE_LIMITS = Object.freeze({
  maxWalletFundingExpectedUsdc: 5,
  maxSingleX402PaymentUsdc: 0.10,
  maxHourlySpendUsdc: 0.25,
  maxDailySpendUsdc: 0.50,
  minimumWalletReserveUsdc: 4,
});

export const BASE_CHAIN_ID = 8453;
export const BASE_USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

// Exact origins only. Paths and payment recipients are further constrained by
// the payment adapter; subdomains and lookalike suffixes never match.
export const RESTRICTED_LIVE_ALLOWLIST = Object.freeze({
  conwayOrigins: Object.freeze([
    "https://api.conway.tech",
    "https://inference.conway.tech",
  ]),
  x402Origins: Object.freeze(["https://www.x402scan.com"]),
  x402Urls: Object.freeze(["https://www.x402scan.com/api/x402/buyers"]),
  x402Recipients: Object.freeze(["0x2EC4545f96A24876764bF2B04D54E66A1351bE71"]),
  baseRpcOrigins: Object.freeze(["https://mainnet.base.org"]),
});

export class RestrictedLiveViolation extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "RestrictedLiveViolation";
  }
}

export function requireRestrictedLive(operation: string): void {
  if (!RESTRICTED_LIVE_MODE) throw new RestrictedLiveViolation("MODE_REQUIRED", `${operation} requires AUTOMATON_RESTRICTED_LIVE=true`);
}

export function initializeLiveRoot(): void {
  requireRestrictedLive("initialize restricted-live state");
  for (const directory of Object.values(LIVE_PATHS)) fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
}

export function resolveLivePath(candidate: string): string {
  requireRestrictedLive("resolve restricted-live path");
  if (typeof candidate !== "string" || candidate.trim() === "" || candidate.startsWith("~") || path.isAbsolute(candidate)) {
    throw new RestrictedLiveViolation("FILESYSTEM_DENIED", `Invalid restricted-live path: ${candidate}`);
  }
  const resolved = path.resolve(LIVE_ROOT, candidate);
  if (!resolved.startsWith(`${LIVE_ROOT}${path.sep}`)) throw new RestrictedLiveViolation("FILESYSTEM_DENIED", "Restricted-live path escape denied");
  let existing = resolved;
  while (!fs.existsSync(existing)) existing = path.dirname(existing);
  const canonical = fs.realpathSync(existing);
  if (canonical !== LIVE_ROOT && !canonical.startsWith(`${LIVE_ROOT}${path.sep}`)) throw new RestrictedLiveViolation("FILESYSTEM_DENIED", "Restricted-live symlink escape denied");
  return resolved;
}

export function assertAllowedUrl(raw: string, kind: keyof typeof RESTRICTED_LIVE_ALLOWLIST): URL {
  let url: URL;
  try { url = new URL(raw); } catch { throw new RestrictedLiveViolation("NETWORK_DENIED", "Malformed URL denied"); }
  const allowed = RESTRICTED_LIVE_ALLOWLIST[kind];
  if (kind === "x402Recipients" || kind === "x402Urls" || url.username || url.password || url.protocol !== "https:" || !allowed.includes(url.origin)) {
    throw new RestrictedLiveViolation("NETWORK_DENIED", `Destination not allowlisted: ${url.origin}`);
  }
  return url;
}
