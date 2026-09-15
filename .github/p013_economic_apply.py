from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, text: str) -> None:
    (ROOT / path).write_text(text, encoding="utf-8")


def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected block once, got {count}: {old[:140]!r}")
    write(path, text.replace(old, new, 1))


# ---------------------------------------------------------------------------
# Canonical transactions -> P-013 evidence, atomic when causal context exists.
# ---------------------------------------------------------------------------
replace_once(
    "src/state/database.ts",
    'import { createLogger } from "../observability/logger.js";\n',
    'import { createLogger } from "../observability/logger.js";\nimport { appendEvidenceEvent, currentEvidenceContext } from "../observability/evidence.js";\n',
)
replace_once(
    "src/state/database.ts",
    '''  const insertTransaction = (txn: Transaction): void => {
    db.prepare(
      `INSERT INTO transactions (id, type, amount_cents, balance_after_cents, description)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      txn.id,
      txn.type,
      txn.amountCents ?? null,
      txn.balanceAfterCents ?? null,
      txn.description,
    );
  };
''',
    '''  const insertTransaction = (txn: Transaction): void => {
    const insert = () => db.prepare(
      `INSERT INTO transactions (id, type, amount_cents, balance_after_cents, description)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      txn.id,
      txn.type,
      txn.amountCents ?? null,
      txn.balanceAfterCents ?? null,
      txn.description,
    );

    const context = currentEvidenceContext();
    if (!context) {
      insert();
      return;
    }

    db.transaction(() => {
      insert();
      appendEvidenceEvent(db, {
        correlationId: context.correlationId,
        causationId: context.causationId ?? null,
        eventType: "economic.transaction_recorded",
        domain: "economic",
        authorityType: "financial_transaction",
        authorityId: txn.id,
        goalId: context.goalId ?? null,
        taskId: context.taskId ?? null,
        turnId: context.turnId ?? null,
        toolCallId: context.toolCallId ?? null,
        epistemicStatus: "observation",
        payload: {
          type: txn.type,
          amountCents: txn.amountCents ?? null,
          balanceAfterCents: txn.balanceAfterCents ?? null,
          costUnit: "cent",
        },
        provenance: { source: "transactions" },
      });
    })();
  };
''',
)

# ---------------------------------------------------------------------------
# Spend policy ledger -> P-013 evidence, preserving legacy/direct no-context use.
# ---------------------------------------------------------------------------
replace_once(
    "src/agent/spend-tracker.ts",
    'import type { SpendTrackingRow } from "../state/database.js";\n',
    'import type { SpendTrackingRow } from "../state/database.js";\nimport { appendEvidenceEvent, currentEvidenceContext } from "../observability/evidence.js";\n',
)
replace_once(
    "src/agent/spend-tracker.ts",
    '''    insertSpendRecord(this.db, row);
  }
''',
    '''    const context = currentEvidenceContext();
    if (!context) {
      insertSpendRecord(this.db, row);
      return;
    }

    this.db.transaction(() => {
      insertSpendRecord(this.db, row);
      appendEvidenceEvent(this.db, {
        correlationId: context.correlationId,
        causationId: context.causationId ?? null,
        eventType: "economic.spend_recorded",
        domain: "economic",
        authorityType: "spend_tracking",
        authorityId: row.id,
        goalId: context.goalId ?? null,
        taskId: context.taskId ?? null,
        turnId: context.turnId ?? null,
        toolCallId: context.toolCallId ?? null,
        epistemicStatus: "observation",
        payload: {
          toolName: row.toolName,
          amountCents: row.amountCents,
          category: row.category,
          costUnit: "cent",
        },
        provenance: { source: "spend_tracking" },
      });
    })();
  }
''',
)

# ---------------------------------------------------------------------------
# Make the per-execution SpendTracker available at the actual effect boundary.
# ---------------------------------------------------------------------------
replace_once(
    "src/types.ts",
    '''export interface ToolContext {
  identity: AbosIdentity;
  config: AbosConfig;
  db: AbosDatabase;
  conway: ConwayClient;
  inference: InferenceClient;
  social?: SocialClientInterface;
}
''',
    '''export interface ToolContext {
  identity: AbosIdentity;
  config: AbosConfig;
  db: AbosDatabase;
  conway: ConwayClient;
  inference: InferenceClient;
  social?: SocialClientInterface;
  /** Runtime-scoped policy accounting authority for economic effects. */
  spendTracker?: SpendTrackerInterface;
}
''',
)

# ---------------------------------------------------------------------------
# Financial effect semantics in tools-core.
# ---------------------------------------------------------------------------
replace_once(
    "src/agent/tools-core.ts",
    'const logger = createLogger("tools");\n',
    '''const logger = createLogger("tools");

class ExternalEffectOutcomeUnknownError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExternalEffectOutcomeUnknownError";
  }
}
''',
)

# Topup: external success followed by local accounting failure must not become a retryable failure.
replace_once(
    "src/agent/tools-core.ts",
    '''        // Record transaction
        const { ulid } = await import("ulid");
        ctx.db.insertTransaction({
          id: ulid(),
          type: "credit_purchase",
          amountCents: amountUsd * 100,
          balanceAfterCents: result.creditsCentsAdded,
          description: `x402 credit topup: $${amountUsd} USD`,
          timestamp: new Date().toISOString(),
        });

        return `Credit topup successful: +$${amountUsd} (${amountUsd * 100} cents) credits purchased via x402. Check your new balance with check_credits.`;
''',
    '''        // The external purchase has succeeded. Local accounting/evidence
        // failure is therefore UNKNOWN, never a reason to buy credits again.
        try {
          const { ulid } = await import("ulid");
          ctx.db.insertTransaction({
            id: ulid(),
            type: "credit_purchase",
            amountCents: amountUsd * 100,
            balanceAfterCents: result.creditsCentsAdded,
            description: `x402 credit topup: $${amountUsd} USD`,
            timestamp: new Date().toISOString(),
          });
        } catch (error) {
          throw new ExternalEffectOutcomeUnknownError(
            `Credit topup completed externally but local accounting failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }

        return `Credit topup successful: +$${amountUsd} (${amountUsd * 100} cents) credits purchased via x402. Check your new balance with check_credits.`;
''',
)

# Direct transfer: reject explicit provider rejection, then persist actual transaction + spend.
replace_once(
    "src/agent/tools-core.ts",
    '''        const transfer = await ctx.conway.transferCredits(
          args.to_address as string,
          amount,
          args.reason as string | undefined,
        );

        const { ulid } = await import("ulid");
        ctx.db.insertTransaction({
          id: ulid(),
          type: "transfer_out",
          amountCents: amount,
          balanceAfterCents:
            transfer.balanceAfterCents ?? Math.max(balance - amount, 0),
          description: `Transfer to ${args.to_address}: ${args.reason || ""}`,
          timestamp: new Date().toISOString(),
        });

        return `Credit transfer submitted: $${(amount / 100).toFixed(2)} to ${transfer.toAddress} (status: ${transfer.status}, id: ${transfer.transferId || "n/a"})`;
''',
    '''        const transfer = await ctx.conway.transferCredits(
          args.to_address as string,
          amount,
          args.reason as string | undefined,
        );

        if (!isCreditTransferAccepted(transfer.status)) {
          return `Credit transfer was not accepted (status: ${transfer.status || "unknown"}). No local transfer was recorded.`;
        }

        // The provider accepted the external effect. Persist the canonical
        // transaction first, then policy spend accounting. If either local
        // authority cannot commit, never invite a duplicate transfer.
        try {
          const { ulid } = await import("ulid");
          ctx.db.insertTransaction({
            id: ulid(),
            type: "transfer_out",
            amountCents: amount,
            balanceAfterCents:
              transfer.balanceAfterCents ?? Math.max(balance - amount, 0),
            description: `Transfer to ${args.to_address}: ${args.reason || ""}`,
            timestamp: new Date().toISOString(),
          });
          ctx.spendTracker?.recordSpend({
            toolName: "transfer_credits",
            amountCents: amount,
            recipient: args.to_address as string,
            category: "transfer",
          });
        } catch (error) {
          throw new ExternalEffectOutcomeUnknownError(
            `Credit transfer was accepted externally but local accounting failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }

        return `Credit transfer submitted: $${(amount / 100).toFixed(2)} to ${transfer.toAddress} (status: ${transfer.status}, id: ${transfer.transferId || "n/a"})`;
''',
)

# Child funding already recognizes external success; propagate local failure as UNKNOWN to Policy.
replace_once(
    "src/agent/tools-core.ts",
    '''        if (!localPersistenceOk) {
          return `Funding transfer ${transfer.transferId || "unknown"} completed for child ${child.name}, but local capital bookkeeping failed. Do not retry the transfer blindly; reconcile the external transfer first.`;
        }
''',
    '''        if (!localPersistenceOk) {
          throw new ExternalEffectOutcomeUnknownError(
            `Child funding transfer ${transfer.transferId || "unknown"} completed externally but local capital bookkeeping failed.`,
          );
        }
''',
)

# x402 tool: account only a confirmed paid response; unknown paid dispatch stays UNKNOWN.
replace_once(
    "src/agent/tools-core.ts",
    '''        if (!result.success) {
          return `x402 fetch failed: ${result.error || "Unknown error"}`;
        }

        const responseStr =
''',
    '''        if (!result.success) {
          if (result.payment?.settlement === "unknown") {
            throw new ExternalEffectOutcomeUnknownError(
              "x402 paid request was dispatched but settlement is unknown.",
            );
          }
          return `x402 fetch failed: ${result.error || "Unknown error"}`;
        }

        if (result.payment?.settlement === "accepted_response") {
          try {
            const { ulid } = await import("ulid");
            ctx.db.insertTransaction({
              id: ulid(),
              type: "tool_use",
              amountCents: result.payment.amountCents,
              description: `x402 paid request to ${new URL(url).hostname}`,
              timestamp: new Date().toISOString(),
            });
            ctx.spendTracker?.recordSpend({
              toolName: "x402_fetch",
              amountCents: result.payment.amountCents,
              domain: new URL(url).hostname,
              category: "x402",
            });
          } catch (error) {
            throw new ExternalEffectOutcomeUnknownError(
              `x402 payment was accepted but local accounting failed: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }

        const responseStr =
''',
)

# Inject scoped spend authority into the tool and classify post-effect failures as UNKNOWN.
replace_once(
    "src/agent/tools-core.ts",
    '''  try {
    let result: string;
    try {
      result = await tool.execute(args, context);
    } catch (err: any) {
      try {
        policyEngine.recordExecution(decision.id, "failed", { error: err?.message || String(err) });
      } catch {
        // Preserve the original tool failure; the pre-effect running record remains durable evidence.
      }
      return {
        id: ulid(),
        name: toolName,
        arguments: args,
        result: "",
        durationMs: Date.now() - startTime,
        error: err?.message || String(err),
      };
    }
''',
    '''  try {
    let result: string;
    const executionContext: ToolContext = turnContext.sessionSpend
      ? { ...context, spendTracker: turnContext.sessionSpend }
      : context;
    try {
      result = await tool.execute(args, executionContext);
    } catch (err: any) {
      if (err instanceof ExternalEffectOutcomeUnknownError) {
        try {
          policyEngine.recordExecution(decision.id, "unknown", {
            reason: "external_effect_or_settlement_unknown",
            toolName,
          });
        } catch {
          // The running claim remains durable; do not mask the original uncertainty.
        }
        return {
          id: ulid(),
          name: toolName,
          arguments: args,
          result: "",
          durationMs: Date.now() - startTime,
          error: `${err.message} External effect may already have occurred; do not retry blindly.`,
        };
      }
      try {
        policyEngine.recordExecution(decision.id, "failed", { error: err?.message || String(err) });
      } catch {
        // Preserve the original tool failure; the pre-effect running record remains durable evidence.
      }
      return {
        id: ulid(),
        name: toolName,
        arguments: args,
        result: "",
        durationMs: Date.now() - startTime,
        error: err?.message || String(err),
      };
    }
''',
)

# Remove the old post-hook which double-counted transfers and invented x402=0.
tools = read("src/agent/tools-core.ts")
pattern = re.compile(
    r'''\n    // Record spend for financial operations\n    if \(turnContext\.sessionSpend && !result\.startsWith\("Blocked:"\)\) \{.*?\n    \}\n\n    try \{\n      policyEngine\.recordExecution''',
    re.S,
)
match = pattern.search(tools)
if not match:
    raise RuntimeError("tools-core: generic financial post-hook block not found")
tools = tools[:match.start()] + '''\n\n    try {\n      policyEngine.recordExecution''' + tools[match.end():]
write("src/agent/tools-core.ts", tools)

# ---------------------------------------------------------------------------
# x402 exact accounting and settlement epistemics.
# ---------------------------------------------------------------------------
replace_once(
    "src/conway/x402.ts",
    '''interface X402PaymentResult {
  success: boolean;
  response?: any;
  error?: string;
  status?: number;
}
''',
    '''export interface X402PaymentMetadata {
  amountCents: number;
  payToAddress: string;
  network: string;
  settlement: "accepted_response" | "unknown";
}

export interface X402PaymentResult {
  success: boolean;
  response?: any;
  error?: string;
  status?: number;
  /** Present only after a signed paid request was dispatched. */
  payment?: X402PaymentMetadata;
}
''',
)
replace_once(
    "src/conway/x402.ts",
    '''function parseMaxAmountRequired(maxAmountRequired: string, x402Version: number): bigint {
''',
    '''export function microUsdcToCents(amountAtomic: bigint): number {
  if (amountAtomic < 0n) throw new Error("USDC amount cannot be negative");
  const cents = (amountAtomic + 9_999n) / 10_000n;
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("USDC amount exceeds safe cent accounting range");
  }
  return Number(cents);
}

function parseMaxAmountRequired(maxAmountRequired: string, x402Version: number): bigint {
''',
)
replace_once(
    "src/conway/x402.ts",
    '''  try {
    // Initial request (non-mutating probe, uses resilient client)
''',
    '''  let dispatchedPayment: X402PaymentMetadata | undefined;
  try {
    // Initial request (non-mutating probe, uses resilient client)
''',
)
replace_once(
    "src/conway/x402.ts",
    '''    // Check amount against maxPaymentCents BEFORE signing
    if (maxPaymentCents !== undefined) {
      const amountAtomic = parseMaxAmountRequired(
        parsed.requirement.maxAmountRequired,
        parsed.x402Version,
      );
      // Convert atomic units (6 decimals) to cents (2 decimals)
      const amountCents = Number(amountAtomic) / 10_000;
      if (amountCents > maxPaymentCents) {
        return {
          success: false,
          error: `Payment of ${amountCents.toFixed(2)} cents exceeds max allowed ${maxPaymentCents} cents`,
          status: 402,
        };
      }
    }
''',
    '''    // Calculate exact policy accounting before signing. Round fractional
    // cents up conservatively and never coerce an unsafe bigint to Number.
    const amountAtomic = parseMaxAmountRequired(
      parsed.requirement.maxAmountRequired,
      parsed.x402Version,
    );
    const amountCents = microUsdcToCents(amountAtomic);
    if (maxPaymentCents !== undefined && amountCents > maxPaymentCents) {
      return {
        success: false,
        error: `Payment of ${amountCents} cents exceeds max allowed ${maxPaymentCents} cents`,
        status: 402,
      };
    }
''',
)
replace_once(
    "src/conway/x402.ts",
    '''    const paidResp = await x402HttpClient.request(url, {
''',
    '''    dispatchedPayment = {
      amountCents,
      payToAddress: parsed.requirement.payToAddress,
      network: parsed.requirement.network,
      settlement: "unknown",
    };

    const paidResp = await x402HttpClient.request(url, {
''',
)
replace_once(
    "src/conway/x402.ts",
    '''    const data = await paidResp.json().catch(() => paidResp.text());
    return { success: paidResp.ok, response: data, status: paidResp.status };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
''',
    '''    const data = await paidResp.json().catch(() => paidResp.text());
    return {
      success: paidResp.ok,
      response: data,
      status: paidResp.status,
      payment: {
        ...dispatchedPayment,
        settlement: paidResp.ok ? "accepted_response" : "unknown",
      },
    };
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || String(err),
      payment: dispatchedPayment,
    };
  }
''',
)

# ---------------------------------------------------------------------------
# Tests: canonical authorities, fault injection, protected transfer, exact x402 cents.
# ---------------------------------------------------------------------------
test = r'''import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestConfig, createTestDb, createTestIdentity, MockConwayClient, MockInferenceClient } from "./mocks.js";
import { SpendTracker } from "../agent/spend-tracker.js";
import { PolicyEngine } from "../agent/policy-engine.js";
import { createBuiltinTools, executeTool } from "../agent/tools-core.js";
import { getEvidenceByCorrelation, runWithEvidenceContext } from "../observability/evidence.js";
import { microUsdcToCents } from "../conway/x402.js";
import type { AbosDatabase, ToolContext } from "../types.js";

const dbs: AbosDatabase[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) {
    try { db.close(); } catch { /* already closed */ }
  }
});

function setup() {
  const db = createTestDb();
  dbs.push(db);
  const spend = new SpendTracker(db.raw);
  return { db, spend };
}

function causalContext<T>(fn: () => T): T {
  return runWithEvidenceContext({
    correlationId: "goal:goal-p013-economic",
    goalId: "goal-p013-economic",
    taskId: "task-p013-economic",
    turnId: "turn-p013-economic",
    toolCallId: "tool-call-p013-economic",
  }, fn);
}

describe("P-013 economic evidence correlation", () => {
  it("atomically references canonical transactions without copying descriptions", () => {
    const { db } = setup();
    causalContext(() => db.insertTransaction({
      id: "txn-p013-economic",
      type: "transfer_out",
      amountCents: 250,
      balanceAfterCents: 9750,
      description: "sensitive recipient detail canonical-only-p013",
      timestamp: new Date().toISOString(),
    }));

    const events = getEvidenceByCorrelation(db.raw, "goal:goal-p013-economic");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      eventType: "economic.transaction_recorded",
      authorityType: "financial_transaction",
      authorityId: "txn-p013-economic",
    });
    expect(events[0]?.payload).toMatchObject({ amountCents: 250, costUnit: "cent" });
    expect(JSON.stringify(events)).not.toContain("sensitive recipient detail canonical-only-p013");
  });

  it("atomically references spend-policy rows while keeping recipient/domain canonical", () => {
    const { db, spend } = setup();
    causalContext(() => spend.recordSpend({
      toolName: "transfer_credits",
      amountCents: 325,
      recipient: "recipient-sensitive-p013",
      domain: "domain-sensitive-p013.test",
      category: "transfer",
    }));

    const row = db.raw.prepare("SELECT id, amount_cents FROM spend_tracking LIMIT 1").get() as { id: string; amount_cents: number };
    const events = getEvidenceByCorrelation(db.raw, "goal:goal-p013-economic");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      eventType: "economic.spend_recorded",
      authorityType: "spend_tracking",
      authorityId: row.id,
    });
    expect(row.amount_cents).toBe(325);
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain("recipient-sensitive-p013");
    expect(serialized).not.toContain("domain-sensitive-p013.test");
  });

  it("rolls back a canonical transaction when its critical evidence cannot commit", () => {
    const { db } = setup();
    db.raw.exec(`
      CREATE TRIGGER reject_p013_transaction_evidence
      BEFORE INSERT ON evidence_events
      WHEN NEW.event_type = 'economic.transaction_recorded'
      BEGIN
        SELECT RAISE(ABORT, 'intentional economic evidence failure');
      END;
    `);
    expect(() => causalContext(() => db.insertTransaction({
      id: "txn-p013-rollback",
      type: "transfer_out",
      amountCents: 100,
      description: "rollback probe",
      timestamp: new Date().toISOString(),
    }))).toThrow("intentional economic evidence failure");
    const row = db.raw.prepare("SELECT id FROM transactions WHERE id = ?").get("txn-p013-rollback");
    expect(row).toBeUndefined();
  });

  it("correlates one accepted transfer to transaction + spend authorities and Policy success", async () => {
    const { db, spend } = setup();
    const conway = new MockConwayClient();
    const context: ToolContext = {
      identity: createTestIdentity(),
      config: createTestConfig(),
      db,
      conway,
      inference: new MockInferenceClient(),
    };
    const policy = new PolicyEngine(db.raw, []);
    const tools = createBuiltinTools(context.identity.sandboxId);
    const transferSpy = vi.spyOn(conway, "transferCredits");

    const result = await executeTool("transfer_credits", {
      to_address: "0x9999999999999999999999999999999999999999",
      amount_cents: 500,
      reason: "P-013 test",
    }, tools, context, policy, {
      inputSource: "system",
      correlationId: "goal:goal-p013-economic-transfer",
      goalId: "goal-p013-economic-transfer",
      taskId: "task-p013-economic-transfer",
      turnId: "turn-p013-economic-transfer",
      toolCallId: "tool-call-p013-economic-transfer",
      turnToolCallCount: 0,
      sessionSpend: spend,
    });

    expect(result.error).toBeUndefined();
    expect(transferSpy).toHaveBeenCalledTimes(1);
    const txn = db.raw.prepare("SELECT id, amount_cents FROM transactions WHERE type = 'transfer_out'").get() as { id: string; amount_cents: number };
    const spendRow = db.raw.prepare("SELECT id, amount_cents FROM spend_tracking WHERE category = 'transfer'").get() as { id: string; amount_cents: number };
    expect(txn.amount_cents).toBe(500);
    expect(spendRow.amount_cents).toBe(500);
    const events = getEvidenceByCorrelation(db.raw, "goal:goal-p013-economic-transfer");
    expect(events.some((event) => event.authorityType === "financial_transaction" && event.authorityId === txn.id)).toBe(true);
    expect(events.some((event) => event.authorityType === "spend_tracking" && event.authorityId === spendRow.id)).toBe(true);
    const policyRow = db.raw.prepare("SELECT execution_state FROM policy_decisions ORDER BY created_at DESC LIMIT 1").get() as { execution_state: string };
    expect(policyRow.execution_state).toBe("succeeded");
  });

  it("marks Policy UNKNOWN and does not repeat an accepted transfer when spend evidence fails", async () => {
    const { db, spend } = setup();
    const conway = new MockConwayClient();
    const context: ToolContext = {
      identity: createTestIdentity(),
      config: createTestConfig(),
      db,
      conway,
      inference: new MockInferenceClient(),
    };
    const policy = new PolicyEngine(db.raw, []);
    const tools = createBuiltinTools(context.identity.sandboxId);
    const transferSpy = vi.spyOn(conway, "transferCredits");
    db.raw.exec(`
      CREATE TRIGGER reject_p013_spend_evidence
      BEFORE INSERT ON evidence_events
      WHEN NEW.event_type = 'economic.spend_recorded'
      BEGIN
        SELECT RAISE(ABORT, 'intentional spend evidence failure');
      END;
    `);

    const result = await executeTool("transfer_credits", {
      to_address: "0x8888888888888888888888888888888888888888",
      amount_cents: 400,
      reason: "fault injection",
    }, tools, context, policy, {
      inputSource: "system",
      correlationId: "goal:goal-p013-economic-unknown",
      goalId: "goal-p013-economic-unknown",
      turnId: "turn-p013-economic-unknown",
      toolCallId: "tool-call-p013-economic-unknown",
      turnToolCallCount: 0,
      sessionSpend: spend,
    });

    expect(transferSpy).toHaveBeenCalledTimes(1);
    expect(result.error).toMatch(/do not retry blindly/i);
    const txnCount = db.raw.prepare("SELECT COUNT(*) AS count FROM transactions WHERE type = 'transfer_out'").get() as { count: number };
    const spendCount = db.raw.prepare("SELECT COUNT(*) AS count FROM spend_tracking").get() as { count: number };
    expect(txnCount.count).toBe(1);
    expect(spendCount.count).toBe(0);
    const policyRow = db.raw.prepare("SELECT execution_state FROM policy_decisions ORDER BY created_at DESC LIMIT 1").get() as { execution_state: string };
    expect(policyRow.execution_state).toBe("unknown");
  });

  it("does not invent a local transfer when the provider explicitly rejects it", async () => {
    const { db, spend } = setup();
    const conway = new MockConwayClient();
    vi.spyOn(conway, "transferCredits").mockResolvedValue({
      transferId: "rejected-p013",
      status: "rejected",
      toAddress: "0x7777777777777777777777777777777777777777",
      amountCents: 200,
      balanceAfterCents: conway.creditsCents,
    });
    const context: ToolContext = {
      identity: createTestIdentity(),
      config: createTestConfig(),
      db,
      conway,
      inference: new MockInferenceClient(),
    };
    const policy = new PolicyEngine(db.raw, []);
    const result = await executeTool("transfer_credits", {
      to_address: "0x7777777777777777777777777777777777777777",
      amount_cents: 200,
    }, createBuiltinTools(context.identity.sandboxId), context, policy, {
      inputSource: "system",
      correlationId: "goal:goal-p013-economic-rejected",
      goalId: "goal-p013-economic-rejected",
      turnId: "turn-p013-economic-rejected",
      toolCallId: "tool-call-p013-economic-rejected",
      turnToolCallCount: 0,
      sessionSpend: spend,
    });
    expect(result.error).toBeUndefined();
    expect(result.result).toMatch(/not accepted/i);
    expect((db.raw.prepare("SELECT COUNT(*) AS count FROM transactions").get() as { count: number }).count).toBe(0);
    expect((db.raw.prepare("SELECT COUNT(*) AS count FROM spend_tracking").get() as { count: number }).count).toBe(0);
  });

  it("converts micro-USDC to integer cents conservatively without unsafe bigint coercion", () => {
    expect(microUsdcToCents(0n)).toBe(0);
    expect(microUsdcToCents(1n)).toBe(1);
    expect(microUsdcToCents(10_000n)).toBe(1);
    expect(microUsdcToCents(10_001n)).toBe(2);
    expect(() => microUsdcToCents(BigInt(Number.MAX_SAFE_INTEGER) * 10_000n + 1n)).toThrow(/safe cent accounting range/);
  });
});
'''
write("src/__tests__/p013-economic-correlation.test.ts", test)
