import { afterEach, describe, expect, it } from "vitest";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import {
  claimApprovedPolicyAuthorization,
  computePolicyScopeHash,
  persistPolicyDecisionLifecycle,
} from "../agent/policy-authorization.js";
import { createTestConfig, createTestDb } from "./mocks.js";

function requestFor(creatorAddress: string): any {
  return {
    tool: { name: "transfer_credits" },
    args: {
      to_address: "0x1111111111111111111111111111111111111111",
      amount_cents: 2500,
    },
    context: { config: createTestConfig({ creatorAddress }) },
    turnContext: {
      inputSource: "agent",
      actorAddress: "0x2222222222222222222222222222222222222222",
      turnToolCallCount: 0,
    },
  };
}

describe("P-010 creator authority scope rotation", () => {
  const dbs: ReturnType<typeof createTestDb>[] = [];

  afterEach(() => {
    while (dbs.length) dbs.pop()!.close();
  });

  it("changes scope when creator authority rotates and refuses the stale approved scope", () => {
    const oldCreator = privateKeyToAccount(generatePrivateKey()).address;
    const newCreator = privateKeyToAccount(generatePrivateKey()).address;
    const oldRequest = requestFor(oldCreator);
    const newRequest = requestFor(newCreator);
    const oldScope = computePolicyScopeHash(oldRequest);
    const newScope = computePolicyScopeHash(newRequest);
    expect(newScope).not.toBe(oldScope);

    const db = createTestDb();
    dbs.push(db);
    persistPolicyDecisionLifecycle(
      db.raw,
      {
        id: "creator-rotation-old-approval",
        action: "quarantine",
        reasonCode: "CONFIRMATION_REQUIRED",
        humanMessage: "creator approval required",
        riskLevel: "dangerous",
        authorityLevel: "agent",
        toolName: "transfer_credits",
        argsHash: "args-hash",
        scopeHash: oldScope,
        inputSource: "agent",
        actorAddress: oldRequest.turnContext.actorAddress,
        rulesEvaluated: ["financial.require_confirmation"],
        rulesTriggered: ["financial.require_confirmation"],
        timestamp: new Date().toISOString(),
      },
      oldRequest,
      "turn-creator-rotation",
    );
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    db.raw.prepare(
      "UPDATE policy_decisions SET lifecycle_state='approved', expires_at=?, approved_at=? WHERE id=?",
    ).run(expiresAt, new Date().toISOString(), "creator-rotation-old-approval");

    expect(claimApprovedPolicyAuthorization(db.raw, newScope)).toBeNull();
    expect(claimApprovedPolicyAuthorization(db.raw, oldScope)?.decisionId)
      .toBe("creator-rotation-old-approval");
  });
});
