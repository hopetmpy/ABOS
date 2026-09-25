import { describe, expect, it } from "vitest";
import {
  agentTurnInferenceRouteId,
  buildAgentTurnCognitiveCandidates,
} from "../agent/cognitive-preflight.js";

describe("P-026 main-turn cognitive preflight", () => {
  it("keeps retrieved memory, skills and tools UNKNOWN instead of pretending they are direct answers", () => {
    const candidates = buildAgentTurnCognitiveCandidates({
      survivalTier: "normal",
      inferenceAvailable: true,
      inferenceEstimate: {
        sampleCount: 3,
        averageCostCents: 4,
        averageLatencyMs: 120,
        averageTokens: 800,
      },
      retrievedMemoryBlocks: 2,
      retrievedKnowledgeEntries: 3,
      promptEligibleSkills: 4,
      availableTools: 10,
    });

    expect(candidates.find((candidate) => candidate.id === agentTurnInferenceRouteId("normal")))
      .toMatchObject({
        kind: "inference",
        availability: "available",
        expectedCostCents: 4,
      });
    expect(candidates.find((candidate) => candidate.kind === "memory")?.availability)
      .toBe("unknown");
    expect(candidates.find((candidate) => candidate.kind === "skill")?.availability)
      .toBe("unknown");
    expect(candidates.find((candidate) => candidate.kind === "deterministic")?.availability)
      .toBe("unknown");
    expect(candidates.find((candidate) => candidate.kind === "simulation")?.availability)
      .toBe("unavailable");
  });

  it("marks absent context routes unavailable and preserves UNKNOWN for unresolved inference", () => {
    const candidates = buildAgentTurnCognitiveCandidates({
      survivalTier: "low_compute",
      inferenceAvailable: false,
      inferenceEstimate: {
        sampleCount: 0,
        averageCostCents: null,
        averageLatencyMs: null,
        averageTokens: null,
      },
      retrievedMemoryBlocks: 0,
      retrievedKnowledgeEntries: 0,
      promptEligibleSkills: 0,
      availableTools: 0,
    });

    expect(candidates.find((candidate) => candidate.kind === "inference")?.availability)
      .toBe("unknown");
    expect(candidates.filter((candidate) => candidate.kind !== "inference").map((candidate) => candidate.availability))
      .toEqual(["unavailable", "unavailable", "unavailable", "unavailable"]);
  });
});
