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


def regex_once(path: str, pattern: str, replacement: str) -> None:
    text = read(path)
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f"{path}: expected regex once, got {count}: {pattern[:140]!r}")
    write(path, updated)


# ---------------------------------------------------------------------------
# x402: exact observed micro-USDC and conservative policy cents are distinct.
# ---------------------------------------------------------------------------
replace_once(
    "src/conway/x402.ts",
    '''export interface X402PaymentMetadata {
  amountCents: number;
  payToAddress: string;
  network: string;
  settlement: "accepted_response" | "unknown";
}
''',
    '''export interface X402PaymentMetadata {
  /** Exact observed x402 amount in USDC atomic units (6 decimals). */
  amountMicroUsdc: string;
  /** Conservative ceil-to-cent amount used only for policy accounting. */
  policyAmountCents: number;
  payToAddress: string;
  network: string;
  settlement: "accepted_response" | "unknown";
}
''',
)
replace_once(
    "src/conway/x402.ts",
    '''export function microUsdcToCents(amountAtomic: bigint): number {
  if (amountAtomic < 0n) throw new Error("USDC amount cannot be negative");
  const cents = (amountAtomic + 9_999n) / 10_000n;
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("USDC amount exceeds safe cent accounting range");
  }
  return Number(cents);
}
''',
    '''export function describeMicroUsdcAmount(amountAtomic: bigint): {
  amountMicroUsdc: string;
  policyAmountCents: number;
} {
  if (amountAtomic < 0n) throw new Error("USDC amount cannot be negative");
  const cents = (amountAtomic + 9_999n) / 10_000n;
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("USDC amount exceeds safe cent accounting range");
  }
  return {
    amountMicroUsdc: amountAtomic.toString(),
    policyAmountCents: Number(cents),
  };
}

export function microUsdcToPolicyCents(amountAtomic: bigint): number {
  return describeMicroUsdcAmount(amountAtomic).policyAmountCents;
}
''',
)
regex_once(
    "src/conway/x402.ts",
    r'''    const amountCents = microUsdcToCents\(amountAtomic\);\n    if \(maxPaymentCents !== undefined && amountCents > maxPaymentCents\) \{\n      return \{\n        success: false,\n        error: `Payment of \$\{amountCents\} cents exceeds max allowed \$\{maxPaymentCents\} cents`,\n        status: 402,\n      \};\n    \}''',
    '''    const amountDescription = describeMicroUsdcAmount(amountAtomic);
    if (
      maxPaymentCents !== undefined &&
      amountDescription.policyAmountCents > maxPaymentCents
    ) {
      return {
        success: false,
        error: `Payment policy ceiling ${amountDescription.policyAmountCents} cents exceeds max allowed ${maxPaymentCents} cents`,
        status: 402,
      };
    }''',
)
replace_once(
    "src/conway/x402.ts",
    '''    dispatchedPayment = {
      amountCents,
      payToAddress: parsed.requirement.payToAddress,
      network: parsed.requirement.network,
      settlement: "unknown",
    };
''',
    '''    dispatchedPayment = {
      ...amountDescription,
      payToAddress: parsed.requirement.payToAddress,
      network: parsed.requirement.network,
      settlement: "unknown",
    };
''',
)

# ---------------------------------------------------------------------------
# Topup: retain exact payment observation and propagate settlement ambiguity.
# ---------------------------------------------------------------------------
replace_once(
    "src/conway/topup.ts",
    'import { x402Fetch } from "./x402.js";\n',
    'import { x402Fetch, type X402PaymentMetadata } from "./x402.js";\n',
)
replace_once(
    "src/conway/topup.ts",
    '''export interface TopupResult {
  success: boolean;
  amountUsd: number;
  creditsCentsAdded?: number;
  error?: string;
}
''',
    '''export interface TopupResult {
  success: boolean;
  amountUsd: number;
  creditsCentsAdded?: number;
  error?: string;
  /** Exact x402 payment observation when a paid request was dispatched. */
  payment?: X402PaymentMetadata;
}
''',
)
replace_once(
    "src/conway/topup.ts",
    '''  if (!result.success) {
    const detail = result.error || `HTTP ${result.status}`;
    logger.error(`Credit topup failed: ${detail}`);
    throw new Error(`Credit topup failed: ${detail}`);
  }
''',
    '''  if (!result.success) {
    const detail = result.error || `HTTP ${result.status}`;
    logger.error(`Credit topup failed: ${detail}`);
    const error = new Error(`Credit topup failed: ${detail}`) as Error & {
      externalEffectOutcomeUnknown?: boolean;
    };
    if (result.payment?.settlement === "unknown") {
      error.externalEffectOutcomeUnknown = true;
    }
    throw error;
  }
''',
)
replace_once(
    "src/conway/topup.ts",
    '''  return {
    success: true,
    amountUsd,
    creditsCentsAdded,
  };
''',
    '''  return {
    success: true,
    amountUsd,
    creditsCentsAdded,
    payment: result.payment,
  };
''',
)

# ---------------------------------------------------------------------------
# Conway transfer: once a mutating POST is dispatched, transport/5xx is UNKNOWN.
# Explicit 404 may fall back to the legacy path using the same idempotency key.
# ---------------------------------------------------------------------------
replace_once(
    "src/conway/client.ts",
    '''    for (const path of paths) {
      const resp = await httpClient.request(`${apiUrl}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: apiKey,
        },
        body: JSON.stringify(payload),
        idempotencyKey,
        retries: 0, // Mutating: do not auto-retry transfers
      });

      if (!resp.ok) {
        const text = await resp.text();
        lastError = `${resp.status}: ${text}`;
        // Try next known endpoint shape before failing.
        if (resp.status === 404) continue;
        throw new Error(`Conway API error: POST ${path} -> ${lastError}`);
      }
''',
    '''    for (const path of paths) {
      let resp: Response;
      try {
        resp = await httpClient.request(`${apiUrl}${path}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: apiKey,
          },
          body: JSON.stringify(payload),
          idempotencyKey,
          retries: 0, // Mutating: do not auto-retry transfers
        });
      } catch (cause) {
        const uncertain = new Error(
          `Conway credit transfer response was not observed after dispatch: ${cause instanceof Error ? cause.message : String(cause)}`,
        ) as Error & { externalEffectOutcomeUnknown?: boolean };
        uncertain.externalEffectOutcomeUnknown = true;
        throw uncertain;
      }

      if (!resp.ok) {
        const text = await resp.text();
        lastError = `${resp.status}: ${text}`;
        if (resp.status === 404) continue;
        if (resp.status >= 500) {
          const uncertain = new Error(
            `Conway credit transfer returned ambiguous server status ${lastError}`,
          ) as Error & { externalEffectOutcomeUnknown?: boolean };
          uncertain.externalEffectOutcomeUnknown = true;
          throw uncertain;
        }
        throw new Error(`Conway API error: POST ${path} -> ${lastError}`);
      }
''',
)

# ---------------------------------------------------------------------------
# Spend evidence: x402 is a policy ceiling, not a claim of observed exact spend.
# ---------------------------------------------------------------------------
replace_once(
    "src/agent/spend-tracker.ts",
    '''          category: row.category,
          costUnit: "cent",
''',
    '''          category: row.category,
          costUnit: "cent",
          accountingSemantics:
            row.category === "x402" ? "policy_ceiling" : "observed_amount",
''',
)

# ---------------------------------------------------------------------------
# Protected tools: structural UNKNOWN propagation, exact x402 evidence,
# no fabricated balances, and a Policy-decision fallback correlation root.
# ---------------------------------------------------------------------------
replace_once(
    "src/agent/tools-core.ts",
    '''  SpendTrackerInterface,
} from "../types.js";
''',
    '''  SpendTrackerInterface,
  PolicyDecision,
} from "../types.js";
''',
)
replace_once(
    "src/agent/tools-core.ts",
    'import { correlationIdFor, runWithEvidenceContext } from "../observability/evidence.js";\n',
    'import { appendEvidenceEvent, correlationIdFor, currentEvidenceContext, latestEvidenceByAuthority, runWithEvidenceContext } from "../observability/evidence.js";\n',
)
replace_once(
    "src/agent/tools-core.ts",
    '''class ExternalEffectOutcomeUnknownError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExternalEffectOutcomeUnknownError";
  }
}
''',
    '''class ExternalEffectOutcomeUnknownError extends Error {
  readonly externalEffectOutcomeUnknown = true;

  constructor(message: string) {
    super(message);
    this.name = "ExternalEffectOutcomeUnknownError";
  }
}

function isExternalEffectOutcomeUnknown(error: unknown): boolean {
  return error instanceof ExternalEffectOutcomeUnknownError || (
    typeof error === "object" &&
    error !== null &&
    (error as { externalEffectOutcomeUnknown?: unknown }).externalEffectOutcomeUnknown === true
  );
}
''',
)

# Direct transfer: the provider's observed balance is authoritative; absence stays UNKNOWN/null.
replace_once(
    "src/agent/tools-core.ts",
    '''            balanceAfterCents:
              transfer.balanceAfterCents ?? Math.max(balance - amount, 0),
''',
    '''            balanceAfterCents: transfer.balanceAfterCents,
''',
)
# Child funding has the same balance semantics; replace its remaining fallback exactly once.
replace_once(
    "src/agent/tools-core.ts",
    '''              balanceAfterCents:
                transfer.balanceAfterCents ?? Math.max(balance - amount, 0),
''',
    '''              balanceAfterCents: transfer.balanceAfterCents,
''',
)

replace_once(
    "src/agent/tools-core.ts",
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
''',
    '''        // The external purchase has succeeded. Preserve the exact x402
        // observation separately from any cent-denominated local projection.
        try {
          const { ulid } = await import("ulid");
          const transactionId = ulid();
          const paymentAtomic = result.payment
            ? BigInt(result.payment.amountMicroUsdc)
            : null;
          const exactWholeCents = paymentAtomic !== null && paymentAtomic % 10_000n === 0n
            ? Number(paymentAtomic / 10_000n)
            : undefined;
          ctx.db.insertTransaction({
            id: transactionId,
            type: "credit_purchase",
            amountCents: exactWholeCents,
            balanceAfterCents: undefined,
            description: `x402 credit topup requested tier: $${amountUsd} USD`,
            timestamp: new Date().toISOString(),
          });
          const evidence = currentEvidenceContext();
          if (evidence && result.payment) {
            const transactionEvent = latestEvidenceByAuthority(
              ctx.db.raw,
              "financial_transaction",
              transactionId,
            );
            appendEvidenceEvent(ctx.db.raw, {
              correlationId: evidence.correlationId,
              causationId: transactionEvent?.id ?? evidence.causationId ?? null,
              eventType: "economic.x402_payment_observed",
              domain: "economic",
              authorityType: "financial_transaction",
              authorityId: transactionId,
              goalId: evidence.goalId ?? null,
              taskId: evidence.taskId ?? null,
              turnId: evidence.turnId ?? null,
              toolCallId: evidence.toolCallId ?? null,
              epistemicStatus: "observation",
              payload: {
                amountMicroUsdc: result.payment.amountMicroUsdc,
                amountUnit: "micro-USDC",
                policyAmountCents: result.payment.policyAmountCents,
                policyUnit: "cent",
                policyRounding: "ceil",
              },
              provenance: { source: "x402" },
            });
          }
        } catch (error) {
          throw new ExternalEffectOutcomeUnknownError(
            `Credit topup completed externally but local accounting failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
''',
)

replace_once(
    "src/agent/tools-core.ts",
    '''            const { ulid } = await import("ulid");
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
''',
    '''            const { ulid } = await import("ulid");
            const transactionId = ulid();
            const paymentAtomic = BigInt(result.payment.amountMicroUsdc);
            const exactWholeCents = paymentAtomic % 10_000n === 0n
              ? Number(paymentAtomic / 10_000n)
              : undefined;
            ctx.db.insertTransaction({
              id: transactionId,
              type: "tool_use",
              amountCents: exactWholeCents,
              description: `x402 paid request to ${new URL(url).hostname}`,
              timestamp: new Date().toISOString(),
            });
            const evidence = currentEvidenceContext();
            if (evidence) {
              const transactionEvent = latestEvidenceByAuthority(
                ctx.db.raw,
                "financial_transaction",
                transactionId,
              );
              appendEvidenceEvent(ctx.db.raw, {
                correlationId: evidence.correlationId,
                causationId: transactionEvent?.id ?? evidence.causationId ?? null,
                eventType: "economic.x402_payment_observed",
                domain: "economic",
                authorityType: "financial_transaction",
                authorityId: transactionId,
                goalId: evidence.goalId ?? null,
                taskId: evidence.taskId ?? null,
                turnId: evidence.turnId ?? null,
                toolCallId: evidence.toolCallId ?? null,
                epistemicStatus: "observation",
                payload: {
                  amountMicroUsdc: result.payment.amountMicroUsdc,
                  amountUnit: "micro-USDC",
                  policyAmountCents: result.payment.policyAmountCents,
                  policyUnit: "cent",
                  policyRounding: "ceil",
                },
                provenance: { source: "x402" },
              });
            }
            ctx.spendTracker?.recordSpend({
              toolName: "x402_fetch",
              amountCents: result.payment.policyAmountCents,
              domain: new URL(url).hostname,
              category: "x402",
            });
''',
)

replace_once(
    "src/agent/tools-core.ts",
    '''async function executeToolProtected(
  toolName: string,
  args: Record<string, unknown>,
  tools: AbosTool[],
  context: ToolContext,
  policyEngine?: PolicyEngine,
  turnContext?: PolicyRequest["turnContext"],
): Promise<ToolCallResult> {
''',
    '''async function executeToolProtected(
  toolName: string,
  args: Record<string, unknown>,
  tools: AbosTool[],
  context: ToolContext,
  policyEngine?: PolicyEngine,
  turnContext?: PolicyRequest["turnContext"],
  preEvaluatedDecision?: PolicyDecision,
): Promise<ToolCallResult> {
''',
)
replace_once(
    "src/agent/tools-core.ts",
    '''  const request: PolicyRequest = { tool, args, context, turnContext };
  const decision = policyEngine.evaluate(request);
  if (!decision.id) {
    return {
      id: ulid(),
      name: toolName,
      arguments: args,
      result: "",
      durationMs: Date.now() - startTime,
      error: "Policy evaluation failed closed: durable decision id missing",
    };
  }

  try {
''',
    '''  const request: PolicyRequest = { tool, args, context, turnContext };
  const decision = preEvaluatedDecision ?? policyEngine.evaluate(request);
  if (!decision.id) {
    return {
      id: ulid(),
      name: toolName,
      arguments: args,
      result: "",
      durationMs: Date.now() - startTime,
      error: "Policy evaluation failed closed: durable decision id missing",
    };
  }

  if (!currentEvidenceContext()) {
    return runWithEvidenceContext(
      { correlationId: correlationIdFor("policy_decision", decision.id) },
      () => executeToolProtected(
        toolName,
        args,
        tools,
        context,
        policyEngine,
        turnContext,
        decision,
      ),
    );
  }

  try {
''',
)
replace_once(
    "src/agent/tools-core.ts",
    '''      if (err instanceof ExternalEffectOutcomeUnknownError) {
''',
    '''      if (isExternalEffectOutcomeUnknown(err)) {
''',
)

# ---------------------------------------------------------------------------
# Generated economic tests: exact observation != policy ceiling; add fallback
# root and ambiguous transport regressions.
# ---------------------------------------------------------------------------
replace_once(
    "src/__tests__/p013-economic-correlation.test.ts",
    'import { microUsdcToCents } from "../conway/x402.js";\n',
    'import { describeMicroUsdcAmount, microUsdcToPolicyCents } from "../conway/x402.js";\n',
)
replace_once(
    "src/__tests__/p013-economic-correlation.test.ts",
    '''  it("converts micro-USDC to integer cents conservatively without unsafe bigint coercion", () => {
    expect(microUsdcToCents(0n)).toBe(0);
    expect(microUsdcToCents(1n)).toBe(1);
    expect(microUsdcToCents(10_000n)).toBe(1);
    expect(microUsdcToCents(10_001n)).toBe(2);
    expect(() => microUsdcToCents(BigInt(Number.MAX_SAFE_INTEGER) * 10_000n + 1n)).toThrow(/safe cent accounting range/);
  });
''',
    '''  it("keeps exact micro-USDC observation separate from conservative policy cents", () => {
    expect(describeMicroUsdcAmount(0n)).toEqual({ amountMicroUsdc: "0", policyAmountCents: 0 });
    expect(describeMicroUsdcAmount(1n)).toEqual({ amountMicroUsdc: "1", policyAmountCents: 1 });
    expect(describeMicroUsdcAmount(10_000n)).toEqual({ amountMicroUsdc: "10000", policyAmountCents: 1 });
    expect(describeMicroUsdcAmount(10_001n)).toEqual({ amountMicroUsdc: "10001", policyAmountCents: 2 });
    expect(microUsdcToPolicyCents(1n)).toBe(1);
    expect(() => microUsdcToPolicyCents(BigInt(Number.MAX_SAFE_INTEGER) * 10_000n + 1n)).toThrow(/safe cent accounting range/);
  });

  it("roots a protected background financial execution in its durable Policy decision", async () => {
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
    const result = await executeTool("transfer_credits", {
      to_address: "0x6666666666666666666666666666666666666666",
      amount_cents: 100,
    }, createBuiltinTools(context.identity.sandboxId), context, policy, {
      inputSource: "system",
      turnToolCallCount: 0,
      sessionSpend: spend,
    });
    expect(result.error).toBeUndefined();
    const row = db.raw.prepare(
      "SELECT id FROM policy_decisions WHERE tool_name = 'transfer_credits' ORDER BY created_at DESC LIMIT 1",
    ).get() as { id: string };
    const events = getEvidenceByCorrelation(db.raw, `policy_decision:${row.id}`);
    expect(events.some((event) => event.authorityType === "policy_decision" && event.authorityId === row.id)).toBe(true);
    expect(events.some((event) => event.authorityType === "financial_transaction")).toBe(true);
  });

  it("classifies an ambiguous transfer transport outcome as Policy UNKNOWN", async () => {
    const { db, spend } = setup();
    const conway = new MockConwayClient();
    vi.spyOn(conway, "transferCredits").mockImplementation(async () => {
      const error = new Error("response lost after dispatch") as Error & { externalEffectOutcomeUnknown?: boolean };
      error.externalEffectOutcomeUnknown = true;
      throw error;
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
      to_address: "0x5555555555555555555555555555555555555555",
      amount_cents: 100,
    }, createBuiltinTools(context.identity.sandboxId), context, policy, {
      inputSource: "system",
      correlationId: "goal:goal-p013-transfer-transport-unknown",
      turnToolCallCount: 0,
      sessionSpend: spend,
    });
    expect(result.error).toMatch(/do not retry blindly/i);
    const row = db.raw.prepare(
      "SELECT execution_state FROM policy_decisions WHERE tool_name = 'transfer_credits' ORDER BY created_at DESC LIMIT 1",
    ).get() as { execution_state: string };
    expect(row.execution_state).toBe("unknown");
  });
''',
)
