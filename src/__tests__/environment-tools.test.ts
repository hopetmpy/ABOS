import { describe, expect, it } from "vitest";
import { EnvironmentRegistry } from "../environments/registry.js";
import { createEnvironmentTools } from "../environments/tools.js";
import type { EnvironmentProvider } from "../environments/types.js";

function provider(): EnvironmentProvider {
  return {
    id: "mock",
    async inspect() {
      return {
        id: "mock",
        label: "Mock",
        availability: "available",
        capabilities: [],
        evidence: ["ready"],
        constraints: [],
        observedAt: new Date().toISOString(),
      };
    },
    async execute(args) {
      return {
        stdout: args.join("|"),
        stderr: "",
        exitCode: 0,
      };
    },
  };
}

describe("environment_economic_evidence tool", () => {
  it("discovers provider-neutral read-only economics without purchase authority", async () => {
    const registry = new EnvironmentRegistry();
    let observed = 0;
    registry.register({
      ...provider(),
      async observeEconomics() {
        observed += 1;
        return {
          provider: "mock",
          status: "observed" as const,
          accountId: "account-test",
          observedAt: new Date(0).toISOString(),
          budgets: [],
          spendableLiquidityUsdCents: null,
          recurringCommitmentUsdCents: null,
          procurementAuthority: "not_established" as const,
          evidence: ["Threshold is not liquidity."],
        };
      },
    });
    const tool = createEnvironmentTools(registry).find(
      (entry) => entry.name === "environment_economic_evidence",
    )!;
    expect(tool).toBeDefined();
    const result = await tool.execute({ environment: "mock" }, {} as any);
    expect(observed).toBe(1);
    expect(result).toContain('"procurementAuthority": "not_established"');
    expect(result).toContain('"spendableLiquidityUsdCents": null');
    expect(result).toContain("Threshold is not liquidity");
  });

  it("does not fabricate economics for providers without adapter or failed probes", async () => {
    const registry = new EnvironmentRegistry();
    registry.register(provider());
    registry.register({
      ...provider(), id: "broken",
      observeEconomics: async () => { throw new Error("sensitive secret"); },
    });
    const tool = createEnvironmentTools(registry).find(
      (entry) => entry.name === "environment_economic_evidence",
    )!;
    expect(await tool.execute({ environment: "mock" }, {} as any))
      .toContain("UNAVAILABLE");
    const failed = await tool.execute({ environment: "broken" }, {} as any);
    expect(failed).toContain("UNKNOWN");
    expect(failed).not.toContain("sensitive secret");
    expect(await tool.execute({ environment: "missing" }, {} as any))
      .toContain("BLOCKED");
  });
});

describe("P-031 environment_procurement_review", () => {
  it("feeds observed account identity into P-030 but refuses to count provider budgets as cash", async () => {
    const registry = new EnvironmentRegistry();
    registry.register({
      ...provider(), id: "aws",
      observeEconomics: async () => ({
        provider: "aws", status: "observed" as const,
        accountId: "123456789012", observedAt: new Date().toISOString(),
        budgets: [{ name: "Cash-looking budget", period: "MONTHLY",
          budgetLimitUsdCents: 100_000, reportedSpendUsdCents: 10_000,
          reportedSpendRaw: "100.00", evidence: ["Budget is only a spending threshold"] }],
        spendableLiquidityUsdCents: null,
        recurringCommitmentUsdCents: null,
        procurementAuthority: "not_established" as const,
        evidence: ["AWS account observed"],
      }),
    });
    const tool = createEnvironmentTools(registry).find(
      x => x.name === "environment_procurement_review",
    )!;
    const result = await tool.execute({
      environment: "aws", unit: "usd_cent",
      resource_need_evidence: ["Reviewed compute need."],
      one_time_cents: 2000, recurring_cents_per_period: 1500,
      periods: 3, other_charges_cents: 500,
      billing_terms_evidence: ["Declared four-item quote."],
      alternatives: [{ id: "reuse", projected_cost_cents: 3000,
        unit: "usd_cent", evidence: "Owned compute may be reused." }],
      additional_contingency_cents: 1000,
      contingency_evidence: ["Measured provider recovery downside."],
    }, {} as any);
    expect(result).toContain('"accountId": "123456789012"');
    expect(result).toContain('"totalProposedCommitmentCents": 7000');
    expect(result).toContain('"status": "needs_evidence"');
    expect(result).toContain('"freeBeforeProposalCents": null');
    expect(result).toContain('"purchaseAuthorized": false');
    expect(result).not.toContain('"freeBeforeProposalCents": 90000');
  });

  it("does not invent account scope for unsupported or unavailable observation", async () => {
    const registry = new EnvironmentRegistry();
    registry.register(provider());
    registry.register({
      ...provider(), id: "unknown",
      observeEconomics: async () => ({
        provider: "unknown", status: "unknown" as const,
        accountId: null, observedAt: new Date().toISOString(),
        budgets: [], spendableLiquidityUsdCents: null,
        recurringCommitmentUsdCents: null,
        procurementAuthority: "not_established" as const, evidence: [],
      }),
    });
    const tool = createEnvironmentTools(registry).find(
      x => x.name === "environment_procurement_review",
    )!;
    expect(await tool.execute({ environment: "mock", unit: "usd_cent" }, {} as any))
      .toContain("UNAVAILABLE");
    expect(await tool.execute({ environment: "unknown", unit: "usd_cent" }, {} as any))
      .toContain("UNKNOWN");
    expect(await tool.execute({ environment: "missing", unit: "usd_cent" }, {} as any))
      .toContain("BLOCKED");
  });
});

describe("environment_exec tool", () => {
  it("routes argv to the selected registered provider without shell interpolation", async () => {
    const registry = new EnvironmentRegistry();
    registry.register(provider());
    const tool = createEnvironmentTools(registry)[0]!;
    const result = await tool.execute(
      { environment: "mock", args: ["service", "operation", "--flag=value"] },
      {} as any,
    );
    expect(result).toContain("exit_code: 0");
    expect(result).toContain("service|operation|--flag=value");
  });

  it("redacts provider credentials before returning output to the model", async () => {
    const registry = new EnvironmentRegistry();
    registry.register({
      id: "mock-secret",
      async inspect() {
        return {
          id: "mock-secret",
          label: "Mock Secret",
          availability: "available",
          capabilities: [],
          evidence: ["ready"],
          constraints: [],
          observedAt: new Date().toISOString(),
        };
      },
      async execute() {
        return {
          stdout: JSON.stringify({
            AccessKeyId: "AKIAABCDEFGHIJKLMNOP",
            SecretAccessKey: "super-secret-value",
            SessionToken: "temporary-session-token",
          }),
          stderr: "",
          exitCode: 0,
        };
      },
    });

    const tool = createEnvironmentTools(registry)[0]!;
    const result = await tool.execute(
      { environment: "mock-secret", args: ["identity"] },
      {} as any,
    );

    expect(result).not.toContain("AKIAABCDEFGHIJKLMNOP");
    expect(result).not.toContain("super-secret-value");
    expect(result).not.toContain("temporary-session-token");
    expect(result).toContain("[REDACTED");
  });

  it("bounds provider output before returning it to the model", async () => {
    const registry = new EnvironmentRegistry();
    registry.register({
      id: "mock-large",
      async inspect() {
        return {
          id: "mock-large",
          label: "Mock Large",
          availability: "available",
          capabilities: [],
          evidence: ["ready"],
          constraints: [],
          observedAt: new Date().toISOString(),
        };
      },
      async execute() {
        return {
          stdout: "x".repeat(70_000),
          stderr: "",
          exitCode: 0,
        };
      },
    });

    const tool = createEnvironmentTools(registry)[0]!;
    const result = await tool.execute(
      { environment: "mock-large", args: ["dump"] },
      {} as any,
    );

    expect(result.length).toBeLessThan(65_000);
    expect(result).toContain("[TRUNCATED:");
  });

  it("refuses execution against unknown providers", async () => {
    const tool = createEnvironmentTools(new EnvironmentRegistry())[0]!;
    const result = await tool.execute(
      { environment: "missing", args: ["x"] },
      {} as any,
    );
    expect(result).toContain("BLOCKED");
  });
});
