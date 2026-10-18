import { afterEach, describe, expect, it, vi } from "vitest";
import { createConwayClient } from "../conway/client.js";
import { ConwayEnvironmentProvider } from "../environments/conway.js";
import { EnvironmentRegistry } from "../environments/registry.js";
import { createEnvironmentTools } from "../environments/tools.js";

afterEach(() => vi.unstubAllGlobals());

function client() {
  return createConwayClient({
    apiUrl: "https://api.conway.tech",
    apiKey: "private-fixture-key",
    sandboxId: "fixture-sandbox",
  });
}

function payload(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
}

describe("P-031 Conway authenticated credit history, read-only and incomplete by design", () => {
  it("reads one bounded uncached page, preserving supplier movement signs without claiming wallet settlement", async () => {
    const mock = vi.fn(async (url: string, options: RequestInit) => {
      expect(new URL(url).pathname).toBe("/v1/credits/history");
      expect(new URL(url).searchParams.get("limit")).toBe("2");
      expect(new URL(url).searchParams.get("offset")).toBe("1");
      expect(options.method).toBe("GET");
      expect(options.body).toBeUndefined();
      expect(options.cache).toBe("no-store");
      expect(new Headers(options.headers).get("Authorization")).toBe("private-fixture-key");
      return payload({ transactions: [
        { id: "txn-1", type: "inference", amount_cents: -12, balance_after_cents: 488, created_at: "2026-10-18T01:00:00Z" },
        { id: "txn-2", type: "topup", amount_cents: 500, balance_after_cents: 500, created_at: "2026-10-18T00:00:00Z" },
      ] });
    });
    vi.stubGlobal("fetch", mock);
    const page = await client().getCreditsHistory!(2, 1);
    expect(mock).toHaveBeenCalledTimes(1);
    expect(page).toEqual({
      completeness: "observed_page", limit: 2, offset: 1,
      entries: [
        { id: "txn-1", type: "inference", amountCents: -12, balanceAfterCents: 488, createdAt: "2026-10-18T01:00:00Z" },
        { id: "txn-2", type: "topup", amountCents: 500, balanceAfterCents: 500, createdAt: "2026-10-18T00:00:00Z" },
      ],
    });
  });

  it("rejects absent, oversized and ambiguously priced history instead of pretending an empty ledger", async () => {
    for (const data of [
      {}, { transactions: null }, { transactions: {} },
      { transactions: [{ type: "topup", amount_cents: "500" }] },
      { transactions: [{ type: "topup", amount_cents: 0.1 }] },
      { transactions: [{ type: "topup", amount_cents: Number.MAX_SAFE_INTEGER + 1 }] },
      { transactions: [{ id: "untyped" }] },
      { transactions: [{ type: "topup" }, { type: "inference" }] },
    ]) {
      const fetcher = vi.fn(async () => payload(data));
      vi.stubGlobal("fetch", fetcher);
      await expect(client().getCreditsHistory!(1, 0)).rejects.toThrow(/UNKNOWN|invalid|ambiguous|incomplete/);
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });

  it("rejects invalid pagination before networking and exposes no signed transaction operation", async () => {
    const mock = vi.fn();
    vi.stubGlobal("fetch", mock);
    await expect(client().getCreditsHistory!(0, 0)).rejects.toThrow(/bounded integer pagination/);
    await expect(client().getCreditsHistory!(101, 0)).rejects.toThrow(/bounded integer pagination/);
    await expect(client().getCreditsHistory!(20, -1)).rejects.toThrow(/bounded integer pagination/);
    await expect(client().getCreditsHistory!(1.5, 0)).rejects.toThrow(/bounded integer pagination/);
    expect(mock).not.toHaveBeenCalled();
  });

  it("keeps the default Conway economics read at balance-only, while opt-in returns a history PAGE not spendable funds", async () => {
    const fetcher = vi.fn(async (url: string, options: RequestInit) => {
      expect(options.method).toBe("GET");
      const path = new URL(url).pathname;
      return path === "/v1/credits/balance"
        ? payload({ balance_cents: 900 })
        : path === "/v1/credits/history"
          ? payload({ data: [
              { id: "supplier-secret-txn", type: "topup", amount_cents: 500, balance_after_cents: 900, timestamp: "2026-10-18T01:00:00Z" },
            ] })
          : (() => { throw new Error("Unexpected economics endpoint"); })();
    });
    vi.stubGlobal("fetch", fetcher);
    const provider = new ConwayEnvironmentProvider(client());
    const defaultReport = await provider.observeEconomics();
    expect(defaultReport.nativeCreditHistory).toBeUndefined();
    expect(defaultReport.nativeCreditBalance?.observedBalanceCents).toBe(900);
    expect(fetcher).toHaveBeenCalledTimes(1);

    const report = await provider.observeEconomics({ includeConwayCreditHistory: true });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(report.nativeCreditHistory).toMatchObject({
      status: "observed_page", accountScope: "authenticated_client_unattributed",
      unit: "credit_cent", offset: 0, limit: 20,
      entries: [{ type: "topup", amountCents: 500, balanceAfterCents: 900 }],
    });
    expect(report.provider).toBe("conway");
    expect(report.accountId).toBeNull();
    expect(report.procurementAuthority).toBe("not_established");
    expect(report.spendableLiquidityUsdCents).toBeNull();
    expect(JSON.stringify(report)).not.toContain("supplier-secret-txn");
    expect(JSON.stringify(report)).not.toContain("private-fixture-key");
  });

  it("does not suppress independently requested history when provider balance data is malformed", async () => {
    const fetcher = vi.fn(async (url: string) => {
      const path = new URL(url).pathname;
      return path === "/v1/credits/balance"
        ? payload({ balance_cents: "not-a-number" })
        : path === "/v1/credits/history"
          ? payload({ transactions: [
              { type: "inference", amount_cents: -8, balance_after_cents: 492,
                timestamp: "2026-10-18T01:00:00Z" },
            ] })
          : (() => { throw new Error("Unexpected endpoint"); })();
    });
    vi.stubGlobal("fetch", fetcher);
    const observed = await new ConwayEnvironmentProvider(client()).observeEconomics({
      includeConwayCreditHistory: true,
    });
    expect(observed.status).toBe("unknown");
    expect(observed.nativeCreditBalance).toBeUndefined();
    expect(observed.nativeCreditHistory).toMatchObject({
      status: "observed_page", entries: [{ type: "inference", amountCents: -8 }],
    });
    expect(observed.procurementAuthority).toBe("not_established");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("passes opt-in through existing environment economic evidence tool without authorizing procurement", async () => {
    const fetcher = vi.fn(async (url: string) => {
      const endpoint = new URL(url).pathname;
      return endpoint === "/v1/credits/balance"
        ? payload({ balance_cents: 400 })
        : endpoint === "/v1/credits/history"
          ? payload({ transactions: [
              { id: "not-for-LLM", type: "inference", amount_cents: -2,
                balance_after_cents: 400, created_at: "2026-10-18T02:00:00Z" },
            ] })
          : (() => { throw new Error("Unexpected tool provider request"); })();
    });
    vi.stubGlobal("fetch", fetcher);
    const registry = new EnvironmentRegistry();
    registry.register(new ConwayEnvironmentProvider(client()));
    const tool = createEnvironmentTools(registry).find(t =>
      t.name === "environment_economic_evidence")!;
    const output = await tool.execute({
      environment: "conway", include_conway_credit_history: true,
    }, {} as any);
    expect(output).toContain("observed_page");
    expect(output).toContain("not_established");
    expect(output).not.toContain("not-for-LLM");
    expect(output).not.toContain("private-fixture-key");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("preserves UNKNOWN if the history endpoint fails without hiding independently observed balance", async () => {
    const fetcher = vi.fn(async (url: string) => {
      const path = new URL(url).pathname;
      return path === "/v1/credits/balance"
        ? payload({ balance_cents: 900 })
        : Promise.reject(Object.assign(new Error("private-fixture-key leaked by supplier"), { status: 503 }));
    });
    vi.stubGlobal("fetch", fetcher);
    const report = await new ConwayEnvironmentProvider(client()).observeEconomics({
      includeConwayCreditHistory: true,
    });
    expect(report.status).toBe("partial");
    expect(report.nativeCreditBalance?.observedBalanceCents).toBe(900);
    expect(report.nativeCreditHistory).toMatchObject({ status: "unavailable", entries: [] });
    expect(report.nativeCreditHistory?.evidence.join(" ")).toContain("UNKNOWN");
    expect(JSON.stringify(report)).not.toContain("private-fixture-key");
  });
});
