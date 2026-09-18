import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
    expect(costs[0]?.provider).toBe(result.metadata.providerId);
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
