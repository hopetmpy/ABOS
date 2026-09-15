from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "src/inference/inference-client.ts"
text = TARGET.read_text(encoding="utf-8")


def replace_once(old: str, new: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"expected block once, got {count}: {old[:100]!r}")
    text = text.replace(old, new, 1)

replace_once(
    'import OpenAI from "openai";\nimport type { ChatMessage } from "../types.js";\n',
    '''import OpenAI from "openai";\nimport type BetterSqlite3 from "better-sqlite3";\nimport { ulid } from "ulid";\nimport type { ChatMessage } from "../types.js";\nimport { inferenceInsertCost } from "../state/database.js";\nimport { appendEvidenceEvent, correlationIdFor } from "../observability/evidence.js";\n''',
)
replace_once(
    'const CIRCUIT_BREAKER_DISABLE_MS = 5 * 60_000;\n',
    '''const CIRCUIT_BREAKER_DISABLE_MS = 5 * 60_000;\n\ntype Database = BetterSqlite3.Database;\n\nexport interface UnifiedInferenceTraceContext {\n  correlationId?: string;\n  causationId?: string | null;\n  sessionId?: string;\n  turnId?: string | null;\n  goalId?: string | null;\n  taskId?: string | null;\n  taskType?: string;\n}\n\nexport interface UnifiedInferenceClientOptions {\n  db?: Database;\n}\n\ninterface ResolvedInferenceTrace {\n  correlationId: string;\n  causationId: string | null;\n  sessionId: string;\n  turnId: string | null;\n  goalId: string | null;\n  taskId: string | null;\n  taskType: string;\n}\n''',
)
replace_once(
    '''interface SharedChatParams {\n  messages: ChatMessage[];\n  temperature?: number;\n  maxTokens?: number;\n  tools?: unknown[];\n  toolChoice?: "auto" | "none" | "required" | Record<string, unknown>;\n  responseFormat?: { type: "json_object" | "text" };\n  stream?: boolean;\n}\n''',
    '''interface SharedChatParams {\n  messages: ChatMessage[];\n  temperature?: number;\n  maxTokens?: number;\n  tools?: unknown[];\n  toolChoice?: "auto" | "none" | "required" | Record<string, unknown>;\n  responseFormat?: { type: "json_object" | "text" };\n  stream?: boolean;\n  /** Optional durable causal context. It never carries prompt content. */\n  trace?: UnifiedInferenceTraceContext;\n}\n''',
)
replace_once(
    '''export class UnifiedInferenceClient {\n  private readonly registry: ProviderRegistry;\n  private readonly circuitBreaker = new Map<string, CircuitBreakerState>();\n\n  constructor(registry: ProviderRegistry) {\n    this.registry = registry;\n  }\n''',
    '''export class UnifiedInferenceClient {\n  private readonly registry: ProviderRegistry;\n  private readonly circuitBreaker = new Map<string, CircuitBreakerState>();\n  private evidenceDb?: Database;\n\n  constructor(\n    registry: ProviderRegistry,\n    options: UnifiedInferenceClientOptions = {},\n  ) {\n    this.registry = registry;\n    this.evidenceDb = options.db;\n  }\n\n  /** Bind the canonical runtime DB when this client enters an orchestrated runtime. */\n  bindEvidenceDatabase(db: Database): void {\n    this.evidenceDb = db;\n  }\n''',
)
replace_once(
    '''    const failedProviders: string[] = [];\n    let totalRetries = 0;\n\n    for (const resolved of candidates) {\n''',
    '''    const failedProviders: string[] = [];\n    let totalRetries = 0;\n    const trace = this.resolveTrace(params.trace);\n\n    for (const resolved of candidates) {\n''',
)
replace_once(
    '''        const attempt = await this.executeWithRetries(resolved, params, params.tier);\n''',
    '''        const attempt = await this.executeWithRetries(resolved, params, params.tier, trace);\n''',
)
replace_once(
    '''    const resolved = this.registry.getModel(params.providerId, params.modelId);\n\n    try {\n      const attempt = await this.executeWithRetries(resolved, params, resolved.model.tier);\n''',
    '''    const resolved = this.registry.getModel(params.providerId, params.modelId);\n    const trace = this.resolveTrace(params.trace);\n\n    try {\n      const attempt = await this.executeWithRetries(\n        resolved,\n        params,\n        resolved.model.tier,\n        trace,\n      );\n''',
)
old_method = '''  private async executeWithRetries(\n    resolved: ResolvedModel,\n    params: SharedChatParams,\n    requestedTier: ModelTier,\n  ): Promise<AttemptResult> {\n    let retries = 0;\n\n    while (true) {\n      try {\n        const result = await this.executeSingleRequest(\n          resolved.client,\n          resolved.provider.id,\n          resolved.model,\n          requestedTier,\n          params,\n        );\n        return { result, retries };\n      } catch (error) {\n        const retryable = this.isRetryableError(error);\n        if (!retryable) {\n          throw new ProviderAttemptError({\n            providerId: resolved.provider.id,\n            retries,\n            retryable: false,\n            originalError: error,\n          });\n        }\n\n        if (retries >= RETRY_BACKOFF_MS.length) {\n          throw new ProviderAttemptError({\n            providerId: resolved.provider.id,\n            retries,\n            retryable: true,\n            originalError: error,\n          });\n        }\n\n        const delayMs = RETRY_BACKOFF_MS[retries];\n        retries += 1;\n        await sleep(delayMs);\n      }\n    }\n  }\n'''
new_method = '''  private async executeWithRetries(\n    resolved: ResolvedModel,\n    params: SharedChatParams,\n    requestedTier: ModelTier,\n    trace: ResolvedInferenceTrace,\n  ): Promise<AttemptResult> {\n    let retries = 0;\n\n    while (true) {\n      const attemptId = ulid();\n      const attemptEvent = this.evidenceDb\n        ? appendEvidenceEvent(this.evidenceDb, {\n            correlationId: trace.correlationId,\n            causationId: trace.causationId,\n            eventType: "inference.attempt_started",\n            domain: "inference",\n            authorityType: "inference_attempt",\n            authorityId: attemptId,\n            goalId: trace.goalId,\n            taskId: trace.taskId,\n            turnId: trace.turnId,\n            epistemicStatus: "observation",\n            payload: {\n              provider: resolved.provider.id,\n              model: resolved.model.id,\n              requestedTier,\n              retryOrdinal: retries,\n            },\n            provenance: { source: "UnifiedInferenceClient" },\n          })\n        : null;\n\n      let result: UnifiedInferenceResult;\n      try {\n        result = await this.executeSingleRequest(\n          resolved.client,\n          resolved.provider.id,\n          resolved.model,\n          requestedTier,\n          params,\n        );\n      } catch (error) {\n        if (this.evidenceDb) {\n          appendEvidenceEvent(this.evidenceDb, {\n            correlationId: trace.correlationId,\n            causationId: attemptEvent?.id ?? trace.causationId,\n            eventType: "inference.provider_error_external_settlement_unknown",\n            domain: "inference",\n            authorityType: "inference_attempt",\n            authorityId: attemptId,\n            goalId: trace.goalId,\n            taskId: trace.taskId,\n            turnId: trace.turnId,\n            epistemicStatus: "unknown",\n            payload: {\n              provider: resolved.provider.id,\n              model: resolved.model.id,\n              retryOrdinal: retries,\n              localOutcome: "provider_error",\n              externalSettlement: "unknown",\n              error,\n            },\n            provenance: { source: "UnifiedInferenceClient" },\n          });\n        }\n\n        const retryable = this.isRetryableError(error);\n        if (!retryable) {\n          throw new ProviderAttemptError({\n            providerId: resolved.provider.id,\n            retries,\n            retryable: false,\n            originalError: error,\n          });\n        }\n\n        if (retries >= RETRY_BACKOFF_MS.length) {\n          throw new ProviderAttemptError({\n            providerId: resolved.provider.id,\n            retries,\n            retryable: true,\n            originalError: error,\n          });\n        }\n\n        const delayMs = RETRY_BACKOFF_MS[retries];\n        retries += 1;\n        await sleep(delayMs);\n        continue;\n      }\n\n      // Persistence of a successful external response is deliberately outside\n      // the provider catch path. If durable accounting/evidence cannot commit,\n      // do not send another request and risk duplicating a successful effect.\n      this.persistSuccess(result, requestedTier, trace, attemptId, attemptEvent?.id ?? null);\n      return { result, retries };\n    }\n  }\n'''
replace_once(old_method, new_method)

marker = '''  private async executeSingleRequest(\n'''
insert = '''  private resolveTrace(trace?: UnifiedInferenceTraceContext): ResolvedInferenceTrace {\n    const routeId = ulid();\n    const correlationId = trace?.correlationId\n      ?? (trace?.goalId ? correlationIdFor("goal", trace.goalId) : undefined)\n      ?? (trace?.taskId ? correlationIdFor("task", trace.taskId) : undefined)\n      ?? (trace?.turnId ? correlationIdFor("turn", trace.turnId) : undefined)\n      ?? (trace?.sessionId ? correlationIdFor("session", trace.sessionId) : undefined)\n      ?? correlationIdFor("unified_inference", routeId);\n\n    return {\n      correlationId,\n      causationId: trace?.causationId ?? null,\n      sessionId: trace?.sessionId ?? correlationId,\n      turnId: trace?.turnId ?? null,\n      goalId: trace?.goalId ?? null,\n      taskId: trace?.taskId ?? null,\n      taskType: trace?.taskType ?? "unified",\n    };\n  }\n\n  private persistSuccess(\n    result: UnifiedInferenceResult,\n    requestedTier: ModelTier,\n    trace: ResolvedInferenceTrace,\n    attemptId: string,\n    causationId: string | null,\n  ): void {\n    if (!this.evidenceDb) return;\n\n    this.evidenceDb.transaction(() => {\n      const costId = inferenceInsertCost(this.evidenceDb!, {\n        sessionId: trace.sessionId,\n        turnId: trace.turnId,\n        model: result.metadata.modelId,\n        provider: result.metadata.providerId,\n        inputTokens: result.usage.inputTokens,\n        outputTokens: result.usage.outputTokens,\n        costCents: result.cost.totalCostCents,\n        latencyMs: result.metadata.latencyMs,\n        tier: requestedTier,\n        taskType: trace.taskType,\n        cacheHit: false,\n      });\n\n      appendEvidenceEvent(this.evidenceDb!, {\n        correlationId: trace.correlationId,\n        causationId,\n        eventType: "inference.succeeded",\n        domain: "inference",\n        authorityType: "inference_cost",\n        authorityId: costId,\n        goalId: trace.goalId,\n        taskId: trace.taskId,\n        turnId: trace.turnId,\n        epistemicStatus: "observation",\n        payload: {\n          attemptId,\n          provider: result.metadata.providerId,\n          model: result.metadata.modelId,\n          inputTokens: result.usage.inputTokens,\n          outputTokens: result.usage.outputTokens,\n          costCents: result.cost.totalCostCents,\n          costUnit: "cent",\n          latencyMs: result.metadata.latencyMs,\n        },\n        provenance: { source: "inference_costs" },\n      });\n    })();\n  }\n\n'''
replace_once(marker, insert + marker)
TARGET.write_text(text, encoding="utf-8")

PLANNER = ROOT / "src/orchestration/planner.ts"
planner = PLANNER.read_text(encoding="utf-8")
old = '''  return params.inference.chat({\n    tier: "reasoning",\n    responseFormat: { type: "json_object" },\n    messages: [\n'''
new = '''  return params.inference.chat({\n    tier: "reasoning",\n    responseFormat: { type: "json_object" },\n    trace: {\n      goalId: params.goal.id,\n      taskId: params.failedTask?.id ?? null,\n      taskType: "planning",\n    },\n    messages: [\n'''
if planner.count(old) != 1:
    raise RuntimeError("planner inference call block mismatch")
PLANNER.write_text(planner.replace(old, new, 1), encoding="utf-8")

ORCH = ROOT / "src/orchestration/orchestrator.ts"
orch = ORCH.read_text(encoding="utf-8")
old = '''  }) {\n    this.adaptive = new AdaptivePathEngine(params.db);\n  }\n'''
new = '''  }) {\n    // Planner/orchestration inference shares the same durable accounting and\n    // evidence database as the orchestrator. Optional chaining preserves test\n    // doubles and legacy adapters that intentionally omit P-013 binding.\n    params.inference.bindEvidenceDatabase?.(params.db);\n    this.adaptive = new AdaptivePathEngine(params.db);\n  }\n'''
if orch.count(old) != 1:
    raise RuntimeError("orchestrator constructor block mismatch")
ORCH.write_text(orch.replace(old, new, 1), encoding="utf-8")

TEST = ROOT / "src/__tests__/p013-unified-inference-correlation.test.ts"
TEST.write_text(r'''import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderRegistry } from "../inference/provider-registry.js";
import { UnifiedInferenceClient } from "../inference/inference-client.js";
import { createTestDb } from "./mocks.js";
import { getEvidenceByCorrelation } from "../observability/evidence.js";
import { inferenceGetSessionCosts } from "../state/database.js";
import type { AbosDatabase } from "../types.js";

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

function registry(): ProviderRegistry {
  return ProviderRegistry.fromConfig("/tmp/definitely-missing-p013-provider-config.json");
}

function success(content = "ok") {
  return {
    choices: [{ message: { content } }],
    usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
  };
}

function providerError(status: number, message: string) {
  const error = new Error(message) as Error & { status?: number };
  error.status = status;
  throw error;
}

describe("P-013 unified inference correlation", () => {
  let db: AbosDatabase;

  beforeEach(() => {
    db = createTestDb();
    mockState.queue.splice(0, mockState.queue.length);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    db.close();
  });

  it("records each provider attempt while persisting only the successful canonical cost", async () => {
    const client = new UnifiedInferenceClient(registry(), { db: db.raw });
    mockState.queue.push(
      async () => providerError(429, "retry me"),
      async () => success("after retry"),
    );

    vi.useFakeTimers();
    const pending = client.chat({
      tier: "fast",
      messages: [{ role: "user", content: "plan" }],
      trace: {
        goalId: "goal-p013-unified",
        sessionId: "session-p013-unified",
        taskType: "planning",
      },
    });
    await vi.runAllTimersAsync();
    const result = await pending;

    expect(result.content).toBe("after retry");
    const costs = inferenceGetSessionCosts(db.raw, "session-p013-unified");
    expect(costs).toHaveLength(1);
    expect(costs[0]?.provider).toBe("openai");
    expect(costs[0]?.taskType).toBe("planning");

    const events = getEvidenceByCorrelation(db.raw, "goal:goal-p013-unified");
    expect(events.map((event) => event.eventType)).toEqual([
      "inference.attempt_started",
      "inference.provider_error_external_settlement_unknown",
      "inference.attempt_started",
      "inference.succeeded",
    ]);
    expect(events[1]?.epistemicStatus).toBe("unknown");
    expect((events[1]?.payload as any).externalSettlement).toBe("unknown");
    expect(events[3]?.authorityType).toBe("inference_cost");
    expect(events[3]?.authorityId).toBe(costs[0]!.id);
    expect(events[3]?.causationId).toBe(events[2]!.id);
  });

  it("rolls back cost and never retries an external success whose evidence commit fails", async () => {
    const client = new UnifiedInferenceClient(registry(), { db: db.raw });
    mockState.queue.push(async () => success("provider succeeded"));
    db.raw.exec(`
      CREATE TRIGGER reject_unified_success_evidence
      BEFORE INSERT ON evidence_events
      WHEN NEW.event_type = 'inference.succeeded'
      BEGIN
        SELECT RAISE(ABORT, 'intentional unified evidence failure');
      END;
    `);

    await expect(client.chat({
      tier: "fast",
      messages: [{ role: "user", content: "do once" }],
      trace: {
        goalId: "goal-p013-unified-atomic",
        sessionId: "session-p013-unified-atomic",
        taskType: "planning",
      },
    })).rejects.toThrow("intentional unified evidence failure");

    expect(mockState.create).toHaveBeenCalledTimes(1);
    expect(inferenceGetSessionCosts(db.raw, "session-p013-unified-atomic")).toHaveLength(0);
    const events = getEvidenceByCorrelation(db.raw, "goal:goal-p013-unified-atomic");
    expect(events.map((event) => event.eventType)).toEqual(["inference.attempt_started"]);
  });

  it("keeps legacy no-DB construction functional without claiming durable evidence", async () => {
    const client = new UnifiedInferenceClient(registry());
    mockState.queue.push(async () => success("legacy compatible"));

    const result = await client.chat({
      tier: "fast",
      messages: [{ role: "user", content: "legacy" }],
    });

    expect(result.content).toBe("legacy compatible");
    const count = db.raw.prepare("SELECT COUNT(*) AS count FROM evidence_events").get() as { count: number };
    expect(count.count).toBe(0);
  });
});
''', encoding="utf-8")

print("P013_UNIFIED_INFERENCE_APPLY: PASS")
