from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: str, old: str, new: str) -> None:
    target = ROOT / path
    text = target.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected block once, got {count}: {old[:120]!r}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")


# 1) Core causal invariant: causation_id is an evidence-event id, never a domain id.
replace_once(
    "src/observability/evidence.ts",
    '''  const createdAt = input.createdAt ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(createdAt))) {
    throw new Error(`createdAt is not a valid timestamp: ${createdAt}`);
  }

  const payload = redactEvidenceValue(input.payload ?? {});
''',
    '''  const createdAt = input.createdAt ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(createdAt))) {
    throw new Error(`createdAt is not a valid timestamp: ${createdAt}`);
  }

  const causationId = input.causationId == null
    ? null
    : requireLabel(input.causationId, "causationId");
  if (causationId) {
    const predecessor = db.prepare(
      "SELECT 1 FROM evidence_events WHERE id = ?",
    ).get(causationId);
    if (!predecessor) {
      throw new Error(
        `causationId must reference an existing evidence event: ${causationId}`,
      );
    }
  }

  const payload = redactEvidenceValue(input.payload ?? {});
''',
)
replace_once(
    "src/observability/evidence.ts",
    '''    correlationId,
    input.causationId ?? null,
    eventType,
''',
    '''    correlationId,
    causationId,
    eventType,
''',
)

# 2) InferenceRouter: retain the actual persisted attempt event as predecessor.
replace_once(
    "src/inference/router.ts",
    '''    const correlationId = turnId
      ? correlationIdFor("turn", turnId)
      : sessionId
        ? correlationIdFor("session", sessionId)
        : correlationIdFor("inference_route", ulid());
    const rootCausationId = turnId ? correlationIdFor("turn", turnId) : null;
''',
    '''    const correlationId = turnId
      ? correlationIdFor("turn", turnId)
      : sessionId
        ? correlationIdFor("session", sessionId)
        : correlationIdFor("inference_route", ulid());
''',
)
replace_once(
    "src/inference/router.ts",
    '''      appendEvidenceEvent(this.db, {
        correlationId,
        causationId: rootCausationId,
        eventType: "inference.attempt_started",
''',
    '''      const attemptEvent = appendEvidenceEvent(this.db, {
        correlationId,
        eventType: "inference.attempt_started",
''',
)
# There are exactly three outcome uses of attemptId as causation in this route.
router = (ROOT / "src/inference/router.ts").read_text(encoding="utf-8")
needle = "causationId: attemptId,"
if router.count(needle) != 3:
    raise RuntimeError(f"router: expected 3 attempt-domain causations, got {router.count(needle)}")
(ROOT / "src/inference/router.ts").write_text(
    router.replace(needle, "causationId: attemptEvent.id,"),
    encoding="utf-8",
)

# 3) Adaptive: derive causation from the latest evidence event for the authority.
replace_once(
    "src/intelligence/store.ts",
    '''import { appendEvidenceEvent, correlationIdFor } from "../observability/evidence.js";
''',
    '''import {
  appendEvidenceEvent,
  correlationIdFor,
  latestEvidenceByAuthority,
} from "../observability/evidence.js";
''',
)
replace_once(
    "src/intelligence/store.ts",
    '''        causationId: correlationIdFor("adaptive_path", input.pathId),
''',
    '''        causationId:
          latestEvidenceByAuthority(this.db, "adaptive_path", input.pathId)?.id ?? null,
''',
)
replace_once(
    "src/intelligence/store.ts",
    '''        causationId: input.attemptId
          ? correlationIdFor("adaptive_attempt", input.attemptId)
          : input.pathId
            ? correlationIdFor("adaptive_path", input.pathId)
            : null,
''',
    '''        causationId: input.attemptId
          ? latestEvidenceByAuthority(this.db, "adaptive_attempt", input.attemptId)?.id ?? null
          : input.pathId
            ? latestEvidenceByAuthority(this.db, "adaptive_path", input.pathId)?.id ?? null
            : null,
''',
)

# 4) Environment: a path link becomes the actual latest path evidence event.
replace_once(
    "src/environments/resource-store.ts",
    '''import { appendEvidenceEvent, correlationIdFor } from "../observability/evidence.js";
''',
    '''import {
  appendEvidenceEvent,
  correlationIdFor,
  latestEvidenceByAuthority,
} from "../observability/evidence.js";
''',
)
replace_once(
    "src/environments/resource-store.ts",
    '''      causationId: resource?.pathId
        ? correlationIdFor("adaptive_path", resource.pathId)
        : null,
''',
    '''      causationId: resource?.pathId
        ? latestEvidenceByAuthority(this.db, "adaptive_path", resource.pathId)?.id ?? null
        : null,
''',
)

# 5) Tool wrapper: tool-call identity is an authority/reference, not causation.
replace_once(
    "src/agent/tools-core.ts",
    '''      causationId: turnContext?.causationId ?? turnContext?.toolCallId ?? null,
''',
    '''      causationId: turnContext?.causationId ?? null,
''',
)

# 6) Focused regression expectations.
replace_once(
    "src/__tests__/p013-inference-correlation.test.ts",
    '''    expect(events[1].causationId).toBe(events[0].authorityId);
''',
    '''    expect(events[1].causationId).toBe(events[0].id);
''',
)
replace_once(
    "src/__tests__/p013-adaptive-correlation.test.ts",
    '''      expect(attemptEvent?.causationId).toBe(`adaptive_path:${selected.path.id}`);
''',
    '''      expect(attemptEvent?.causationId).toBeTruthy();
      const attemptCause = events.find((event) => event.id === attemptEvent?.causationId);
      expect(attemptCause?.authorityType).toBe("adaptive_path");
      expect(attemptCause?.authorityId).toBe(selected.path.id);
''',
)
replace_once(
    "src/__tests__/p013-evidence-fabric.test.ts",
    '''  it("rejects empty correlation and event identity labels", () => {
''',
    '''  it("rejects a causation id that is not an already-persisted evidence event", () => {
    const db = new Database(":memory:");
    db.exec(MIGRATION_V18_EVIDENCE_FABRIC);
    expect(() => appendEvidenceEvent(db, {
      correlationId: "test:causal-guard",
      causationId: "adaptive_path:not-an-evidence-event",
      eventType: "test.child",
      domain: "test",
      authorityType: "test_authority",
      authorityId: "child-1",
    })).toThrow(/causationId must reference an existing evidence event/);
    expect(db.prepare("SELECT COUNT(*) AS count FROM evidence_events").get()).toEqual({ count: 0 });
    db.close();
  });

  it("rejects empty correlation and event identity labels", () => {
''',
)

# 7) File-backed E2E/restart proof across real canonical authorities.
e2e = r'''import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDatabase, inferenceGetSessionCosts } from "../state/database.js";
import { AdaptivePathEngine } from "../intelligence/adaptive-engine.js";
import type { PathCandidate } from "../intelligence/types.js";
import { EnvironmentResourceStore } from "../environments/resource-store.js";
import { ProviderRegistry } from "../inference/provider-registry.js";
import { UnifiedInferenceClient } from "../inference/inference-client.js";
import { PolicyEngine } from "../agent/policy-engine.js";
import { executeTool } from "../agent/tools.js";
import {
  createSelfModTransaction,
  getSelfModTransaction,
  transitionSelfModTransaction,
} from "../self-mod/transaction.js";
import { getEvidenceByCorrelation } from "../observability/evidence.js";
import {
  MockConwayClient,
  MockInferenceClient,
  createTestConfig,
  createTestIdentity,
} from "./mocks.js";
import type { AbosTool, ToolContext } from "../types.js";

const mockState = vi.hoisted(() => {
  const queue: Array<() => unknown | Promise<unknown>> = [];
  const create = vi.fn(async () => {
    const next = queue.shift();
    if (!next) throw new Error("No provider response queued");
    return next();
  });
  const ctor = vi.fn().mockImplementation(function MockOpenAI(this: any) {
    this.chat = { completions: { create } };
  });
  return { queue, create, ctor };
});

vi.mock("openai", () => ({ default: mockState.ctor }));

const roots: string[] = [];

beforeEach(() => {
  mockState.queue.splice(0, mockState.queue.length);
  vi.clearAllMocks();
});

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function candidate(goalId: string, taskId: string): PathCandidate {
  return {
    goalId,
    taskId,
    hypothesis: "A provider-backed path can satisfy the objective",
    strategy: "Provision, infer, execute and learn",
    assumptions: ["provider is reachable"],
    requiredCapabilities: ["api", "self_mod"],
    environment: "test-provider",
    executor: "local://worker",
    sequence: ["provision", "infer", "execute", "learn"],
    expectedOutcome: "durable correlated outcome",
    expectedCostCents: 5,
    evidence: [],
  };
}

function providerRegistry(): ProviderRegistry {
  return ProviderRegistry.fromConfig("/tmp/definitely-missing-p013-e2e-provider-config.json");
}

describe("P-013 persistent end-to-end evidence reconstruction", () => {
  it("reopens SQLite and reconstructs one goal across canonical authorities with no orphan causation", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "abos-p013-e2e-"));
    roots.push(root);
    const dbPath = path.join(root, "state.db");
    const goalId = "goal-p013-e2e";
    const taskId = "task-p013-e2e";
    const turnId = "turn-p013-e2e";
    const toolCallId = "tool-call-p013-e2e";
    const sessionId = "session-p013-e2e";
    const correlationId = `goal:${goalId}`;
    const learnedValue = "canonical-e2e-learning-p013";

    const db = createDatabase(dbPath);
    const now = new Date().toISOString();
    db.raw.prepare(
      "INSERT INTO goals (id, title, description, status, created_at) VALUES (?, ?, ?, 'active', ?)",
    ).run(goalId, "P-013 E2E", "Persistent correlation proof", now);
    db.raw.prepare(
      "INSERT INTO task_graph (id, goal_id, title, description, status, priority, dependencies, created_at) VALUES (?, ?, ?, ?, 'pending', 50, '[]', ?)",
    ).run(taskId, goalId, "Correlated task", "P-013 E2E task", now);
    db.insertTurn({
      id: turnId,
      timestamp: now,
      state: "running",
      input: "execute correlated objective",
      inputSource: "system",
      thinking: "",
      toolCalls: [],
      tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      costCents: 0,
    });

    const adaptive = new AdaptivePathEngine(db.raw);
    const pathCandidate = candidate(goalId, taskId);
    const selected = adaptive.selectCandidate(pathCandidate, { network: "ready" });
    adaptive.store.bindTask({ taskId, goalId, pathId: selected.path.id });

    const environments = new EnvironmentResourceStore(db.raw);
    const resource = environments.create({
      id: "env-p013-e2e",
      provider: "test-provider",
      type: "sandbox",
      goalId,
      pathId: selected.path.id,
      taskId,
      credentialsReference: "credential-ref-canonical-only-p013-e2e",
      metadata: { accessToken: "secret-token-p013-e2e" },
    });
    environments.transition(resource.id, "ready", { operation: "provision" });

    mockState.queue.push(async () => ({
      choices: [{ message: { content: "planner result" } }],
      usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
    }));
    const inference = new UnifiedInferenceClient(providerRegistry(), { db: db.raw });
    const inferenceResult = await inference.chat({
      tier: "fast",
      messages: [{ role: "user", content: "plan the correlated objective" }],
      trace: { goalId, taskId, sessionId, taskType: "planning" },
    });
    expect(inferenceResult.content).toBe("planner result");

    let transactionId = "";
    const tool: AbosTool = {
      name: "p013_e2e_self_mod_probe",
      description: "test-only protected self-mod probe",
      parameters: { type: "object", properties: {} },
      riskLevel: "safe",
      category: "self_mod",
      execute: async (_args, context) => {
        const transaction = createSelfModTransaction(context.db.raw, {
          operation: "p013_e2e_probe",
          baseSha: "p013-e2e-base",
        });
        transactionId = transaction.id;
        transitionSelfModTransaction(context.db.raw, transaction.id, "failed", {
          error: "intentional e2e terminal state",
        });
        return transaction.id;
      },
    };
    const context: ToolContext = {
      identity: createTestIdentity(),
      config: createTestConfig({ dbPath }),
      db,
      conway: new MockConwayClient(),
      inference: new MockInferenceClient(),
    };
    const policy = new PolicyEngine(db.raw, []);
    const toolResult = await executeTool(
      tool.name,
      {},
      [tool],
      context,
      policy,
      {
        inputSource: "system",
        correlationId,
        goalId,
        taskId,
        turnId,
        toolCallId,
        turnToolCallCount: 0,
      },
    );
    expect(toolResult.error).toBeUndefined();
    expect(transactionId).not.toBe("");
    db.insertToolCall(turnId, {
      ...toolResult,
      id: toolCallId,
    });

    const decision = adaptive.recordFailure({
      candidate: pathCandidate,
      pathId: selected.path.id,
      error: "provider response failed validation after execution",
      observations: ["validation mismatch observed"],
      evidence: ["artifact://p013-e2e-validation"],
      learnedFacts: [{ key: "p013.e2e.fact", value: learnedValue, confidence: 0.9 }],
      conditions: { network: "ready" },
    });
    expect(decision.attempt.id).toBeTruthy();

    const beforeRestart = getEvidenceByCorrelation(db.raw, correlationId);
    expect(beforeRestart.length).toBeGreaterThan(10);
    const beforeIds = beforeRestart.map((event) => event.id);
    db.close();

    const reopened = createDatabase(dbPath);
    try {
      const events = getEvidenceByCorrelation(reopened.raw, correlationId);
      expect(events.map((event) => event.id)).toEqual(beforeIds);
      const types = new Set(events.map((event) => event.eventType));
      for (const eventType of [
        "adaptive.path_created",
        "adaptive.attempt_recorded",
        "adaptive.evidence_recorded",
        "adaptive.fact_upserted",
        "environment.resource_event",
        "inference.attempt_started",
        "inference.succeeded",
        "policy.decision_persisted",
        "policy.execution_running",
        "self_mod.proposed",
        "self_mod.failed",
        "policy.execution_succeeded",
      ]) {
        expect(types.has(eventType), `missing ${eventType}`).toBe(true);
      }

      const costs = inferenceGetSessionCosts(reopened.raw, sessionId);
      expect(costs).toHaveLength(1);
      const inferenceSuccess = events.find((event) => event.eventType === "inference.succeeded");
      expect(inferenceSuccess?.authorityType).toBe("inference_cost");
      expect(inferenceSuccess?.authorityId).toBe(costs[0]!.id);

      const reopenedAdaptive = new AdaptivePathEngine(reopened.raw);
      expect(reopenedAdaptive.store.getPath(selected.path.id)?.goalId).toBe(goalId);
      expect(reopenedAdaptive.store.latestAttempt(selected.path.id, taskId)?.id).toBe(decision.attempt.id);
      expect(reopenedAdaptive.store.getFact(goalId, "p013.e2e.fact")?.value).toBe(learnedValue);

      const reopenedEnvironment = new EnvironmentResourceStore(reopened.raw);
      const environmentEvents = reopenedEnvironment.listEvents(resource.id);
      expect(environmentEvents.length).toBeGreaterThanOrEqual(2);
      for (const authority of environmentEvents) {
        expect(events.some((event) =>
          event.authorityType === "environment_resource_event" && event.authorityId === authority.id
        )).toBe(true);
      }

      const policyRow = reopened.raw.prepare(
        "SELECT id, turn_id, execution_state FROM policy_decisions WHERE turn_id = ? ORDER BY created_at DESC LIMIT 1",
      ).get(turnId) as { id: string; turn_id: string; execution_state: string };
      expect(policyRow.turn_id).toBe(turnId);
      expect(policyRow.execution_state).toBe("succeeded");
      expect(events.some((event) =>
        event.authorityType === "policy_decision" && event.authorityId === policyRow.id
      )).toBe(true);

      expect(getSelfModTransaction(reopened.raw, transactionId)?.status).toBe("failed");
      expect(events.some((event) =>
        event.authorityType === "self_mod_transaction" && event.authorityId === transactionId
      )).toBe(true);
      expect(reopened.getTurnById(turnId)?.id).toBe(turnId);
      expect(reopened.getToolCallsForTurn(turnId).map((call) => call.id)).toContain(toolCallId);
      expect(events.filter((event) => event.toolCallId === toolCallId).length).toBeGreaterThan(0);

      const serializedEvidence = JSON.stringify(events);
      expect(serializedEvidence).not.toContain(learnedValue);
      expect(serializedEvidence).not.toContain("secret-token-p013-e2e");
      expect(serializedEvidence).not.toContain("credential-ref-canonical-only-p013-e2e");

      const orphanCount = reopened.raw.prepare(`
        SELECT COUNT(*) AS count
        FROM evidence_events e
        LEFT JOIN evidence_events parent ON parent.id = e.causation_id
        WHERE e.causation_id IS NOT NULL AND parent.id IS NULL
      `).get() as { count: number };
      expect(orphanCount.count).toBe(0);
    } finally {
      reopened.close();
    }
  });
});
'''
(ROOT / "src/__tests__/p013-e2e-restart-correlation.test.ts").write_text(e2e, encoding="utf-8")
