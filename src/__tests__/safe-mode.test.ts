import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import tls from "node:tls";
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import childProcess from "node:child_process";
import Database from "better-sqlite3";
import { createSafeConwayClient, resolveSafeReadPath, resolveSafeWritePath, RUNTIME_CAPABILITIES, SAFE_PATHS, SafeModeViolation } from "../safety/safe-mode.js";
import { getWallet, generateSolanaKeypair, loadWalletAccount } from "../identity/wallet.js";
import { bootstrapTopup, topupCredits } from "../conway/topup.js";
import { checkX402, getUsdcBalance, x402Fetch } from "../conway/x402.js";
import { createSocialClient } from "../social/client.js";
import { spawnChild } from "../replication/spawn.js";
import { sendToChild } from "../replication/messaging.js";
import { registerAgent } from "../registry/erc8004.js";
import { runSafeLocal } from "../safety/safe-runner.js";
import { gitPush } from "../git/tools.js";
import { executeTool } from "../agent/tools.js";
import { PolicyEngine } from "../agent/policy-engine.js";
import { createDefaultRules } from "../agent/policy-rules/index.js";
import { createHeartbeatDaemon } from "../heartbeat/daemon.js";

const fakeAccount = { address: "0x0000000000000000000000000000000000000001" } as any;

describe("LOCAL_SAFE_MODE hard boundaries", () => {
  it("cannot generate or load wallets", async () => {
    expect(() => generateSolanaKeypair()).toThrow(SafeModeViolation);
    await expect(getWallet()).rejects.toBeInstanceOf(SafeModeViolation);
    expect(() => loadWalletAccount()).toThrow(SafeModeViolation);
  });

  it("denies payment, credit transfer, infrastructure and host fallback", async () => {
    const client = createSafeConwayClient();
    await expect(bootstrapTopup({ apiUrl: "https://invalid", account: fakeAccount, creditsCents: 0 })).rejects.toBeInstanceOf(SafeModeViolation);
    await expect(client.transferCredits("0x2", 1)).rejects.toBeInstanceOf(SafeModeViolation);
    await expect(client.createSandbox({ name: "denied" })).rejects.toBeInstanceOf(SafeModeViolation);
    await expect(client.registerAutomaton({} as any)).rejects.toBeInstanceOf(SafeModeViolation);
    await expect(client.exec("touch /tmp/safe-mode-bypass")).rejects.toBeInstanceOf(SafeModeViolation);
    await expect(getUsdcBalance(fakeAccount.address)).rejects.toBeInstanceOf(SafeModeViolation);
    await expect(checkX402("https://example.invalid")).rejects.toBeInstanceOf(SafeModeViolation);
    await expect(x402Fetch("https://example.invalid", {}, fakeAccount)).rejects.toBeInstanceOf(SafeModeViolation);
    await expect(topupCredits("https://example.invalid", fakeAccount, 1)).rejects.toBeInstanceOf(SafeModeViolation);
  });

  it("denies blockchain writes, messaging and replication below tools", async () => {
    await expect(registerAgent(fakeAccount, "data:application/json,{}", "mainnet", {} as any)).rejects.toBeInstanceOf(SafeModeViolation);
    expect(() => createSocialClient("https://example.invalid", fakeAccount)).toThrow(SafeModeViolation);
    await expect(spawnChild({} as any, {} as any, {} as any, {} as any)).rejects.toBeInstanceOf(SafeModeViolation);
    await expect(sendToChild({ send: async () => ({ id: "bypass" }) } as any, "0x2", "hello")).rejects.toBeInstanceOf(SafeModeViolation);
    expect(() => createHeartbeatDaemon({} as any)).toThrow(SafeModeViolation);
  });

  it("denies git push and permits only allowlisted commands", async () => {
    const client = createSafeConwayClient();
    await expect(client.exec("git push origin main")).rejects.toBeInstanceOf(SafeModeViolation);
    await expect(client.exec("curl https://example.invalid")).rejects.toBeInstanceOf(SafeModeViolation);
    await expect(gitPush({ exec: async () => ({ stdout: "bypass", stderr: "", exitCode: 0 }) } as any, SAFE_PATHS.workspace)).rejects.toBeInstanceOf(SafeModeViolation);
  });

  it("confines writes and rejects traversal, absolute and symlink escapes", async () => {
    const client = createSafeConwayClient();
    await expect(client.writeFile("workspace/allowed.txt", "ok")).resolves.toBeUndefined();
    expect(fs.readFileSync(path.join(SAFE_PATHS.workspace, "allowed.txt"), "utf8")).toBe("ok");
    expect(() => resolveSafeWritePath("../escape")).toThrow(SafeModeViolation);
    expect(() => resolveSafeWritePath("/tmp/escape")).toThrow(SafeModeViolation);
    expect(() => resolveSafeWritePath("~/escape")).toThrow(SafeModeViolation);
    expect(() => resolveSafeWritePath("")).toThrow(SafeModeViolation);
    expect(() => resolveSafeWritePath("   ")).toThrow(SafeModeViolation);
    expect(() => resolveSafeReadPath("../production-secret")).toThrow(SafeModeViolation);
    const link = path.join(SAFE_PATHS.root, "escape-link");
    const nested = path.join(SAFE_PATHS.root, "nested-link-parent");
    fs.rmSync(link, { force: true });
    fs.rmSync(nested, { recursive: true, force: true });
    fs.symlinkSync("/tmp", link);
    fs.mkdirSync(nested);
    fs.symlinkSync("/tmp", path.join(nested, "child"));
    try {
      expect(() => resolveSafeWritePath("escape-link/file")).toThrow(SafeModeViolation);
      expect(() => resolveSafeWritePath("nested-link-parent/child/file")).toThrow(SafeModeViolation);
      const priorCwd = process.cwd();
      process.chdir(SAFE_PATHS.workspace);
      try { expect(resolveSafeWritePath("state/from-alternate-cwd")).toBe(path.join(SAFE_PATHS.root, "state/from-alternate-cwd")); }
      finally { process.chdir(priorCwd); }
    } finally {
      fs.rmSync(link, { force: true });
      fs.rmSync(nested, { recursive: true, force: true });
    }
  });

  it("offline harness denies every direct network and process primitive", async () => {
    await expect(fetch("https://example.invalid")).rejects.toThrow("denied fetch");
    expect(() => net.connect(443, "example.invalid")).toThrow("net.connect");
    expect(() => tls.connect(443, "example.invalid")).toThrow("tls.connect");
    expect(() => dns.lookup("example.invalid", () => {})).toThrow("dns.lookup");
    expect(() => http.get("http://example.invalid")).toThrow("http.get");
    expect(() => https.get("https://example.invalid")).toThrow("https.get");
    expect(() => childProcess.exec("curl https://example.invalid")).toThrow("child_process.exec");
    expect(() => childProcess.execFile("wget", ["https://example.invalid"])).toThrow("child_process.execFile");
    expect(() => childProcess.execSync("curl https://example.invalid")).toThrow("child_process.execSync");
    expect(() => childProcess.execFileSync("wget", ["https://example.invalid"])).toThrow("child_process.execFileSync");
    expect(() => childProcess.fork("escape.js")).toThrow("child_process.fork");
    expect(() => childProcess.spawn("nc", ["example.invalid", "443"])).toThrow("child_process.spawn");
    expect(() => childProcess.spawnSync("nc", ["example.invalid", "443"])).toThrow("child_process.spawnSync");
    expect(() => childProcess.spawn("echo", ["bypass"], { shell: true })).toThrow("child_process.spawn");
  });

  it("executeTool fails closed for missing, malformed, and model-supplied policy context", async () => {
    const tools = [{
      name: "exec", description: "security-test sentinel", parameters: { type: "object", properties: {} },
      riskLevel: "critical", execute: async () => "BYPASS",
    }] as any;
    const context = { conway: createSafeConwayClient(), runtimeCapabilities: RUNTIME_CAPABILITIES } as any;
    const turnContext = { inputSource: "creator", turnToolCallCount: 0, sessionSpend: { recordSpend() {} } } as any;
    const db = new Database(":memory:");
    const engine = new PolicyEngine(db, createDefaultRules());
    try {
      expect((await executeTool("exec", { command: "node --version" }, tools, context)).error).toContain("POLICY_CONTEXT_REQUIRED");
      expect((await executeTool("exec", { command: "node --version" }, tools, context, engine)).error).toContain("POLICY_CONTEXT_REQUIRED");
      expect((await executeTool("exec", { command: "node --version" }, tools, { ...context, runtimeCapabilities: { ...RUNTIME_CAPABILITIES } }, engine, turnContext)).error).toContain("POLICY_CONTEXT_REQUIRED");
      const bypass = await executeTool("exec", { command: "node --version", AUTOMATON_SAFE_MODE: false, runtimeCapabilities: { shell: true } }, tools, context, engine, turnContext);
      expect(bypass.error).toContain("SAFE_MODE_DENIED");
    } finally { db.close(); }
  });

  it("safe runner is bounded and uses only safe state", async () => {
    const result = await runSafeLocal({ maxTurns: 1, maxRuntimeMs: 1000 });
    expect(result.turns).toBe(1);
    expect(result.statePath.startsWith(SAFE_PATHS.root)).toBe(true);
    expect(result.statePath).not.toContain(`${path.sep}.automaton${path.sep}`);
  });
});
