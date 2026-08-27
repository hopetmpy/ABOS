import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPaymentProposal, ProposalStore, reviewAndExecuteProposal } from "../restricted-live/payment-proposals.js";
import { X402SCAN_ROUTE } from "../restricted-live/x402scan-once.js";

describe("restricted-live payment proposals", () => {
  const dirs: string[] = [];
  afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
  const setup = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), "payment-proposal-")); dirs.push(d); return { proposalFile: path.join(d, "proposals.db"), intentFile: path.join(d, "intent.db") }; };
  const balance = async () => 4_990_000n;

  it("creates only a pinned proposal and returns its ID", async () => {
    const files = setup();
    const id = await createPaymentProposal("Inspect buyer statistics if useful", { ...files, balanceBaseUnits: undefined, getBalanceBaseUnits: balance, id: () => "proposal-test-1", now: () => 1000 } as any);
    const store = new ProposalStore(files.proposalFile); const p = store.get(id, 1000)!; store.close();
    expect(id).toBe("proposal-test-1");
    expect(p).toMatchObject({ state: "PROPOSED", resourceUrl: X402SCAN_ROUTE.url, method: "GET", expectedPriceBaseUnits: "10000", expectedRecipient: X402SCAN_ROUTE.payTo, expectedChainId: 8453, expectedToken: X402SCAN_ROUTE.asset, expectedScheme: "exact", maxTimeoutSeconds: 300 });
  });

  it("rejects empty rationale and budget failures", async () => {
    const files = setup();
    await expect(createPaymentProposal("", { ...files, getBalanceBaseUnits: balance })).rejects.toMatchObject({ code: "PROPOSAL_INVALID" });
    await expect(createPaymentProposal("too little reserve", { ...files, getBalanceBaseUnits: async () => 4_000_000n })).rejects.toMatchObject({ code: "BUDGET_DENIED" });
  });

  it("review requires live mode and exact human approval; it never accepts yes", async () => {
    const files = setup();
    const id = await createPaymentProposal("Inspect buyer statistics", { ...files, getBalanceBaseUnits: balance, id: () => "proposal-test-2" } as any);
    await expect(reviewAndExecuteProposal(id, { ...files, getBalanceBaseUnits: balance, fetch: vi.fn(), executionDeps: {} as any, confirm: async () => "yes" })).rejects.toMatchObject({ code: "MODE_REQUIRED" });
  });

  it("proposal data cannot define a second route", async () => {
    const files = setup();
    const id = await createPaymentProposal("Read stats", { ...files, getBalanceBaseUnits: balance, id: () => "proposal-test-3" } as any);
    const store = new ProposalStore(files.proposalFile); store.close();
    const db = await import("better-sqlite3"); const raw = new db.default(files.proposalFile); raw.prepare("UPDATE payment_proposals SET expected_recipient=? WHERE proposal_id=?").run("0x0000000000000000000000000000000000000001", id); raw.close();
    const check = new ProposalStore(files.proposalFile); const p = check.get(id)!; check.close(); expect(p.expectedRecipient).not.toBe(X402SCAN_ROUTE.payTo);
  });

  it("normalizes expired proposed rows to EXPIRED when read", async () => {
    const files = setup();
    const id = await createPaymentProposal("Expired proposal", { ...files, getBalanceBaseUnits: balance, id: () => "proposal-expired", now: () => 1000 } as any);
    const store = new ProposalStore(files.proposalFile);
    expect(store.get(id, 1000 + 10 * 60 * 1000 + 1)!.state).toBe("EXPIRED");
    expect(store.get(id, 1000 + 10 * 60 * 1000 + 2)!.state).toBe("EXPIRED");
    store.close();
  });

  it("leaves non-expired and terminal proposal states unchanged", async () => {
    const files = setup();
    const id = await createPaymentProposal("Active proposal", { ...files, getBalanceBaseUnits: balance, id: () => "proposal-active", now: () => 1000 } as any);
    const store = new ProposalStore(files.proposalFile);
    expect(store.get(id, 1000 + 10 * 60 * 1000 - 1)!.state).toBe("PROPOSED");
    store.transition(id, "PROPOSED", "REJECTED", 1001);
    expect(store.get(id, 1000 + 20 * 60 * 1000)!.state).toBe("REJECTED");
    store.close();
  });
});
