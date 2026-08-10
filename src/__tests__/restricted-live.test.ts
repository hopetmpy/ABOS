import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BASE_CHAIN_ID, BASE_USDC_ADDRESS, LIVE_PATHS, RESTRICTED_LIVE_ALLOWLIST, RESTRICTED_LIVE_LIMITS, RestrictedLiveViolation } from "../restricted-live/mode.js";
import { SAFE_PATHS, SAFE_MODE } from "../safety/safe-mode.js";
import { createRestrictedWalletAt, getRestrictedWalletPath } from "../restricted-live/wallet.js";
import { getWallet, loadWalletAccount } from "../identity/wallet.js";
import { RestrictedX402PaymentAdapter, denyContractWrite, denyThirdPartyTransfer, type PaymentProposal, type SpendRecord } from "../restricted-live/payment.js";
import { RestrictedBaseRpcTransport, RestrictedChainReader } from "../restricted-live/chain-reader.js";
import { parseRestrictedRunnerArgs, runRestrictedLive } from "../restricted-live/runner.js";
import { getUsdcBalance } from "../conway/x402.js";
import { topupCredits } from "../conway/topup.js";
import { registerAgent } from "../registry/erc8004.js";
import { spawnChild } from "../replication/spawn.js";
import { sendToChild } from "../replication/messaging.js";
import { createSocialClient } from "../social/client.js";
import { createHeartbeatDaemon } from "../heartbeat/daemon.js";
import { gitPush } from "../git/tools.js";

const recipient = "0x2EC4545f96A24876764bF2B04D54E66A1351bE71";
const proposal = (overrides: Partial<PaymentProposal> = {}): PaymentProposal => ({
  url: "https://www.x402scan.com/api/x402/buyers", chainId: BASE_CHAIN_ID,
  tokenAddress: BASE_USDC_ADDRESS, recipient, amountUsdc: 0.05,
  walletBalanceUsdc: 5, idempotencyKey: "payment-1", ...overrides,
});

function harness(records: SpendRecord[] = [], dryRun = true) {
  const signer = { submitX402: vi.fn(async () => ({ transactionHash: "0xabc" })) };
  const store = { records: () => records, append: (record: SpendRecord) => records.push(record) };
  const audit = { record: vi.fn() };
  return { adapter: new RestrictedX402PaymentAdapter(store, audit, signer, dryRun, [recipient], ["https://www.x402scan.com/api/x402/buyers"]), signer, audit };
}

describe("RESTRICTED_LIVE_MODE", () => {
  let tempDir: string | undefined;
  afterEach(() => { if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true }); tempDir = undefined; });

  it("keeps live wallet/state separate from safe and production roots", () => {
    expect(LIVE_PATHS.root).not.toBe(SAFE_PATHS.root);
    expect(getRestrictedWalletPath()).toBe(path.join(LIVE_PATHS.wallet, "wallet.json"));
    expect(getRestrictedWalletPath()).not.toContain(`${path.sep}.automaton${path.sep}`);
    expect(SAFE_MODE).toBe(false);
  });

  it("creates only a dedicated 0600 wallet and never returns or prints its private key", () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "automaton-live-wallet-"));
    const walletFile = path.join(tempDir, "wallet", "wallet.json");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const info = createRestrictedWalletAt(walletFile, () => "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
    expect(Object.keys(info).sort()).toEqual(["address", "createdAt"]);
    expect(info.address).toMatch(/^0x[0-9A-Fa-f]{40}$/);
    expect(fs.statSync(walletFile).mode & 0o777).toBe(0o600);
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("cannot import or load the production/personal wallet", async () => {
    await expect(getWallet()).rejects.toMatchObject({ code: "WALLET_ISOLATION" });
    expect(() => loadWalletAccount()).toThrow(RestrictedLiveViolation);
  });

  it("hard-codes conservative immutable financial limits", () => {
    expect(RESTRICTED_LIVE_LIMITS).toEqual({ maxWalletFundingExpectedUsdc: 5, maxSingleX402PaymentUsdc: 0.1, maxHourlySpendUsdc: 0.25, maxDailySpendUsdc: 0.5, minimumWalletReserveUsdc: 4 });
    expect(Object.isFrozen(RESTRICTED_LIVE_LIMITS)).toBe(true);
  });

  it("denies over-limit, reserve-breaking, unexpected-balance and replay payments", async () => {
    const { adapter } = harness();
    await expect(adapter.pay(proposal({ amountUsdc: 0.11 }))).rejects.toMatchObject({ code: "SINGLE_SPEND_LIMIT" });
    await expect(adapter.pay(proposal({ walletBalanceUsdc: 4.04 }))).rejects.toMatchObject({ code: "RESERVE_LIMIT" });
    await expect(adapter.pay(proposal({ walletBalanceUsdc: 5.01 }))).rejects.toMatchObject({ code: "UNEXPECTED_BALANCE" });
    const replay = harness([{ amountUsdc: 0.01, timestamp: Date.now(), idempotencyKey: "payment-1" }]);
    await expect(replay.adapter.pay(proposal())).rejects.toMatchObject({ code: "REPLAY_DENIED" });
  });

  it("enforces hourly and daily cumulative budgets", async () => {
    const now = Date.now();
    await expect(harness([{ amountUsdc: 0.21, timestamp: now, idempotencyKey: "old" }]).adapter.pay(proposal())).rejects.toMatchObject({ code: "HOURLY_SPEND_LIMIT" });
    await expect(harness([{ amountUsdc: 0.46, timestamp: now - 2 * 60 * 60 * 1000, idempotencyKey: "old" }]).adapter.pay(proposal())).rejects.toMatchObject({ code: "DAILY_SPEND_LIMIT" });
  });

  it("denies wrong host, chain, token, and non-allowlisted recipient", async () => {
    const { adapter } = harness();
    await expect(adapter.pay(proposal({ url: "https://api.conway.tech.evil.test/pay" }))).rejects.toMatchObject({ code: "NETWORK_DENIED" });
    await expect(adapter.pay(proposal({ chainId: 1 }))).rejects.toMatchObject({ code: "CHAIN_DENIED" });
    await expect(adapter.pay(proposal({ tokenAddress: "0x2222222222222222222222222222222222222222" }))).rejects.toMatchObject({ code: "TOKEN_DENIED" });
    await expect(new RestrictedX402PaymentAdapter({ records: () => [], append() {} }, { record() {} }, undefined, true, [], ["https://www.x402scan.com/api/x402/buyers"]).pay(proposal())).rejects.toMatchObject({ code: "RECIPIENT_DENIED" });
  });

  it("dry-run validates and logs but never signs", async () => {
    const { adapter, signer, audit } = harness([], true);
    await expect(adapter.pay(proposal())).resolves.toEqual({ dryRun: true });
    expect(signer.submitX402).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith("payment_approved_dry_run", expect.any(Object));
  });

  it("denies transfers, approvals, arbitrary writes, and RPC write methods", async () => {
    expect(denyThirdPartyTransfer).toThrow("disabled");
    expect(denyContractWrite).toThrow("disabled");
    const transport = { request: vi.fn(async () => "0x0") };
    const reader = new RestrictedChainReader("https://mainnet.base.org", recipient, transport);
    expect(() => reader.request("eth_sendRawTransaction", ["0xdead"])).toThrow("RPC method denied");
    expect(() => reader.request("walletClient.writeContract", [])).toThrow("RPC method denied");
    await reader.request("eth_getBalance", [recipient, "latest"]);
    expect(transport.request).toHaveBeenCalledTimes(1);
  });

  it("denies prohibited production adapters below the tool layer", async () => {
    const fakeAccount = { address: recipient } as any;
    await expect(getUsdcBalance(recipient as any)).rejects.toMatchObject({ code: "PAYMENT_ADAPTER_REQUIRED" });
    await expect(topupCredits("https://api.conway.tech", fakeAccount, 1)).rejects.toMatchObject({ code: "TOPUP_DENIED" });
    await expect(registerAgent(fakeAccount, "data:application/json,{}", "mainnet", {} as any)).rejects.toMatchObject({ code: "REGISTRATION_DENIED" });
    await expect(spawnChild({} as any, {} as any, {} as any, {} as any)).rejects.toMatchObject({ code: "REPLICATION_DENIED" });
    await expect(sendToChild({ send: async () => ({ id: "bypass" }) } as any, recipient, "hello")).rejects.toMatchObject({ code: "MESSAGING_DENIED" });
    expect(() => createSocialClient("https://social.conway.tech", fakeAccount)).toThrow("disabled");
    expect(() => createHeartbeatDaemon({} as any)).toThrow("disabled");
    await expect(gitPush({ exec: async () => ({ stdout: "", stderr: "", exitCode: 0 }) } as any, LIVE_PATHS.workspace)).rejects.toMatchObject({ code: "GIT_WRITE_DENIED" });
  });

  it("read-only HTTPS transport audits allowed calls and denies writes before fetch", async () => {
    const audit = { record: vi.fn() };
    const transport = new RestrictedBaseRpcTransport("https://mainnet.base.org", audit);
    const fetchCalls = vi.mocked(fetch).mock.calls.length;
    await expect(transport.request("eth_sendRawTransaction", ["0xdead"])).rejects.toMatchObject({ code: "RPC_WRITE_DENIED" });
    expect(vi.mocked(fetch).mock.calls.length).toBe(fetchCalls);
    expect(audit.record).toHaveBeenCalledWith("network_call_denied", expect.objectContaining({ method: "eth_sendRawTransaction" }));
  });

  it("maps network, timeout, HTTP, and JSON-RPC failures to sanitized read failures", async () => {
    const audit = { record: vi.fn() };
    const transport = new RestrictedBaseRpcTransport("https://mainnet.base.org", audit);
    vi.mocked(fetch).mockRejectedValueOnce(new Error("fetch failed (UND_ERR_CONNECT_TIMEOUT)"));
    await expect(transport.request("eth_call", [{ to: BASE_USDC_ADDRESS }, "latest"]))
      .rejects.toMatchObject({ code: "RPC_READ_FAILED", message: expect.stringContaining("Base RPC eth_call network failure") });
    vi.mocked(fetch).mockRejectedValueOnce(new Error("TLS secret 0x1234567890abcdef1234567890abcdef1234567890abcdef"));
    await expect(transport.request("eth_chainId", [])).rejects.toMatchObject({ code: "RPC_READ_FAILED" });
    const response = (body: unknown, ok: boolean, status: number) => new Response(JSON.stringify(body), { status });
    vi.mocked(fetch).mockResolvedValueOnce(response({}, false, 500));
    await expect(transport.request("eth_chainId", [])).rejects.toMatchObject({ code: "RPC_READ_FAILED" });
    vi.mocked(fetch).mockResolvedValueOnce(response({ jsonrpc: "2.0", error: { message: "method unavailable" } }, true, 200));
    await expect(transport.request("eth_chainId", [])).rejects.toMatchObject({ code: "RPC_READ_FAILED" });
  });

  it("preserves successful chain and USDC balance reads", async () => {
    const transport = new RestrictedBaseRpcTransport("https://mainnet.base.org", { record() {} });
    const reader = new RestrictedChainReader("https://mainnet.base.org", recipient, transport);
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ result: "0x2105" }), { status: 200 }));
    expect(await reader.getChainId()).toBe(8453);
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ result: "0x4c4b40" }), { status: 200 }));
    expect(await reader.getOwnUsdcBalanceBaseUnits()).toBe(5_000_000n);
  });

  it("uses exact default-deny destination allowlists", () => {
    expect(RESTRICTED_LIVE_ALLOWLIST.x402Origins).toEqual(["https://www.x402scan.com"]);
    expect(RESTRICTED_LIVE_ALLOWLIST.x402Recipients).toEqual(["0x2EC4545f96A24876764bF2B04D54E66A1351bE71"]);
    expect(RESTRICTED_LIVE_ALLOWLIST.x402Urls).toEqual(["https://www.x402scan.com/api/x402/buyers"]);
    expect(() => new RestrictedChainReader("https://mainnet.base.org.evil.test", recipient, { request: async () => null })).toThrow("not allowlisted");
  });

  it("kills on unknown tools and enforces turn/runtime argument bounds", async () => {
    await expect(runRestrictedLive({ maxTurns: 1, maxRuntimeSeconds: 5, requestedTools: ["git_push"] })).rejects.toMatchObject({ code: "UNKNOWN_TOOL" });
    await expect(runRestrictedLive({ maxTurns: 101, maxRuntimeSeconds: 5 })).rejects.toMatchObject({ code: "BOUND_INVALID" });
    await expect(runRestrictedLive({ maxTurns: 1, maxRuntimeSeconds: 0 })).rejects.toMatchObject({ code: "BOUND_INVALID" });
    expect(parseRestrictedRunnerArgs([])).toEqual({ maxTurns: 3, maxRuntimeSeconds: 120, chainRead: false });
    await expect(runRestrictedLive({ maxTurns: 2, maxRuntimeSeconds: 5 })).resolves.toMatchObject({ turns: 2, dryRun: true, statePath: path.join(LIVE_PATHS.state, "state.db") });
  });
});
