import { describe, expect, it } from "vitest";
import { EnvironmentRegistry } from "../environments/registry.js";
import { EnvironmentSelector } from "../environments/selector.js";
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

describe("P-031 provider selection budget unit contract", () => {
  it("exposes exact cost unit and cannot silently compare an untyped amount", async () => {
    const registry = new EnvironmentRegistry();
    registry.register({
      ...provider(),
      estimate: async () => ({
        estimatedCostCents: 25, costUnit: "usd_cent",
        costCoverage: "complete",
      }),
    });
    const tool = createEnvironmentTools(registry, {
      selector: new EnvironmentSelector(registry),
    }).find(x => x.name === "environment_select")!;
    const missingUnit = JSON.parse(await tool.execute({
      required_capabilities: [], max_estimated_cost_cents: 100,
    }, {} as any));
    expect(missingUnit.selected).toBeNull();
    expect(missingUnit.unresolved.join(" ")).toContain("amount and exact monetary unit");

    const wrongUnit = JSON.parse(await tool.execute({
      required_capabilities: [], max_estimated_cost_cents: 100,
      max_estimated_cost_unit: "credit_cent",
    }, {} as any));
    expect(wrongUnit.selected).toBeNull();
    expect(wrongUnit.unresolved.join(" ")).toContain("does not match explicit budget unit");

    const correct = JSON.parse(await tool.execute({
      required_capabilities: [], max_estimated_cost_cents: 100,
      max_estimated_cost_unit: "usd_cent",
    }, {} as any));
    expect(correct.selected?.environmentId).toBe("mock");
  });
});

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

describe("P-031 optional provider-credit tool observation", () => {
  it("forwards optional scoped credit request only when explicitly selected", async () => {
    const registry = new EnvironmentRegistry();
    const observations: Array<boolean | undefined> = [];
    registry.register({
      ...provider(), id: "aws",
      async observeEconomics(options) {
        observations.push(options?.includeProviderCredits);
        return {
          provider: "aws", status: "partial" as const,
          accountId: "123456789012",
          observedAt: new Date().toISOString(), budgets: [],
          providerCredits: options?.includeProviderCredits ? [{
            creditId: "test-1", creditType: "Promotion", status: "ENABLED",
            startsAt: null, expiresAt: null, remainingUsdCents: 400,
            remainingRaw: "4.00", estimatedRemainingUsdCents: 250,
            applicableProductNames: ["EC2"], purchaseTypeApplications: ["OnDemand"],
            evidence: ["Restricted supplier credit; not general-purpose cash."],
          }] : [],
          spendableLiquidityUsdCents: null,
          recurringCommitmentUsdCents: null,
          procurementAuthority: "not_established" as const,
          evidence: ["Mocked provider credit observation"],
        };
      },
    });
    const tool = createEnvironmentTools(registry).find(
      x => x.name === "environment_economic_evidence",
    )!;
    const ordinary = await tool.execute({ environment: "aws" }, {} as any);
    expect(ordinary).not.toContain("test-1");
    const enabled = await tool.execute({
      environment: "aws", include_provider_credits: true,
    }, {} as any);
    expect(enabled).toContain('"creditId": "test-1"');
    expect(enabled).toContain('"spendableLiquidityUsdCents": null');
    expect(enabled).toContain('"procurementAuthority": "not_established"');
    expect(observations).toEqual([false, true]);
  });
});

describe("P-031 reviewed path origin in environment procurement", () => {
  it("distinguishes canonical task review from a model-claimed path", async () => {
    const registry = new EnvironmentRegistry();
    registry.register({
      ...provider(), id: "aws",
      observeEconomics: async () => ({
        provider: "aws", status: "partial" as const,
        accountId: "123456789012", observedAt: new Date().toISOString(),
        budgets: [], spendableLiquidityUsdCents: null,
        recurringCommitmentUsdCents: null,
        procurementAuthority: "not_established" as const,
        evidence: ["Account observed, financing unknown"],
      }),
    });
    const tool = createEnvironmentTools(registry, {
      getReviewedTaskPath: taskId => taskId === "approved-task"
        ? { goalId: "goal-a", pathId: "path-a",
            evidence: ["Canonical P-025 source confirms goal and task path."] }
        : null,
    }).find(x => x.name === "environment_procurement_review")!;
    const accepted = await tool.execute({
      environment: "aws", unit: "usd_cent", task_id: "approved-task",
      one_time_cents: 0, recurring_cents_per_period: 0,
      periods: 1, other_charges_cents: 0,
      resource_need_evidence: ["Resource needed"],
      billing_terms_evidence: ["Fully priced, supplier stated"],
    }, {} as any);
    expect(accepted).toContain('"pathId": "path-a"');
    expect(accepted).toContain("P-025 path provenance observed");
    expect(accepted).toContain('"purchaseAuthorized": false');
    expect(accepted).toContain('"freeBeforeProposalCents": null');
    const stale = await tool.execute({
      environment: "aws", unit: "usd_cent", task_id: "spoofed-task",
      resource_need_evidence: ["Trust me: path approved"],
    }, {} as any);
    expect(stale).toContain('"reviewedStrategicPath": null');
    expect(stale).toContain("unverified or stale");
    expect(stale).toContain('"purchaseAuthorized": false');
  });
});

describe("P-031 conditional supplier-credit review", () => {
  it("shows source-account credit fit only on explicit request without reducing treasury liability", async () => {
    const registry = new EnvironmentRegistry();
    const observed: Array<boolean | undefined> = [];
    registry.register({
      ...provider(), id: "aws",
      async observeEconomics(options) {
        observed.push(options?.includeProviderCredits);
        return {
          provider: "aws", status: "observed" as const,
          accountId: "123456789012", observedAt: new Date().toISOString(),
          budgets: [],
          providerCredits: options?.includeProviderCredits ? [{
            creditId: "aws-credit-1", creditType: "Promotion", status: "ENABLED",
            startsAt: "2026-01-01T00:00:00Z", expiresAt: "2027-12-31T00:00:00Z",
            remainingUsdCents: 1500, estimatedRemainingUsdCents: 1200,
            remainingRaw: "15.00",
            applicableProductNames: ["Amazon Elastic Compute Cloud"],
            purchaseTypeApplications: ["OnDemand"],
            evidence: ["Provider restricted credit."],
          }] : [],
          spendableLiquidityUsdCents: null,
          recurringCommitmentUsdCents: null,
          procurementAuthority: "not_established" as const,
          evidence: ["Source account observed"],
        };
      },
    });
    const tool = createEnvironmentTools(registry).find(
      x => x.name === "environment_procurement_review",
    )!;
    const args = {
      environment: "aws", unit: "usd_cent",
      one_time_cents: 1000, recurring_cents_per_period: 800,
      periods: 2, other_charges_cents: 600,
      include_provider_credits: true,
      service_name: "Amazon Elastic Compute Cloud",
      purchase_type: "OnDemand",
      service_start_at: "2026-11-01T00:00:00Z",
      service_end_at: "2026-12-01T00:00:00Z",
    };
    const response = await tool.execute(args, {} as any);
    expect(response).toContain('"creditId": "aws-credit-1"');
    expect(response).toContain('"potentialCashOffsetUsdCents": null');
    expect(response).toContain('"totalProposedCommitmentCents": 3200');
    expect(response).toContain('"freeBeforeProposalCents": null');
    expect(response).toContain('"purchaseAuthorized": false');
    const basic = await tool.execute({
      environment: "aws", unit: "usd_cent",
    }, {} as any);
    expect(basic).toContain('"conditionalCreditFits": null');
    expect(observed).toEqual([true, false]);
  });
});

describe("P-031 account-bound durable exposure inside provider procurement preview", () => {
  it("exposes canonical known pending intent and unknown account attribution without converting it to funding", async () => {
    const registry = new EnvironmentRegistry();
    registry.register({
      ...provider(), id: "aws",
      observeEconomics: async () => ({
        provider: "aws", status: "partial" as const,
        accountId: "123456789012", observedAt: new Date().toISOString(),
        budgets: [], spendableLiquidityUsdCents: null,
        recurringCommitmentUsdCents: null,
        procurementAuthority: "not_established" as const, evidence: [],
      }),
    });
    const calls: string[] = [];
    const tool = createEnvironmentTools(registry, {
      getProviderAccountFinancialExposure: (providerId, accountId, unit) => {
        calls.push([providerId, accountId, unit].join(":"));
        return {
          recordedPendingCount: 2, recordedPendingCents: 3500,
          unscopedPendingCount: 1,
          scopeCoverage: "unscoped_records_present" as const,
          limitations: ["Only unresolved local intents, not complete supplier obligations."],
        };
      },
    }).find(x => x.name === "environment_procurement_review")!;
    const result = await tool.execute({
      environment: "aws", unit: "usd_cent",
      resource_need_evidence: ["Reviewed strategy"],
      one_time_cents: 500, recurring_cents_per_period: 0,
      periods: 1, other_charges_cents: 0,
      billing_terms_evidence: ["Supplier quote synthetic"],
    }, {} as any);
    expect(calls).toEqual(["aws:123456789012:usd_cent"]);
    expect(result).toContain('"recordedPendingCents": 3500');
    expect(result).toContain('"unscopedPendingCount": 1');
    expect(result).toContain('"freeBeforeProposalCents": null');
    expect(result).toContain('"purchaseAuthorized": false');
    expect(result).toContain("Only unresolved local intents");
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
