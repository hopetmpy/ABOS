import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import nacl from "tweetnacl";
import bs58 from "bs58";
import {
  applyCreatorPolicyAuthorization,
  buildPolicyAuthorizationChallenge,
  claimApprovedPolicyAuthorization,
  computePolicyScopeHash,
  persistPolicyDecisionLifecycle,
} from "../agent/policy-authorization.js";
import { createFinancialRules } from "../agent/policy-rules/financial.js";
import { createRateLimitRules } from "../agent/policy-rules/rate-limits.js";
import { createValidationRules } from "../agent/policy-rules/validation.js";
import { verifySignedMessage } from "../identity/chain.js";
import { insertPolicyDecision } from "../state/database.js";
import { DEFAULT_TREASURY_POLICY } from "../types.js";
import { createTestDb } from "./mocks.js";

const x402Mocks = vi.hoisted(() => ({
  x402Fetch: vi.fn(),
}));

vi.mock("../conway/x402.js", () => ({
  x402Fetch: x402Mocks.x402Fetch,
}));

import {
  bootstrapTopup,
  topupCredits,
  topupForSandbox,
} from "../conway/topup.js";

function createPendingDecision(
  raw: any,
  creatorAddress: string,
  id: string,
  toolName = "transfer_credits",
): { scopeHash: string; request: any } {
  const request = {
    tool: { name: toolName },
    args: toolName === "transfer_credits"
      ? { to_address: "0x1111111111111111111111111111111111111111", amount_cents: 2500 }
      : { amount_usd: 25 },
    context: { config: { creatorAddress } },
    turnContext: {
      inputSource: "agent",
      actorAddress: "0x2222222222222222222222222222222222222222",
      turnToolCallCount: 0,
    },
  } as any;
  const scopeHash = computePolicyScopeHash(request);
  persistPolicyDecisionLifecycle(
    raw,
    {
      id,
      action: "quarantine",
      reasonCode: "CONFIRMATION_REQUIRED",
      humanMessage: "creator approval required",
      riskLevel: "dangerous",
      authorityLevel: "agent",
      toolName,
      argsHash: "args-hash",
      scopeHash,
      inputSource: "agent",
      actorAddress: request.turnContext.actorAddress,
      rulesEvaluated: ["financial.require_confirmation"],
      rulesTriggered: ["financial.require_confirmation"],
      timestamp: new Date().toISOString(),
    },
    request,
    "turn-test",
  );
  return { scopeHash, request };
}

function ruleRequest(toolName: string, args: Record<string, unknown>, db?: any): any {
  return {
    tool: { name: toolName },
    args,
    context: { db },
    turnContext: { turnToolCallCount: 0 },
  };
}

function insertRateRow(
  raw: any,
  id: string,
  toolName: string,
  lifecycleState: string,
  executionState: string,
  decision = "allow",
): void {
  insertPolicyDecision(raw, {
    id,
    turnId: null,
    toolName,
    toolArgsHash: `hash-${id}`,
    riskLevel: "dangerous",
    decision,
    rulesEvaluated: "[]",
    rulesTriggered: "[]",
    reason: "test",
    latencyMs: 0,
  });
  raw.prepare(
    `UPDATE policy_decisions
     SET lifecycle_state = ?, execution_state = ?
     WHERE id = ?`,
  ).run(lifecycleState, executionState, id);
}

describe("P-010 creator-signed authorization follow-up", () => {
  let db: ReturnType<typeof createTestDb>;

  beforeEach(() => {
    db = createTestDb();
    x402Mocks.x402Fetch.mockReset();
  });

  afterEach(() => {
    db.close();
  });

  it("verifies EVM and Solana signatures against the exact message", async () => {
    const evm = privateKeyToAccount(generatePrivateKey());
    const message = "ABOS exact challenge";
    const evmSignature = await evm.signMessage({ message });
    expect(await verifySignedMessage(evm.address, message, evmSignature)).toBe(true);
    expect(await verifySignedMessage(evm.address, `${message}!`, evmSignature)).toBe(false);

    const sol = nacl.sign.keyPair();
    const solAddress = bs58.encode(sol.publicKey);
    const solSignature = bs58.encode(
      nacl.sign.detached(new TextEncoder().encode(message), sol.secretKey),
    );
    expect(await verifySignedMessage(solAddress, message, solSignature)).toBe(true);
    expect(await verifySignedMessage(solAddress, `${message}!`, solSignature)).toBe(false);
  });

  it("binds an approval to the durable creator, decision, tool, scope and expiry", async () => {
    const creator = privateKeyToAccount(generatePrivateKey());
    const { scopeHash } = createPendingDecision(db.raw, creator.address, "decision-evm");
    const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
    const challenge = buildPolicyAuthorizationChallenge(
      db.raw,
      "decision-evm",
      "approve",
      expiresAt,
    );

    expect(challenge.creatorAddress).toBe(creator.address.toLowerCase());
    expect(challenge.scopeHash).toBe(scopeHash);
    expect(challenge.message).toContain("abos.policy-authorization.v1");
    expect(challenge.message).toContain("transfer_credits");

    const signature = await creator.signMessage({ message: challenge.message });
    const applied = await applyCreatorPolicyAuthorization(db.raw, {
      decisionId: "decision-evm",
      action: "approve",
      expiresAt,
      signature,
    });
    expect(applied.lifecycleState).toBe("approved");

    const row = db.raw.prepare(
      `SELECT lifecycle_state, authorization_json FROM policy_decisions WHERE id = ?`,
    ).get("decision-evm") as any;
    expect(row.lifecycle_state).toBe("approved");
    const evidence = JSON.parse(row.authorization_json);
    expect(evidence.creatorAddress).toBe(creator.address.toLowerCase());
    expect(evidence.signature).toBe(signature);
    expect(evidence.scopeHash).toBe(scopeHash);

    const claim = claimApprovedPolicyAuthorization(db.raw, scopeHash);
    expect(claim?.decisionId).toBe("decision-evm");
    expect(claimApprovedPolicyAuthorization(db.raw, scopeHash)).toBeNull();
  });

  it("rejects a valid signature from any address other than the durable creator", async () => {
    const creator = privateKeyToAccount(generatePrivateKey());
    const attacker = privateKeyToAccount(generatePrivateKey());
    createPendingDecision(db.raw, creator.address, "decision-wrong-signer");
    const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
    const challenge = buildPolicyAuthorizationChallenge(
      db.raw,
      "decision-wrong-signer",
      "approve",
      expiresAt,
    );
    const signature = await attacker.signMessage({ message: challenge.message });

    await expect(
      applyCreatorPolicyAuthorization(db.raw, {
        decisionId: "decision-wrong-signer",
        action: "approve",
        expiresAt,
        signature,
      }),
    ).rejects.toThrow("Creator signature verification failed");
  });

  it("supports Solana creator approval without storing a private key", async () => {
    const creator = nacl.sign.keyPair();
    const creatorAddress = bs58.encode(creator.publicKey);
    const { scopeHash } = createPendingDecision(
      db.raw,
      creatorAddress,
      "decision-solana",
      "topup_credits",
    );
    const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
    const challenge = buildPolicyAuthorizationChallenge(
      db.raw,
      "decision-solana",
      "approve",
      expiresAt,
    );
    const signature = bs58.encode(
      nacl.sign.detached(
        new TextEncoder().encode(challenge.message),
        creator.secretKey,
      ),
    );

    await applyCreatorPolicyAuthorization(db.raw, {
      decisionId: "decision-solana",
      action: "approve",
      expiresAt,
      signature,
    });
    expect(claimApprovedPolicyAuthorization(db.raw, scopeHash)?.decisionId)
      .toBe("decision-solana");
  });

  it("revokes an unconsumed approval and prevents later claim", async () => {
    const creator = privateKeyToAccount(generatePrivateKey());
    const { scopeHash } = createPendingDecision(db.raw, creator.address, "decision-revoke");
    const approveExpiry = new Date(Date.now() + 10 * 60_000).toISOString();
    const approveChallenge = buildPolicyAuthorizationChallenge(
      db.raw,
      "decision-revoke",
      "approve",
      approveExpiry,
    );
    await applyCreatorPolicyAuthorization(db.raw, {
      decisionId: "decision-revoke",
      action: "approve",
      expiresAt: approveExpiry,
      signature: await creator.signMessage({ message: approveChallenge.message }),
    });

    const revokeExpiry = new Date(Date.now() + 5 * 60_000).toISOString();
    const revokeChallenge = buildPolicyAuthorizationChallenge(
      db.raw,
      "decision-revoke",
      "revoke",
      revokeExpiry,
    );
    const revoked = await applyCreatorPolicyAuthorization(db.raw, {
      decisionId: "decision-revoke",
      action: "revoke",
      expiresAt: revokeExpiry,
      signature: await creator.signMessage({ message: revokeChallenge.message }),
    });
    expect(revoked.lifecycleState).toBe("revoked");
    expect(claimApprovedPolicyAuthorization(db.raw, scopeHash)).toBeNull();
  });

  it("refuses expired creator evidence", async () => {
    const creator = privateKeyToAccount(generatePrivateKey());
    createPendingDecision(db.raw, creator.address, "decision-expired");
    const expiresAt = new Date(Date.now() - 60_000).toISOString();
    const challenge = buildPolicyAuthorizationChallenge(
      db.raw,
      "decision-expired",
      "approve",
      expiresAt,
    );
    const signature = await creator.signMessage({ message: challenge.message });
    await expect(
      applyCreatorPolicyAuthorization(db.raw, {
        decisionId: "decision-expired",
        action: "approve",
        expiresAt,
        signature,
      }),
    ).rejects.toThrow("Authorization evidence expired");
  });

  it("caps x402 topup at the exact canonical tier and rejects arbitrary amounts", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    x402Mocks.x402Fetch.mockResolvedValue({
      success: true,
      response: { credits_cents: 2500 },
      status: 200,
    });

    const result = await topupCredits("https://api.conway.tech", account, 25);
    expect(result.success).toBe(true);
    expect(x402Mocks.x402Fetch).toHaveBeenCalledWith(
      expect.stringContaining("/pay/25/"),
      account,
      "GET",
      undefined,
      undefined,
      2500,
    );

    x402Mocks.x402Fetch.mockClear();
    const invalid = await topupCredits("https://api.conway.tech", account, 7);
    expect(invalid.success).toBe(false);
    expect(x402Mocks.x402Fetch).not.toHaveBeenCalled();
  });

  it("never pays from startup or sandbox recovery helpers", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const bootstrap = await bootstrapTopup({
      apiUrl: "https://api.conway.tech",
      account,
      creditsCents: 0,
    });
    expect(bootstrap?.success).toBe(false);

    const sandbox = await topupForSandbox({
      apiUrl: "https://api.conway.tech",
      account,
      error: Object.assign(new Error("INSUFFICIENT_CREDITS"), {
        status: 402,
        responseText: JSON.stringify({
          details: { required_cents: 1000, current_balance_cents: 0 },
        }),
      }),
    });
    expect(sandbox?.success).toBe(false);
    expect(sandbox?.amountUsd).toBe(25);
    expect(x402Mocks.x402Fetch).not.toHaveBeenCalled();
  });

  it("accepts Solana for send_message but keeps financial address validation EVM-only", () => {
    const solAddress = bs58.encode(nacl.sign.keyPair().publicKey);
    const rule = createValidationRules().find((item) => item.id === "validate.address_format")!;

    expect(rule.evaluate(ruleRequest("send_message", { to_address: solAddress }))).toBeNull();
    expect(rule.evaluate(ruleRequest("transfer_credits", {
      to_address: solAddress,
      amount_cents: 100,
    }))?.action).toBe("deny");
  });

  it("quarantines large topups but leaves the minimum canonical tier autonomous", () => {
    const rule = createFinancialRules(DEFAULT_TREASURY_POLICY)
      .find((item) => item.id === "financial.require_confirmation")!;

    expect(rule.evaluate(ruleRequest("topup_credits", { amount_usd: 5 }))).toBeNull();
    const large = rule.evaluate(ruleRequest("topup_credits", { amount_usd: 25 }));
    expect(large?.action).toBe("quarantine");
    expect(large?.reasonCode).toBe("CONFIRMATION_REQUIRED");
  });

  it("rate limits executed/uncertain effects, not pre-effect allows or known failures", () => {
    const rule = createRateLimitRules().find((item) => item.id === "rate.spawn_daily")!;

    insertRateRow(db.raw, "spawn-1", "spawn_child", "evaluated_allow", "succeeded");
    insertRateRow(db.raw, "spawn-2", "spawn_child", "authorized_execution", "succeeded", "quarantine");
    insertRateRow(db.raw, "spawn-3", "spawn_child", "authorized_execution", "unknown", "quarantine");
    expect(rule.evaluate(ruleRequest("spawn_child", {}, db))?.reasonCode).toBe("RATE_LIMIT_SPAWN");

    db.raw.prepare(
      `UPDATE policy_decisions SET execution_state = 'failed' WHERE id = 'spawn-3'`,
    ).run();
    expect(rule.evaluate(ruleRequest("spawn_child", {}, db))).toBeNull();

    insertRateRow(db.raw, "spawn-legacy", "spawn_child", "legacy", "not_started", "allow");
    expect(rule.evaluate(ruleRequest("spawn_child", {}, db))?.reasonCode).toBe("RATE_LIMIT_SPAWN");
  });
});
