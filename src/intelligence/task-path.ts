import type { Goal, TaskNode } from "../orchestration/task-graph.js";
import type { PlannerOutput } from "../orchestration/planner.js";
import type { PathCandidate } from "./types.js";

function inferEnvironment(assignedTo: string | null): string | null {
  if (!assignedTo) return null;
  if (assignedTo.startsWith("local://")) return "local";
  if (assignedTo.startsWith("aws://")) return "aws";
  if (assignedTo.startsWith("conway://")) return "conway";
  if (/^0x[0-9a-f]{40}$/i.test(assignedTo)) return "conway";
  return null;
}

export function taskToPathCandidate(task: TaskNode, goal: Goal): PathCandidate {
  return {
    goalId: goal.id,
    taskId: task.id,
    hypothesis: `Completing "${task.title}" advances the objective "${goal.title}".`,
    strategy: [goal.strategy, task.title].filter(Boolean).join(" :: "),
    assumptions: [
      `The assigned ${task.agentRole ?? "generalist"} executor can satisfy the task acceptance criteria.`,
    ],
    requiredCapabilities: [
      task.agentRole ? `role:${task.agentRole}` : "role:generalist",
    ],
    environment: inferEnvironment(task.assignedTo),
    executor: task.assignedTo,
    sequence: [task.description],
    expectedOutcome: task.title,
    expectedCostCents: task.metadata.estimatedCostCents,
    evidence: task.result?.output ? [task.result.output] : [],
  };
}

export function plannerOutputToPathCandidate(
  goal: Goal,
  output: PlannerOutput,
): PathCandidate {
  const path = output.path;
  return {
    goalId: goal.id,
    hypothesis:
      path?.hypothesis ??
      `The planner strategy can achieve the objective "${goal.title}".`,
    strategy: output.strategy,
    assumptions: path?.assumptions ?? [],
    requiredCapabilities:
      path?.requiredCapabilities ??
      [...new Set(output.tasks.map((task) => `role:${task.agentRole}`))],
    environment: path?.preferredEnvironment ?? null,
    executor: null,
    sequence: output.tasks.map((task) => task.title),
    expectedOutcome: path?.expectedOutcome ?? goal.title,
    expectedCostCents: output.estimatedTotalCostCents,
    evidence: [],
  };
}
