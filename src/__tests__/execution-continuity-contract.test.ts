import { describe, expect, it } from "vitest";
import {
  EXECUTION_CONTINUATION_PROTOCOL_VERSION,
  scopeExecutionContinuationContext,
  type ExecutionContinuationContext,
} from "../environments/continuity.js";

function context(): ExecutionContinuationContext {
  return {
    protocolVersion: EXECUTION_CONTINUATION_PROTOCOL_VERSION,
    assembledAt: "2026-09-01T18:00:00.000Z",
    identity: {
      goalId: "goal-1",
      taskId: "task-1",
      pathId: "path-a",
    },
    task: {
      status: "pending",
      result: {
        success: false,
        output: "Previous executor stopped before completion.",
        artifacts: ["aws://ec2/i-1/artifact/%2Ftmp%2Fpartial.bin"],
        costCents: 12,
        duration: 1000,
      },
      metadata: {
        retryCount: 1,
      },
    },
    history: {
      failures: [
        {
          pathId: "path-a",
          environmentId: "aws",
          stage: "dispatch",
          classification: "environment_unavailable",
          reason: "Executor became unavailable.",
          evidence: [
            {
              content: "SSM transport failed.",
              source: {
                authority: "adaptive_attempts",
                recordId: "attempt-1",
              },
            },
          ],
        },
      ],
      decisions: [
        {
          decision: "Preserve verified partial work.",
          rationale: "Do not restart from zero when evidence exists.",
          pathId: "path-a",
        },
      ],
      evidence: [
        {
          content: "Migration evidence survived restart.",
          source: {
            authority: "environment_migrations",
            recordId: "migration-1",
          },
        },
      ],
    },
    memory: [
      {
        content: "The remote task already completed preprocessing.",
        kind: "episodic",
        source: {
          authority: "memory",
          recordId: "memory-1",
        },
      },
    ],
    artifacts: [
      {
        reference: "aws://ec2/i-1/artifact/%2Ftmp%2Fpartial.bin",
        state: "pending",
        source: {
          authority: "environment_resources",
          recordId: "resource-1",
        },
      },
      {
        reference: "future+provider://opaque/object/42",
        state: "unknown",
        integrity: {
          algorithm: "future-integrity-v9",
          digest: "opaque-digest",
        },
      },
    ],
    pending: [
      {
        kind: "artifact_materialization",
        description: "Materialize partial.bin on the selected target.",
        state: "pending",
      },
    ],
    checkpoint: {
      pathId: "path-a",
      state: {
        phase: "preprocessing_complete",
        cursor: 42,
      },
      source: {
        authority: "future-checkpoint-provider",
      },
    },
    sources: [
      { authority: "task_graph", recordId: "task-1" },
      { authority: "adaptive_paths", recordId: "path-a" },
      { authority: "environment_migrations", recordId: "migration-1" },
    ],
    extensions: {
      "future-provider:continuation": {
        opaque: true,
      },
    },
  };
}

describe("ExecutionContinuationContext contract", () => {
  it("retains a matching executable checkpoint on the same Task and Path", () => {
    const original = context();
    const scoped = scopeExecutionContinuationContext(original, "path-a");

    expect(scoped.identity).toEqual({
      goalId: "goal-1",
      taskId: "task-1",
      pathId: "path-a",
    });
    expect(scoped.checkpoint).toEqual(original.checkpoint);
    expect(scoped.history.failures).toEqual(original.history.failures);
    expect(scoped.artifacts).toEqual(original.artifacts);
  });

  it("drops old Path-scoped executable state when Adaptive changes Path while preserving durable knowledge", () => {
    const original = context();
    const scoped = scopeExecutionContinuationContext(original, "path-b");

    expect(scoped.identity.taskId).toBe("task-1");
    expect(scoped.identity.pathId).toBe("path-b");
    expect(scoped.checkpoint).toBeNull();

    expect(scoped.history.failures).toEqual(original.history.failures);
    expect(scoped.history.decisions).toEqual(original.history.decisions);
    expect(scoped.history.evidence).toEqual(original.history.evidence);
    expect(scoped.memory).toEqual(original.memory);
    expect(scoped.artifacts).toEqual(original.artifacts);
    expect(scoped.pending).toEqual(original.pending);

    expect(original.identity.pathId).toBe("path-a");
    expect(original.checkpoint?.pathId).toBe("path-a");
  });

  it("preserves explicit pending and unknown artifact states instead of fabricating availability", () => {
    const scoped = scopeExecutionContinuationContext(context(), "path-b");

    expect(scoped.artifacts.map((artifact) => artifact.state)).toEqual([
      "pending",
      "unknown",
    ]);
    expect(scoped.pending[0]?.state).toBe("pending");
    expect(scoped.artifacts[0]?.materializedPath).toBeUndefined();
  });

  it("keeps provider, authority, artifact-scheme, integrity, and extension identifiers open-ended", () => {
    const scoped = scopeExecutionContinuationContext(context(), "path-a");

    expect(scoped.artifacts[1]?.reference).toBe(
      "future+provider://opaque/object/42",
    );
    expect(scoped.artifacts[1]?.integrity?.algorithm).toBe(
      "future-integrity-v9",
    );
    expect(scoped.checkpoint?.source?.authority).toBe(
      "future-checkpoint-provider",
    );
    expect(scoped.extensions["future-provider:continuation"]).toEqual({
      opaque: true,
    });
  });

  it("drops Path-scoped executable state when no Path is currently bound", () => {
    const scoped = scopeExecutionContinuationContext(context(), null);

    expect(scoped.identity.pathId).toBeNull();
    expect(scoped.checkpoint).toBeNull();
    expect(scoped.history.failures).toHaveLength(1);
  });
});
