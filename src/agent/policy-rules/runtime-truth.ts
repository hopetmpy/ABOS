/**
 * Runtime Truth Policy Rules
 *
 * Fail closed where a loaded tool surface is only inventory/configuration and
 * no verified runtime adapter exists yet. These rules prevent nominal stubs
 * from being mistaken for successful execution while preserving the inventory
 * for later capability acquisition/verification.
 */

import type {
  PolicyRequest,
  PolicyRule,
  PolicyRuleResult,
} from "../../types.js";

const INSTALLED_TOOL_PREFIX = "Installed tool:";

function createNominalMcpExecutionRule(): PolicyRule {
  return {
    id: "runtime_truth.nominal_mcp_unverified",
    description:
      "Do not execute configured MCP inventory through the nominal pre-P-015 stub",
    priority: 50,
    appliesTo: { by: "all" },
    evaluate(request: PolicyRequest): PolicyRuleResult | null {
      // Current loadInstalledTools() maps MCP inventory to category=conway and
      // describes dynamically loaded rows as `Installed tool: ...`. Other
      // installed-tool types map to category=vm. This deliberately identifies
      // the current nominal MCP surface without inventing a provider allowlist.
      const isNominalInstalledMcp =
        request.tool.category === "conway" &&
        request.tool.description.startsWith(INSTALLED_TOOL_PREFIX);

      if (!isNominalInstalledMcp) return null;

      return {
        rule: "runtime_truth.nominal_mcp_unverified",
        action: "deny",
        reasonCode: "UNVERIFIED_RUNTIME",
        humanMessage:
          "This MCP surface is configured/installed inventory only. No verified MCP runtime adapter, handshake, tool discovery, and call path is available yet, so ABOS will not report a nominal invocation as execution success.",
      };
    },
  };
}

export function createRuntimeTruthRules(): PolicyRule[] {
  return [createNominalMcpExecutionRule()];
}
