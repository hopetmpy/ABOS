import type { Database } from "better-sqlite3";
import {
  getEvidenceEvent,
  latestEvidenceByAuthority,
} from "../observability/evidence.js";
import { SimulationWorkspace } from "../intelligence/simulation-workspace.js";
import type { PlannerOutput } from "./planner.js";

export interface PlanningSimulationEvidence {
  experimentId: string;
  evidenceRef: string | null;
  status: string;
  runCount: number;
  epistemicStatus: "inference";
  question: string;
  hypothesis: string;
  summary: unknown | null;
  surprises: unknown[];
  lesson: string | null;
  decisionImpact: string | null;
}

/**
 * Planning may see that a goal-scoped experiment exists before it has run, but
 * a zero-run experiment has produced no simulated outcome. Keep its question,
 * hypothesis and status visible while withholding result/interpretation fields
 * and a citable Evidence Fabric reference until at least one run is durable.
 *
 * This intentionally does not require status=completed. A running, failed or
 * budget-exhausted experiment can still contain real partial-run evidence; its
 * status and runCount stay explicit so strategic review can reason about the
 * uncertainty instead of pretending partial evidence is a completed result.
 */
export function loadPlanningSimulationEvidence(
  db: Database,
  goalId: string,
  limit = 20,
): PlanningSimulationEvidence[] {
  return new SimulationWorkspace(db)
    .listExperiments({ goalId, limit })
    .map((experiment) => {
      const hasExecutedRun = experiment.runCount > 0;
      return {
        experimentId: experiment.id,
        evidenceRef: hasExecutedRun
          ? latestEvidenceByAuthority(
              db,
              "simulation_experiment",
              experiment.id,
            )?.id ?? null
          : null,
        status: experiment.status,
        runCount: experiment.runCount,
        epistemicStatus: "inference" as const,
        question: experiment.question,
        hypothesis: experiment.hypothesis,
        summary: hasExecutedRun ? experiment.summary : null,
        surprises: hasExecutedRun ? experiment.surprises : [],
        lesson: hasExecutedRun ? experiment.lesson : null,
        decisionImpact: hasExecutedRun ? experiment.decisionImpact : null,
      };
    });
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
      `run_count=${record.runCount}`,
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
    "A zero-run experiment is metadata only: it exposes no result/interpretation and no citable evidence_ref.",
    "Partial-run evidence may be considered only with its status/run_count and assumptions kept explicit.",
    "Use simulation to discriminate routes only to the extent its assumptions/provenance support the decision.",
    "If simulation materially affects the selected route, copy its exact non-none evidence_ref into decisionFactors. Do not invent or transform evidence refs.",
    ...lines,
  ].join("\n");
}

/**
 * Persist only Evidence Fabric events that the planner explicitly cited in its
 * decision factors, that were actually exposed in the current goal-scoped
 * planning context, and whose experiment has at least one durable simulation
 * run. This preserves causal provenance without treating experiment creation or
 * a manually attached zero-run interpretation as simulated outcome evidence.
 */
export function referencedSimulationEvidence(
  db: Database,
  goalId: string,
  output: PlannerOutput,
): string[] {
  const decisionText = (output.decisionFactors ?? []).join("\n").toUpperCase();
  if (!decisionText) return [];

  const exposed = new Set(
    loadPlanningSimulationEvidence(db, goalId, 20)
      .filter((record) => record.runCount > 0 && record.evidenceRef !== null)
      .map((record) => record.evidenceRef as string),
  );
  if (exposed.size === 0) return [];

  const candidates = decisionText.match(/\b[0-9A-HJKMNP-TV-Z]{26}\b/gu) ?? [];
  const refs: string[] = [];

  for (const candidate of [...new Set(candidates)]) {
    if (!exposed.has(candidate)) continue;
    const event = getEvidenceEvent(db, candidate);
    if (!event) continue;
    if (event.goalId !== goalId) continue;
    if (event.domain !== "simulation") continue;
    if (event.authorityType !== "simulation_experiment") continue;
    if (event.epistemicStatus !== "inference") continue;
    refs.push(event.id);
  }

  return refs;
}

function compact(value: unknown, maxLength = 360): string {
  if (value === null || value === undefined) return "none";
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  const normalized = serialized.replace(/\s+/gu, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength)}…`;
}
