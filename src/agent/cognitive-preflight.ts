import type { SurvivalTier } from "../types.js";
import type {
  CognitiveRouteCandidate,
  InferenceResourceEstimate,
} from "../intelligence/cognitive-cost-controller.js";

export interface AgentTurnCognitivePreflightInput {
  survivalTier: SurvivalTier;
  inferenceAvailable: boolean;
  inferenceEstimate: InferenceResourceEstimate;
  retrievedMemoryBlocks: number;
  retrievedKnowledgeEntries: number;
  promptEligibleSkills: number;
  availableTools: number;
}

export function agentTurnInferenceRouteId(tier: SurvivalTier): string {
  return `inference:agent_turn:${tier}`;
}

/**
 * Build evidence-bearing candidate descriptions for the main ReAct turn.
 *
 * Memory, skills and tools are not silently promoted into direct-answer routes.
 * Their current runtime contracts enrich/enable inference; until a caller can
 * present a validated direct execution result, availability remains UNKNOWN.
 */
export function buildAgentTurnCognitiveCandidates(
  input: AgentTurnCognitivePreflightInput,
): CognitiveRouteCandidate[] {
  const memoryEvidence = input.retrievedMemoryBlocks + input.retrievedKnowledgeEntries;

  return [
    {
      id: agentTurnInferenceRouteId(input.survivalTier),
      kind: "inference",
      availability: input.inferenceAvailable ? "available" : "unknown",
      expectedCostCents: input.inferenceEstimate.averageCostCents,
      expectedLatencyMs: input.inferenceEstimate.averageLatencyMs,
      expectedContextTokens: input.inferenceEstimate.averageTokens,
      evidence: [
        input.inferenceAvailable
          ? "InferenceRouter resolved a model for the current agent-turn tier and active connection."
          : "InferenceRouter did not expose a currently resolved model; availability remains UNKNOWN until canonical routing runs.",
        input.inferenceEstimate.sampleCount > 0
          ? `Inference resource estimate is derived from ${input.inferenceEstimate.sampleCount} canonical ledger sample(s).`
          : "No comparable inference ledger sample exists for this task class/tier; resource cost remains UNKNOWN.",
      ],
    },
    {
      id: "memory:agent_turn:direct",
      kind: "memory",
      availability: memoryEvidence > 0 ? "unknown" : "unavailable",
      evidence: [
        memoryEvidence > 0
          ? `Cognitive Fabric retrieved ${memoryEvidence} memory/knowledge block(s), but the current contract supplies context rather than a quality-validated direct answer.`
          : "Cognitive Fabric produced no memory/knowledge block for this turn.",
      ],
    },
    {
      id: "skill:agent_turn:direct",
      kind: "skill",
      availability: input.promptEligibleSkills > 0 ? "unknown" : "unavailable",
      evidence: [
        input.promptEligibleSkills > 0
          ? `${input.promptEligibleSkills} skill(s) are prompt-eligible, but no validated direct-execution binding has been selected for this turn.`
          : "No prompt-eligible skill is currently available for this turn.",
      ],
    },
    {
      id: "deterministic:agent_turn:tool",
      kind: "deterministic",
      availability: input.availableTools > 0 ? "unknown" : "unavailable",
      evidence: [
        input.availableTools > 0
          ? `${input.availableTools} tool(s) are available, but no task-specific deterministic tool route/arguments have been established before reasoning.`
          : "No deterministic tool route is available for this turn.",
      ],
    },
    {
      id: "simulation:agent_turn:direct",
      kind: "simulation",
      availability: "unavailable",
      evidence: [
        "No task-specific simulation result is bound as an executable direct-answer route for the main ReAct turn; Simulation Workspace remains an independent evidence authority.",
      ],
    },
  ];
}
