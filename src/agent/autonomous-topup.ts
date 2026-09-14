import type {
  AbosConfig,
  AbosDatabase,
  AbosIdentity,
  AbosTool,
  ConwayClient,
  InferenceClient,
  SocialClientInterface,
  SpendTrackerInterface,
  ToolCallResult,
} from "../types.js";
import type { PolicyEngine } from "./policy-engine.js";
import { createBuiltinTools, executeTool } from "./tools.js";
import {
  planAutonomousTopup,
  type AutonomousTopupPlan,
} from "../conway/topup.js";
import { getUsdcBalanceDetailed } from "../conway/x402.js";

export type AutonomousTopupExecutionStatus =
  | "executed"
  | "no_action"
  | "cooldown"
  | "unresolved_previous_effect"
  | "policy_or_execution_error"
  | "evidence_unavailable";

export interface AutonomousTopupExecutionResult {
  status: AutonomousTopupExecutionStatus;
  plan: AutonomousTopupPlan;
  toolResult?: ToolCallResult;
  evidence: string[];
}

export interface AutonomousTopupExecutionOptions {
  identity: AbosIdentity;
  config: AbosConfig;
  db: AbosDatabase;
  conway: ConwayClient;
  inference: InferenceClient;
  social?: SocialClientInterface;
  policyEngine: PolicyEngine;
  spendTracker?: SpendTrackerInterface;
  source: "startup" | "runtime_recovery";
  tools?: AbosTool[];
  targetCreditsCents?: number;
  requiredCreditsCents?: number;
  cooldownMs?: number;
}

interface UnresolvedPolicyEffectRow {
  id: string;
  execution_state: "running" | "unknown";
  created_at: string;
}

const CHECK_KV = "autonomous_topup.last_check_at";
const PLAN_KV = "last_autonomous_topup_plan";

function unavailablePlan(
  chainType: AbosConfig["chainType"] | AbosIdentity["chainType"],
): AutonomousTopupPlan {
  return planAutonomousTopup({
    creditsCents: Number.NaN,
    availableUsdcUsd: Number.NaN,
    chainType: chainType || "evm",
  });
}

function getUnresolvedPreviousEffect(
  db: AbosDatabase,
): UnresolvedPolicyEffectRow | undefined {
  return db.raw.prepare(
    `SELECT id, execution_state, created_at
     FROM policy_decisions
     WHERE tool_name = 'topup_credits'
       AND execution_state IN ('running', 'unknown')
     ORDER BY created_at DESC
     LIMIT 1`,
  ).get() as UnresolvedPolicyEffectRow | undefined;
}

/**
 * Execute the minimum evidence-backed credit topup through the canonical
 * PolicyEngine. This coordinator is not a treasury authority: it only joins
 * observed balance evidence, the P-010 bootstrap planner and executeTool().
 * Strategic allocation, reserves, contracts and reinvestment remain P-030/P-031.
 */
export async function executeAutonomousTopup(
  options: AutonomousTopupExecutionOptions,
): Promise<AutonomousTopupExecutionResult> {
  const {
    identity,
    config,
    db,
    conway,
    inference,
    social,
    policyEngine,
    spendTracker,
    source,
    targetCreditsCents,
    requiredCreditsCents,
    cooldownMs = 60_000,
  } = options;

  const chainType = config.chainType || identity.chainType || "evm";
  const unresolved = getUnresolvedPreviousEffect(db);
  if (unresolved) {
    return {
      status: "unresolved_previous_effect",
      plan: unavailablePlan(chainType),
      evidence: [
        `Prior topup_credits decision ${unresolved.id} remains ${unresolved.execution_state} since ${unresolved.created_at}; no automatic redispatch.`,
      ],
    };
  }

  const lastCheckAt = db.getKV(CHECK_KV);
  if (
    lastCheckAt &&
    Number.isFinite(cooldownMs) &&
    cooldownMs > 0 &&
    Date.now() - new Date(lastCheckAt).getTime() < cooldownMs
  ) {
    return {
      status: "cooldown",
      plan: unavailablePlan(chainType),
      evidence: [
        `Autonomous topup check is inside the ${cooldownMs}ms observation cooldown.`,
      ],
    };
  }
  db.setKV(CHECK_KV, new Date().toISOString());

  if (chainType === "solana") {
    const plan = planAutonomousTopup({
      creditsCents: 0,
      availableUsdcUsd: 0,
      targetCreditsCents,
      requiredCreditsCents,
      chainType,
    });
    db.setKV(
      PLAN_KV,
      JSON.stringify({ ...plan, observedAt: new Date().toISOString(), source }),
    );
    return {
      status: "no_action",
      plan,
      evidence: [plan.rationale],
    };
  }

  let creditsCents: number;
  try {
    creditsCents = await conway.getCreditsBalance();
  } catch (error) {
    const plan = unavailablePlan(chainType);
    const detail = error instanceof Error ? error.message : String(error);
    db.setKV(
      PLAN_KV,
      JSON.stringify({
        ...plan,
        observedAt: new Date().toISOString(),
        source,
        evidenceError: `credits: ${detail}`,
      }),
    );
    return {
      status: "evidence_unavailable",
      plan,
      evidence: [`Credit balance observation failed: ${detail}`],
    };
  }

  const usdc = await getUsdcBalanceDetailed(identity.address as `0x${string}`);
  if (!usdc.ok) {
    const plan = unavailablePlan(chainType);
    db.setKV(
      PLAN_KV,
      JSON.stringify({
        ...plan,
        observedAt: new Date().toISOString(),
        source,
        evidenceError: `usdc: ${usdc.error || "unknown balance error"}`,
      }),
    );
    return {
      status: "evidence_unavailable",
      plan,
      evidence: [
        `USDC balance observation failed: ${usdc.error || "unknown balance error"}`,
      ],
    };
  }

  const plan = planAutonomousTopup({
    creditsCents,
    availableUsdcUsd: usdc.balance,
    targetCreditsCents,
    requiredCreditsCents,
    chainType,
  });
  db.setKV(
    PLAN_KV,
    JSON.stringify({ ...plan, observedAt: new Date().toISOString(), source }),
  );

  if (plan.action !== "topup" || plan.amountUsd === undefined) {
    return {
      status: "no_action",
      plan,
      evidence: [plan.rationale],
    };
  }

  const tools = options.tools ?? createBuiltinTools(config.sandboxId);
  const toolResult = await executeTool(
    "topup_credits",
    { amount_usd: plan.amountUsd },
    tools,
    { identity, config, db, conway, inference, social },
    policyEngine,
    {
      inputSource: "system",
      actorAddress: identity.address,
      turnToolCallCount: 0,
      ...(spendTracker ? { sessionSpend: spendTracker } : {}),
    },
  );

  const evidence = [
    plan.rationale,
    `Protected topup execution returned ${toolResult.error ? `error=${toolResult.error}` : "success"}.`,
  ];
  db.setKV(
    "last_autonomous_topup_execution",
    JSON.stringify({
      source,
      amountUsd: plan.amountUsd,
      status: toolResult.error ? "error" : "success",
      error: toolResult.error,
      completedAt: new Date().toISOString(),
    }),
  );

  return {
    status: toolResult.error ? "policy_or_execution_error" : "executed",
    plan,
    toolResult,
    evidence,
  };
}
