import { afterEach, describe, expect, it, vi } from "vitest";
import { createConwayClient } from "../conway/client.js";
import {
  probeConwayAccountReadOnly,
  type ConwayReadOnlySource,
} from "../conway/read-only-account-probe.js";

afterEach(() => vi.unstubAllGlobals());

describe("P-031 Conway authenticated GET-only diagnostic", () => {
  it("reads balance, provider inventory and advertised tiers once, without mutating or claiming an owned account", async () => {
    const called = vi.fn(async (url: string | URL, options: RequestInit) => {
      const pathname = new URL(String(url)).pathname;
      const payload = pathname === "/v1/credits/balance"
        ? { balance_cents: 1200 }
        : pathname === "/v1/sandboxes"
          ? { data: [
              { id: "sandbox-a", status: "running", region: "us-east",
                vcpu: 2, memory_mb: 2048, disk_gb: 10 },
              { id: "sandbox-b", status: "stopped", region: "us-east",
                vcpu: 1, memory_mb: 512, disk_gb: 1 },
            ] }
          : pathname === "/v1/credits/pricing"
            ? { tiers: [
                { name: "test-tier", vcpu: 2, memory_mb: 2048,
                  disk_gb: 10, monthly_cents: 1200 },
              ] }
            : (() => { throw new Error("Unexpected endpoint"); })();
      expect(options.method).toBe("GET");
      expect(options.body).toBeUndefined();
      expect(new Headers(options.headers).get("Authorization")).toBe("secret-test-key");
      return new Response(JSON.stringify(payload), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", called);
    const client = createConwayClient({
      apiUrl: "https://api.conway.tech",
      apiKey: "secret-test-key",
      sandboxId: "runtime-sandbox",
    });
    const report = await probeConwayAccountReadOnly(client,
      () => new Date("2026-10-17T18:00:00Z"));
    expect(called).toHaveBeenCalledTimes(3);
    expect(called.mock.calls.map(([url]) => new URL(String(url)).pathname).sort())
      .toEqual([
        "/v1/credits/balance", "/v1/credits/pricing", "/v1/sandboxes",
      ]);
    expect(report.observedAt).toBe("2026-10-17T18:00:00.000Z");
    expect(report.balance).toMatchObject({
      status: "observed", observedCents: 1200, unit: "credit_cent",
    });
    expect(report.inventory).toMatchObject({
      status: "observed", providerListedSandboxCount: 2,
      reportedRunningCount: 1, abosOwnedReusableCount: null,
    });
    expect(report.pricing).toMatchObject({
      status: "partial", advertisedTierCount: 1,
      exactChargedUnit: null, totalContractCost: null,
    });
    expect(report.externalAccountOwnership).toBe("not_verified");
    expect(report.providerAccountId).toBeNull();
    expect(report.verifiedFreeFunds).toBeNull();
    expect(report.purchaseAuthority).toBe("not_established");
    expect(JSON.stringify(report)).not.toContain("secret-test-key");
    expect(JSON.stringify(report)).not.toContain("sandbox-a");
  });

  it("does not turn duplicated provider sandbox identifiers into a complete inventory", async () => {
    const report = await probeConwayAccountReadOnly({
      getCreditsBalance: async () => 200,
      listSandboxes: async () => [
        { id: "same-sandbox", status: "running", region: "us-east",
          vcpu: 1, memoryMb: 512, diskGb: 5, createdAt: "" },
        { id: "same-sandbox", status: "stopped", region: "us-east",
          vcpu: 1, memoryMb: 512, diskGb: 5, createdAt: "" },
      ],
      getCreditsPricing: async () => [],
    });
    expect(report.inventory).toMatchObject({
      status: "unknown", providerListedSandboxCount: null,
      reportedRunningCount: null, abosOwnedReusableCount: null,
      failureKind: "read_failed",
    });
    expect(report.purchaseAuthority).toBe("not_established");
    expect(report.verifiedFreeFunds).toBeNull();
  });

  it("does not promote a negative balance or a synthetic supplier list into capital and owned inventory", async () => {
    const reads = {
      getCreditsBalance: vi.fn(async () => -120),
      listSandboxes: vi.fn(async () => [{
        id: "third-party", status: "running", region: "us-east",
        vcpu: 1, memoryMb: 512, diskGb: 5, createdAt: "",
      }]),
      getCreditsPricing: vi.fn(async () => [{
        name: "tier", vcpu: 1, memoryMb: 512, diskGb: 5,
        monthlyCents: 900,
      }]),
    } satisfies ConwayReadOnlySource;
    const report = await probeConwayAccountReadOnly(reads);
    expect(report.balance.observedCents).toBe(-120);
    expect(report.inventory.providerListedSandboxCount).toBe(1);
    expect(report.inventory.abosOwnedReusableCount).toBeNull();
    expect(report.verifiedFreeFunds).toBeNull();
    expect(report.purchaseAuthority).toBe("not_established");
    for (const fn of Object.values(reads)) expect(fn).toHaveBeenCalledTimes(1);
  });

  it("isolates supplier failures, preserves UNKNOWN instead of zero and never emits provider response bodies or credentials", async () => {
    const authFailure = Object.assign(new Error(
      "Authorization secret-key and private resource id in provider response",
    ), { status: 403 });
    const unavailable = Object.assign(new Error("provider body with secret-key"),
      { status: 503 });
    const reads: ConwayReadOnlySource = {
      getCreditsBalance: async () => { throw authFailure; },
      listSandboxes: async () => { throw unavailable; },
      getCreditsPricing: async () => [],
    };
    const report = await probeConwayAccountReadOnly(reads);
    expect(report.balance).toMatchObject({
      status: "unknown", observedCents: null,
      failureKind: "authentication_rejected",
    });
    expect(report.inventory).toMatchObject({
      status: "unknown", providerListedSandboxCount: null,
      failureKind: "provider_unavailable",
    });
    expect(report.pricing.status).toBe("unknown");
    expect(report.pricing.advertisedTierCount).toBe(0);
    expect(report.verifiedFreeFunds).toBeNull();
    expect(JSON.stringify(report)).not.toContain("secret-key");
    expect(JSON.stringify(report)).not.toContain("private resource");
  });

  it.each([
    [{ tiers: [{ name: "small", vcpu: 1, memory_mb: 512, disk_gb: 5, monthly_cents: 200 }] }, 200],
    [{ pricing: [{ name: "legacy", vcpu: 2, memory_mb: 2048, disk_gb: 10, monthly_cents: 800 }] }, 800],
    [{ data: [{ name: "data", vcpu: 1, memory_mb: 512, disk_gb: 5, monthly_cents: 0 }] }, 0],
  ])("preserves exact observed provider-priced tiers without deducing complete contract", async (payload, amount) => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(payload), {
      status: 200, headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetcher);
    const client = createConwayClient({
      apiUrl: "https://api.conway.tech", apiKey: "test-secret", sandboxId: "sbx",
    });
    const tiers = await client.getCreditsPricing();
    expect(tiers).toHaveLength(1);
    expect(tiers[0]?.monthlyCents).toBe(amount);
    const report = await probeConwayAccountReadOnly({
      getCreditsBalance: async () => 500,
      listSandboxes: async () => [],
      getCreditsPricing: async () => tiers,
    });
    expect(report.pricing.status).toBe("partial");
    expect(report.pricing.advertisedTierCount).toBe(1);
    expect(report.pricing.exactChargedUnit).toBeNull();
    expect(report.billingContract).toBe("not_verified");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    {},
    { tiers: null },
    { tiers: { name: "not-an-array" } },
    { tiers: [{ name: "missing price", vcpu: 1, memory_mb: 512, disk_gb: 5 }] },
    { tiers: [{ name: "text price", vcpu: 1, memory_mb: 512, disk_gb: 5, monthly_cents: "0" }] },
    { tiers: [{ name: "fractional", vcpu: 1, memory_mb: 512, disk_gb: 5, monthly_cents: 0.3 }] },
    { tiers: [{ name: "negative", vcpu: 1, memory_mb: 512, disk_gb: 5, monthly_cents: -100 }] },
    { tiers: [{ name: "invalid capacity", vcpu: 0, memory_mb: 512, disk_gb: 5, monthly_cents: 10 }] },
    { tiers: [null] },
  ])("rejects missing or imprecise Conway price source rather than fabricating a free tier", async payload => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(payload), {
      status: 200, headers: { "Content-Type": "application/json" },
    })));
    const client = createConwayClient({
      apiUrl: "https://api.conway.tech", apiKey: "secret", sandboxId: "sbx",
    });
    await expect(client.getCreditsPricing()).rejects.toThrow(/UNKNOWN|invalid/i);
    const report = await probeConwayAccountReadOnly({
      getCreditsBalance: async () => 500,
      listSandboxes: async () => [],
      getCreditsPricing: () => client.getCreditsPricing(),
    });
    expect(report.pricing.status).toBe("unknown");
    expect(report.pricing.advertisedTierCount).toBeNull();
    expect(report.verifiedFreeFunds).toBeNull();
    expect(JSON.stringify(report)).not.toContain("secret");
  });

  it("does not interpret invalid provider price tiers as a complete contract", async () => {
    const reads: ConwayReadOnlySource = {
      getCreditsBalance: async () => 0,
      listSandboxes: async () => [],
      getCreditsPricing: async () => [{
        name: "", vcpu: 0, memoryMb: 0, diskGb: 0, monthlyCents: 0,
      }],
    };
    const report = await probeConwayAccountReadOnly(reads);
    expect(report.balance.observedCents).toBe(0);
    expect(report.inventory.providerListedSandboxCount).toBe(0);
    expect(report.pricing).toMatchObject({
      status: "unknown", advertisedTierCount: null, totalContractCost: null,
    });
    expect(report.billingContract).toBe("not_verified");
  });
});
