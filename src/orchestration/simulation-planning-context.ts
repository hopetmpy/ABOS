import type { Database } from "better-sqlite3";
import { latestEvidenceByAuthority } from "../observability/evidence.js";
import { SimulationWorkspace } from "../intelligence/simulation-workspace.js";
import type { PlannerOutput } from "./planner.js";

export interface PlanningSimulationEvidence {
  experimentId: string;
  evidenceRef: string | null;
  status: string;
  epistemicStatus: "inference";
  question: string;
  hypothesis: string;
  summary: unknown | null;
  surprises: unknown[];
  lesson: string | null;
  decisionImpact: string | null;
}

export function loadPlanningSimulationEvidence(
  db: Database,
  goalId: string,
  limit = 20,
): PlanningSimulationEvidence[] {
  return new SimulationWorkspace(db)
    .listExperiments({ goalId, limit })
    .map((experiment) => ({
      experimentId: experiment.id,
      evidenceRef:
        latestEvidenceByAuthority(
          db,
          "simulation_experiment",
          experiment.id,
        )?.id ?? null,
      status: experiment.status,
      epistemicStatus: "inference" as const,
      question: experiment.question,
      hypothesis: experiment.hypothesis,
      summary: experiment.summary,
      surprises: experiment.surprises,
      lesson: experiment.lesson,
      decisionImpact: experiment.decisionImpact,
    }));
}

export function renderPlanningSimulationContext(
  records: readonly PlanningSimulationEvidence[],
): string {
  if (records.length === 0) {
    return [
      "# Simulation evidence (INFERENCE ONLY)",
      "No goal-scoped E-xxx simulation evidence exists for this planning turn.",
    ].join("\n");
  }

  const lines = records.map((record) =>
    [
      `experiment=${record.experimentId}`,
      `evidence_ref=${record.evidenceRef ?? "none"}`,
      `epistemic_status=${record.epistemicStatus}`,
      `status=${record.status}`,
      `question=${compact(record.question)}`,
      `hypothesis=${compact(record.hypothesis)}`,
      `summary=${compact(record.summary)}`,
      `surprises=${compact(record.surprises)}`,
      `lesson=${compact(record.lesson)}`,
      `decision_impact=${compact(record.decisionImpact)}`,
    ].join(" | "),
  );

  return [
    "# Simulation evidence (INFERENCE ONLY)",
    "These E-xxx records are simulated/inferential evidence, never external observation or ground truth.",
    "Status matters: draft/running/failed/budget_exhausted is not equivalent to a completed result.",
    "Use simulation to discriminate routes only to the extent its assumptions/provenance support the decision.",
    "If a simulation materially affects the selected route, copy its exact evidence_ref into decisionFactors. Do not invent or transform evidence refs.",
    ...lines,
  ].join("\n");
}

export function referencedSimulationEvidence(
  output: PlannerOutput,
  records: readonly PlanningSimulationEvidence[],
): string[] {
  const decisionText = (output.decisionFactors ?? []).join("\n");
  if (!decisionText) return [];

  const refs = records
    .map((record) => record.evidenceRef)
    .filter((ref): ref is string => typeof ref === "string" && ref.length > 0)
    .filter((ref) => decisionText.includes(ref));

  return [...new Set(refs)];
}

function compact(value: unknown, maxLength = 360): string {
  if (value === null || value === undefined) return "none";
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  const normalized = serialized.replace(/\s+/gu, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength)}…`;
}
