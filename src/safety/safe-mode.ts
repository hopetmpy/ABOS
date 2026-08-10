import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import type { ConwayClient, ExecResult } from "../types.js";

export type RuntimeCapability =
  | "network" | "remoteInference" | "shell" | "filesystemWrite"
  | "walletSigning" | "payments" | "creditTransfer" | "blockchainWrite"
  | "messaging" | "infrastructure" | "replication" | "selfModification"
  | "gitWrite" | "gitPush" | "persistentScheduling";

export type RuntimeCapabilities = Readonly<Record<RuntimeCapability, boolean>>;

export class SafeModeViolation extends Error {
  readonly capability: RuntimeCapability;
  readonly operation: string;
  readonly caller?: string;

  constructor(capability: RuntimeCapability, operation: string, caller?: string) {
    super(`Safe mode denied ${capability}: ${operation}${caller ? ` (${caller})` : ""}`);
    this.name = "SafeModeViolation";
    this.capability = capability;
    this.operation = operation;
    this.caller = caller;
  }
}

function parseBooleanFlag(name: string): boolean {
  const value = process.env[name];
  if (value === undefined) return false;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be exactly "true" or "false" when set`);
}

export const SAFE_MODE = parseBooleanFlag("AUTOMATON_SAFE_MODE");
export const OFFLINE_TEST = parseBooleanFlag("AUTOMATON_OFFLINE_TEST");

const productionCapabilities: RuntimeCapabilities = Object.freeze({
  network: true, remoteInference: true, shell: true, filesystemWrite: true,
  walletSigning: true, payments: true, creditTransfer: true, blockchainWrite: true,
  messaging: true, infrastructure: true, replication: true, selfModification: true,
  gitWrite: true, gitPush: true, persistentScheduling: true,
});

const safeCapabilities: RuntimeCapabilities = Object.freeze({
  network: false, remoteInference: false, shell: false, filesystemWrite: true,
  walletSigning: false, payments: false, creditTransfer: false, blockchainWrite: false,
  messaging: false, infrastructure: false, replication: false, selfModification: false,
  gitWrite: false, gitPush: false, persistentScheduling: false,
});

export const RUNTIME_CAPABILITIES = SAFE_MODE ? safeCapabilities : productionCapabilities;

function findRepositoryRoot(start = process.cwd()): string {
  let current = path.resolve(start);
  while (true) {
    if (fs.existsSync(path.join(current, ".git")) && fs.existsSync(path.join(current, "package.json"))) return current;
    const parent = path.dirname(current);
    if (parent === current) throw new Error("Unable to locate Automaton repository root");
    current = parent;
  }
}

export const REPOSITORY_ROOT = findRepositoryRoot();
export const SAFE_STATE_ROOT = path.join(REPOSITORY_ROOT, ".automaton-safe");
export const SAFE_PATHS = Object.freeze({
  root: SAFE_STATE_ROOT,
  state: path.join(SAFE_STATE_ROOT, "state"),
  memory: path.join(SAFE_STATE_ROOT, "memory"),
  soul: path.join(SAFE_STATE_ROOT, "soul"),
  skills: path.join(SAFE_STATE_ROOT, "skills"),
  workspace: path.join(SAFE_STATE_ROOT, "workspace"),
  logs: path.join(SAFE_STATE_ROOT, "logs"),
});

export function requireCapability(capability: RuntimeCapability, operation: string, caller?: string): void {
  if (!RUNTIME_CAPABILITIES[capability]) throw new SafeModeViolation(capability, operation, caller);
}

export function initializeSafeStateRoot(): void {
  if (!SAFE_MODE) throw new SafeModeViolation("filesystemWrite", "initialize safe state while safe mode is disabled", "safe-mode");
  for (const directory of Object.values(SAFE_PATHS)) fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
}

export function resolveSafeWritePath(candidate: string): string {
  if (!SAFE_MODE) return path.resolve(candidate);
  if (typeof candidate !== "string" || candidate.trim() === "") {
    throw new SafeModeViolation("filesystemWrite", "empty or malformed path", "safe-filesystem");
  }
  if (candidate.startsWith("~")) throw new SafeModeViolation("filesystemWrite", `tilde path ${candidate}`, "safe-filesystem");
  const resolved = path.resolve(SAFE_STATE_ROOT, candidate);
  if (resolved !== SAFE_STATE_ROOT && !resolved.startsWith(`${SAFE_STATE_ROOT}${path.sep}`)) {
    throw new SafeModeViolation("filesystemWrite", `path escape ${candidate}`, "safe-filesystem");
  }
  let existing = resolved;
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    existing = parent;
  }
  const canonicalParent = fs.realpathSync(existing);
  if (canonicalParent !== SAFE_STATE_ROOT && !canonicalParent.startsWith(`${SAFE_STATE_ROOT}${path.sep}`)) {
    throw new SafeModeViolation("filesystemWrite", `symlink escape ${candidate}`, "safe-filesystem");
  }
  return resolved;
}

/** Resolve reads independently so callers cannot accidentally bypass confinement. */
export function resolveSafeReadPath(candidate: string): string {
  try {
    return resolveSafeWritePath(candidate);
  } catch (error) {
    if (error instanceof SafeModeViolation) {
      throw new SafeModeViolation("filesystemWrite", `read denied: ${error.operation}`, "safe-filesystem");
    }
    throw error;
  }
}

type AllowedCommand = { executable: string; args: string[] };
function parseAllowedCommand(command: string): AllowedCommand {
  const tokens = command.trim().split(/\s+/);
  const [executable, ...args] = tokens;
  const allowed =
    (executable === "git" && ["status", "diff", "log", "show"].includes(args[0] ?? "")) ||
    (executable === "node" && args.length === 1 && args[0] === "--version") ||
    (executable === "pnpm" && args.length === 1 && ["typecheck", "test:offline"].includes(args[0]));
  if (!allowed || tokens.some((token) => /[;&|`$><]/.test(token))) {
    throw new SafeModeViolation("shell", command, "safe-command-runner");
  }
  return { executable, args };
}

export async function runSafeCommand(command: string, timeout = 30_000): Promise<ExecResult> {
  if (!SAFE_MODE) throw new Error("runSafeCommand is only available in safe mode");
  const { executable, args } = parseAllowedCommand(command);
  return new Promise((resolve) => {
    const child = spawn(executable, args, {
      cwd: SAFE_PATHS.workspace,
      shell: false,
      detached: false,
      timeout,
      env: { PATH: process.env.PATH ?? "" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", (error) => resolve({ stdout, stderr: `${stderr}${error.message}`, exitCode: 1 }));
    child.on("close", (code) => resolve({ stdout, stderr, exitCode: code ?? 1 }));
  });
}

function denied<T>(capability: RuntimeCapability, operation: string): Promise<T> {
  return Promise.reject(new SafeModeViolation(capability, operation, "SafeConwayClient"));
}

export function createSafeConwayClient(): ConwayClient {
  if (!SAFE_MODE && !OFFLINE_TEST) throw new Error("SafeConwayClient requires safe or offline mode");
  if (SAFE_MODE) initializeSafeStateRoot();
  const client: ConwayClient = {
    exec: SAFE_MODE ? runSafeCommand : (command) => denied("shell", command),
    writeFile: async (filePath, content) => {
      const resolved = resolveSafeWritePath(filePath);
      fs.mkdirSync(path.dirname(resolved), { recursive: true, mode: 0o700 });
      fs.writeFileSync(resolved, content, { encoding: "utf8", mode: 0o600 });
    },
    readFile: async (filePath) => fs.readFileSync(resolveSafeReadPath(filePath), "utf8"),
    exposePort: (port) => denied("infrastructure", `expose port ${port}`),
    removePort: (port) => denied("infrastructure", `remove port ${port}`),
    createSandbox: () => denied("infrastructure", "create sandbox"),
    deleteSandbox: (id) => denied("infrastructure", `delete sandbox ${id}`),
    listSandboxes: () => denied("network", "list sandboxes"),
    getCreditsBalance: () => denied("network", "get credits balance"),
    getCreditsPricing: () => denied("network", "get credits pricing"),
    transferCredits: () => denied("creditTransfer", "transfer credits"),
    registerAutomaton: () => denied("infrastructure", "register automaton"),
    searchDomains: () => denied("network", "search domains"),
    registerDomain: () => denied("infrastructure", "register domain"),
    listDnsRecords: () => denied("network", "list DNS records"),
    addDnsRecord: () => denied("infrastructure", "add DNS record"),
    deleteDnsRecord: () => denied("infrastructure", "delete DNS record"),
    listModels: () => denied("network", "list remote models"),
    createScopedClient: () => { throw new SafeModeViolation("replication", "create scoped sandbox client", "SafeConwayClient"); },
  };
  return Object.freeze(client);
}

export function assertOffline(operation: string, caller?: string): void {
  if (SAFE_MODE || OFFLINE_TEST) throw new SafeModeViolation("network", operation, caller);
}
