import { describe, expect, it } from "vitest";
import { createRateLimitRules } from "../agent/policy-rules/rate-limits.js";

describe("P-012 self-modification rate authority", () => {
  it("does not impose a fixed edit_own_file hourly ceiling", () => {
    const rules = createRateLimitRules();
    const ids = rules.map((rule) => rule.id);

    expect(ids).not.toContain("rate.self_mod_hourly");
    expect(
      rules.some(
        (rule) => rule.appliesTo.by === "name"
          && rule.appliesTo.names.includes("edit_own_file"),
      ),
    ).toBe(false);
  });

  it("preserves unrelated frequency policies", () => {
    const ids = createRateLimitRules().map((rule) => rule.id);
    expect(ids).toContain("rate.genesis_prompt_daily");
    expect(ids).toContain("rate.spawn_daily");
  });
});
