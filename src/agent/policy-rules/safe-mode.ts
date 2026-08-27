import type { PolicyRule, PolicyRuleResult } from "../../types.js";
import { SAFE_MODE } from "../../safety/safe-mode.js";
const DENIED = new Set([
  "exec", "expose_port", "remove_port", "create_sandbox", "delete_sandbox",
  "topup_credits", "transfer_credits", "fund_child", "x402_fetch", "send_message",
  "message_child", "spawn_child", "start_child", "register_domain", "manage_dns",
  "register_erc8004", "update_agent_card", "give_feedback", "install_npm_package",
  "install_mcp_server", "install_skill", "pull_upstream", "review_upstream_changes",
  "reset_to_upstream", "git_push", "git_commit", "git_clone", "edit_own_file",
  "revert_last_edit", "prune_dead_children",
]);

export function createSafeModeRules(): PolicyRule[] {
  if (!SAFE_MODE) return [];
  return [{
    id: "safe_mode.capability_deny",
    description: "Categorically deny externally consequential tools in local safe mode",
    priority: -10_000,
    appliesTo: { by: "all" },
    evaluate(request): PolicyRuleResult | null {
      if (!DENIED.has(request.tool.name)) return null;
      return {
        rule: "safe_mode.capability_deny", action: "deny", reasonCode: "SAFE_MODE_DENIED",
        humanMessage: `Tool ${request.tool.name} is unavailable in local safe mode`,
      };
    },
  }];
}
