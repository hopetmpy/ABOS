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
