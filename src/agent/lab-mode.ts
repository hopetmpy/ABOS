import type { AutomatonTool } from "../types.js";

const LAB_MODE_ALLOWED_TOOLS = new Set([
  "sleep",
  "system_synopsis",
  "list_children",
  "check_inference_spending",
  "view_soul",
  "view_soul_history",
  "recall_facts",
  "recall_procedure",
  "review_memory",
  "list_goals",
  "get_plan",
]);

export function isLabModeEnabled(): boolean {
  return process.env.AUTOMATON_LAB_MODE === "1";
}

export function filterToolsForLabMode(tools: AutomatonTool[]): AutomatonTool[] {
  if (!isLabModeEnabled()) return tools;
  return tools.filter((tool) => LAB_MODE_ALLOWED_TOOLS.has(tool.name));
}
