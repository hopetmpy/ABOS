/**
 * Codex app-server transport.
 *
 * ABOS deliberately talks to the official Codex runtime over its stdio control
 * plane instead of copying OAuth tokens into ABOS. Codex remains the authority
 * for ChatGPT authentication, token refresh, account state and model discovery.
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import readline from "node:readline";
import { ABOS_VERSION } from "../version.js";

type NotificationHandler = (params: unknown) => void;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface RecentNotification {
  method: string;
  params: unknown;
}

export interface CodexRpcTransport {
  start(): Promise<void>;
  request<T>(method: string, params?: Record<string, unknown>): Promise<T>;
  waitForNotification<T>(
    method: string,
    predicate: (params: T) => boolean,
    timeoutMs?: number,
  ): Promise<T>;
  close(): void;
}

export interface CodexAppServerOptions {
  command?: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  requestTimeoutMs?: number;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const MAX_RECENT_NOTIFICATIONS = 100;
const MAX_STDERR_LINES = 8;

export class CodexAppServerClient implements CodexRpcTransport {
  private readonly options: CodexAppServerOptions;
  private child: ChildProcessWithoutNullStreams | null = null;
  private nextRequestId = 1;
  private initialized = false;
  private closing = false;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly handlers = new Map<string, Set<NotificationHandler>>();
  private readonly recentNotifications: RecentNotification[] = [];
  private readonly recentStderr: string[] = [];

  constructor(options: CodexAppServerOptions = {}) {
    this.options = options;
  }

  async start(): Promise<void> {
    if (this.initialized) return;
    if (this.child) {
      throw new Error("Codex app-server startup is already in progress");
    }

    const command = this.options.command || process.env.CODEX_CLI_PATH || "codex";
    const args = this.options.args || ["app-server"];

    const child = spawn(command, args, {
      cwd: this.options.cwd,
      env: { ...process.env, ...(this.options.env || {}) },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;

    const stdout = readline.createInterface({ input: child.stdout });
    const stderr = readline.createInterface({ input: child.stderr });

    stdout.on("line", (line) => this.handleLine(line));
    stderr.on("line", (line) => {
      const sanitized = sanitizeDiagnostic(line);
      if (!sanitized) return;
      this.recentStderr.push(sanitized);
      if (this.recentStderr.length > MAX_STDERR_LINES) this.recentStderr.shift();
    });

    child.on("exit", (code, signal) => {
      this.initialized = false;
      this.child = null;
      if (this.closing) return;
      const detail = this.recentStderr.length > 0
        ? `: ${this.recentStderr.join(" | ")}`
        : "";
      this.failAll(
        new Error(
          `Codex app-server exited unexpectedly (code=${String(code)}, signal=${String(signal)})${detail}`,
        ),
      );
    });

    try {
      await new Promise<void>((resolve, reject) => {
        const onSpawn = () => {
          child.off("error", onError);
          resolve();
        };
        const onError = (error: Error) => {
          child.off("spawn", onSpawn);
          reject(error);
        };
        child.once("spawn", onSpawn);
        child.once("error", onError);
      });
    } catch (error) {
      this.child = null;
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Codex CLI is unavailable. Install the official Codex runtime or set CODEX_CLI_PATH. ${message}`,
      );
    }

    await this.rawRequest("initialize", {
      clientInfo: {
        name: "abos",
        title: "ABOS",
        version: ABOS_VERSION,
      },
      capabilities: {
        experimentalApi: false,
      },
    });
    this.writeMessage({ method: "initialized" });
    this.initialized = true;
  }

  async request<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    if (!this.initialized) {
      throw new Error("Codex app-server is not initialized");
    }
    return this.rawRequest<T>(method, params);
  }

  waitForNotification<T>(
    method: string,
    predicate: (params: T) => boolean,
    timeoutMs = 10 * 60_000,
  ): Promise<T> {
    for (let i = this.recentNotifications.length - 1; i >= 0; i--) {
      const item = this.recentNotifications[i];
      if (item.method === method && predicate(item.params as T)) {
        return Promise.resolve(item.params as T);
      }
    }

    return new Promise<T>((resolve, reject) => {
      const handler: NotificationHandler = (params) => {
        if (!predicate(params as T)) return;
        cleanup();
        resolve(params as T);
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timed out waiting for Codex notification '${method}'`));
      }, timeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        this.handlers.get(method)?.delete(handler);
      };

      const set = this.handlers.get(method) || new Set<NotificationHandler>();
      set.add(handler);
      this.handlers.set(method, set);
    });
  }

  close(): void {
    this.closing = true;
    this.failAll(new Error("Codex app-server connection closed"));
    const child = this.child;
    this.child = null;
    this.initialized = false;
    if (child && !child.killed) child.kill("SIGTERM");
  }

  private rawRequest<T>(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<T> {
    const id = this.nextRequestId++;
    const timeoutMs = this.options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex request '${method}' timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });

      try {
        this.writeMessage({
          id,
          method,
          ...(params ? { params } : {}),
        });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private writeMessage(message: Record<string, unknown>): void {
    const child = this.child;
    if (!child || child.stdin.destroyed) {
      throw new Error("Codex app-server stdin is unavailable");
    }
    child.stdin.write(JSON.stringify(message) + "\n");
  }

  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;

    let message: any;
    try {
      message = JSON.parse(trimmed);
    } catch {
      return;
    }

    if (message && message.id !== undefined && !message.method) {
      const id = Number(message.id);
      const pending = this.pending.get(id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(id);

      if (message.error) {
        const code = message.error.code !== undefined ? ` [${String(message.error.code)}]` : "";
        pending.reject(
          new Error(`Codex request failed${code}: ${String(message.error.message || "unknown error")}`),
        );
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (message && typeof message.method === "string" && message.id === undefined) {
      this.recordNotification(message.method, message.params);
      return;
    }

    // The control-plane client does not execute server-initiated tools. Respond
    // explicitly instead of leaving the app-server blocked if a future protocol
    // starts issuing requests during account/catalog operations.
    if (message && typeof message.method === "string" && message.id !== undefined) {
      this.writeMessage({
        id: message.id,
        error: {
          code: -32601,
          message: `ABOS Codex control plane does not handle server request '${message.method}'`,
        },
      });
    }
  }

  private recordNotification(method: string, params: unknown): void {
    this.recentNotifications.push({ method, params });
    if (this.recentNotifications.length > MAX_RECENT_NOTIFICATIONS) {
      this.recentNotifications.shift();
    }

    for (const handler of this.handlers.get(method) || []) {
      try {
        handler(params);
      } catch {
        // A consumer callback must never break the transport read loop.
      }
    }
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

function sanitizeDiagnostic(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, "Bearer [REDACTED]")
    .replace(/sk-[A-Za-z0-9_-]+/g, "sk-[REDACTED]")
    .replace(/access[_-]?token["'=:\s]+[^\s,}]+/gi, "access_token=[REDACTED]")
    .slice(0, 500);
}
