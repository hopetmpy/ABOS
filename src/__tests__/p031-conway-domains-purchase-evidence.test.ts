import { afterEach, describe, expect, it, vi } from "vitest";
import { observeConwayDomainPurchaseEvidence } from "../conway/domains-purchase-evidence.js";
import { createBuiltinTools } from "../agent/tools.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function response(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200, headers: { "content-type": "application/json" },
  });
}

const check = (opts: Record<string, unknown> = {}) => response({
  domains: [{
    domain: "mysite.io", available: true, premium: false,
    price: 35, ...opts,
  }],
});
const catalog = (opts: Record<string, unknown> = {}) => response({
  pricing: [{
    tld: "io", registration: 43.75, renewal: 43.75,
    transfer: 43.75, ...opts,
  }],
});

describe("P-031 Conway Domains read-only acquisition research", () => {
  it("reads only documented public exact-name and catalog URLs with no signature or purchase", async () => {
    const fetcher = vi.fn(async (url: string, options: RequestInit) => {
      const parsed = new URL(url);
      expect(parsed.origin).toBe("https://api.conway.domains");
      expect(options.method).toBe("GET");
      expect(options.redirect).toBe("error");
      expect(options.cache).toBe("no-store");
      expect(options.body).toBeUndefined();
      expect(new Headers(options.headers).has("Authorization")).toBe(false);
      expect(new Headers(options.headers).has("X-PAYMENT")).toBe(false);
      return parsed.pathname === "/domains/check" ? check() : catalog();
    });
    vi.stubGlobal("fetch", fetcher);

    const data = await observeConwayDomainPurchaseEvidence("MySite.IO");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(new URL(fetcher.mock.calls[0]![0]).searchParams.get("domains"))
      .toBe("mysite.io");
    expect(new URL(fetcher.mock.calls[1]![0]).searchParams.get("tlds"))
      .toBe("io");
    expect(data).toMatchObject({
      provider: "conway-domains", domain: "mysite.io",
      status: "observed", available: true, premium: false,
      currency: "USD", domainCheckPriceUsdCents: 3500,
      tldRegistrationUsdCents: 4375, tldRenewalUsdCents: 4375,
      providerAccountId: null, authenticatedWalletAddress: null,
      exactOrderQuoteEstablished: false, paymentAuthorized: false,
      paymentRequiredAmountMicroUsdc: null,
    });
    expect(data.evidence.join(" ")).toContain("NOT interchangeable");
    expect(data.evidence.join(" ")).toContain("P-010");
  });

  it("reports premium domains without assuming the base-TLD catalog is their payable price", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      new URL(url).pathname === "/domains/check"
        ? check({ premium: true, price: 587.5 })
        : catalog()));
    const data = await observeConwayDomainPurchaseEvidence("mysite.io");
    expect(data.premium).toBe(true);
    expect(data.domainCheckPriceUsdCents).toBe(58750);
    expect(data.tldRegistrationUsdCents).toBe(4375);
    expect(data.exactOrderQuoteEstablished).toBe(false);
  });

  it("does not hide independently observed availability when the TLD endpoint fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      new URL(url).pathname === "/domains/check"
        ? check()
        : Promise.reject(new Error("private-provider-details: secret-token"))));
    const report = await observeConwayDomainPurchaseEvidence("mysite.io");
    expect(report.status).toBe("partial");
    expect(report.available).toBe(true);
    expect(report.tldRenewalUsdCents).toBeNull();
    expect(JSON.stringify(report)).not.toContain("secret-token");
  });

  it("rejects ambiguous prices, duplicate exact observations and malformed catalog amounts", async () => {
    for (const row of [
      { registration: "43.75" },
      { registration: -1 },
      { registration: 43.755 },
      { registration: Number.MAX_SAFE_INTEGER },
      { renewal: null },
    ]) {
      vi.stubGlobal("fetch", vi.fn(async (url: string) =>
        new URL(url).pathname === "/domains/check" ? check() : catalog(row)));
      const report = await observeConwayDomainPurchaseEvidence("mysite.io");
      expect(report.status).toBe("partial");
      expect(report.tldRegistrationUsdCents).toBeNull();
      expect(report.paymentAuthorized).toBe(false);
    }
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      new URL(url).pathname === "/domains/check"
        ? response({ domains: [
          { domain: "mysite.io", available: true },
          { domain: "mysite.io", available: false },
        ] })
        : catalog()));
    const ambiguous = await observeConwayDomainPurchaseEvidence("mysite.io");
    expect(ambiguous.status).toBe("partial");
    expect(ambiguous.available).toBeNull();
    expect(ambiguous.tldRegistrationUsdCents).toBe(4375);
  });

  it("rejects URLs, embedded credentials and invalid labels before querying suppliers", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    for (const invalid of [
      "https://api.conway.domains/", "user:secret@mysite.io",
      "http://mysite.io", "localhost", "bad..io",
      "a/b.io", "my site.io", "foo-.io",
    ]) {
      await expect(observeConwayDomainPurchaseEvidence(invalid))
        .rejects.toThrow();
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("exposes the existing agent's read-only provider research tool without a buy operation", async () => {
    const fetcher = vi.fn(async (url: string) =>
      new URL(url).pathname === "/domains/check" ? check() : catalog());
    vi.stubGlobal("fetch", fetcher);
    const tool = createBuiltinTools("fixture").find(t =>
      t.name === "conway_domain_purchase_evidence")!;
    expect(tool).toBeDefined();
    expect(tool.riskLevel).toBe("safe");
    const value = JSON.parse(await tool.execute({ domain: "mysite.io" }, {} as any));
    expect(value).toMatchObject({
      status: "observed", exactOrderQuoteEstablished: false,
      providerAccountId: null, paymentAuthorized: false,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
