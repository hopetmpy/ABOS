import { afterEach, describe, expect, it, vi } from "vitest";
import { observeConwayDomainPurchaseEvidence, inspectConwayDomainsX402Version2 } from "../conway/domains-purchase-evidence.js";
import { createBuiltinTools } from "../agent/tools.js";
import { bindConwayDomainsRegistration402 } from "../conway/domains-order-binding.js";

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

const validConwayDomains402 = {
  x402Version: 2,
  accepts: [{
    scheme: "exact",
    network: "eip155:8453",
    asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    amount: "43750000",
    payTo: "0x1111111111111111111111111111111111111111",
    maxTimeoutSeconds: 300,
  }],
};

describe("P-031 supplier native x402 v2 402 inspection (no payment)", () => {
  it("parses the exact documented amount/asset/payTo format as informational evidence, never purchase authority", () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const result = inspectConwayDomainsX402Version2(402, validConwayDomains402);
    expect(result).toMatchObject({
      provider: "conway-domains", status: "requirements_observed",
      reasonCode: "payment_required",
      requirement: {
        scheme: "exact", network: "eip155:8453",
        amountMicroUsdc: "43750000",
        policyAmountCents: 4375, timeoutSeconds: 300,
      },
      providerAccountId: null, exactOrderQuoteEstablished: false,
      paymentAuthorized: false, purchaseDispatched: false,
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rounds sub-cent USDC conservatively without float conversion", () => {
    const req = structuredClone(validConwayDomains402);
    req.accepts[0]!.amount = "1";
    expect(inspectConwayDomainsX402Version2(402, req).requirement)
      .toMatchObject({ amountMicroUsdc: "1", policyAmountCents: 1 });
    req.accepts[0]!.amount = "10001";
    expect(inspectConwayDomainsX402Version2(402, req).requirement)
      .toMatchObject({ amountMicroUsdc: "10001", policyAmountCents: 2 });
  });

  it("rejects forged asset, recipient, or mixed legacy amount/recipient fields", () => {
    const cases: unknown[] = [
      { asset: "0x2222222222222222222222222222222222222222" },
      { payTo: "not-an-address" },
      { maxAmountRequired: "1" },
      { payToAddress: "0x2222222222222222222222222222222222222222" },
      { usdcAddress: "0x2222222222222222222222222222222222222222" },
      { amount: "-1" },
      { amount: "43.75" },
      { amount: "1000000000000000000000000000000000000000000" },
      { maxTimeoutSeconds: 0 },
      { maxTimeoutSeconds: 90000 },
    ];
    for (const changes of cases) {
      const body = {
        ...validConwayDomains402,
        accepts: [{ ...validConwayDomains402.accepts[0], ...(changes as Record<string, unknown>) }],
      };
      const result = inspectConwayDomainsX402Version2(402, body);
      expect(result.status).toBe("unavailable");
      expect(result.requirement).toBeNull();
      expect(result.paymentAuthorized).toBe(false);
    }
  });

  it("rejects duplicate compatible offers, unsupported supplier networks and malformed payload", () => {
    const duplicate = {
      ...validConwayDomains402,
      accepts: [
        validConwayDomains402.accepts[0],
        { ...validConwayDomains402.accepts[0], amount: "43760000" },
      ],
    };
    expect(inspectConwayDomainsX402Version2(402, duplicate).reasonCode)
      .toBe("ambiguous_offers");
    const alternate = {
      ...validConwayDomains402,
      accepts: [{ ...validConwayDomains402.accepts[0], network: "solana:mainnet" }],
    };
    expect(inspectConwayDomainsX402Version2(402, alternate).reasonCode)
      .toBe("no_supported_offer");
    expect(inspectConwayDomainsX402Version2(402, {
      ...validConwayDomains402, x402Version: 1,
    }).status).toBe("unavailable");
    expect(inspectConwayDomainsX402Version2(402, null).status).toBe("unavailable");
  });

  it("treats unexpected 201/202 and provider errors as unknown external effects, without retries", () => {
    for (const status of [200, 201, 202, 401, 500]) {
      const result = inspectConwayDomainsX402Version2(status, validConwayDomains402);
      expect(result).toMatchObject({
        status: "unavailable", reasonCode: "unexpected_http_status",
        exactOrderQuoteEstablished: false, paymentAuthorized: false,
        purchaseDispatched: false, requirement: null,
      });
      expect(result.evidence.join(" ")).toContain("do not retry");
    }
  });
});

const scopedEvmAccount = {
  provider: "conway-domains" as const,
  status: "wallet_match" as const,
  providerAccountId: "usr_owned_1",
  walletAddress: "0x1111111111111111111111111111111111111111",
  walletType: "evm" as const,
  purchaseAuthority: "not_established" as const,
  financingUnit: null,
  evidence: ["Fixture-only supplier account, not real ownership."],
};
const proposedRegistration = {
  domain: "mysite.io", years: 2, privacy: true,
  nameservers: ["ns1.example.com", "ns2.example.com"],
};
function bindFixture(overrides: Record<string, unknown> = {}) {
  return bindConwayDomainsRegistration402({
    account: scopedEvmAccount,
    expectedControlledWalletAddress: scopedEvmAccount.walletAddress,
    expectedControlledWalletType: "evm",
    plannedRequest: proposedRegistration,
    submittedBody: JSON.stringify(proposedRegistration),
    httpStatus: 402,
    payload: validConwayDomains402,
    ...overrides,
  });
}

describe("P-031 exact registration body/402 candidate binding (pure)", () => {
  it("binds domain/years/privacy/nameservers and atomic USDC to a scoped candidate without any financial authority", () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const result = bindFixture();
    expect(result).toMatchObject({
      provider: "conway-domains", status: "scoped_candidate",
      accountId: "usr_owned_1", walletType: "evm",
      request: proposedRegistration,
      requirement: {
        network: "eip155:8453", amountMicroUsdc: "43750000",
        policyAmountCents: 4375,
      },
      authenticatedOrderQuoteEstablished: false,
      financialIntentPrepared: false,
      paymentAuthorized: false, purchaseDispatched: false,
    });
    expect(result.candidateFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(result.requestBodySha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.evidence.join(" ")).toContain("UNKNOWN");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects any body mismatch: years, privacy, domain or nameserver ordering", () => {
    const changes: Record<string, unknown>[] = [
      { years: 1 }, { years: 10 }, { privacy: false },
      { domain: "other.io" },
      { nameservers: ["ns2.example.com", "ns1.example.com"] },
    ];
    for (const change of changes) {
      const result = bindFixture({
        submittedBody: JSON.stringify({ ...proposedRegistration, ...change }),
      });
      expect(result).toMatchObject({
        status: "unavailable", reason: "body_mismatch",
        request: null, requirement: null,
        paymentAuthorized: false, purchaseDispatched: false,
      });
    }
  });

  it("rejects unknown extra parameters, malformed domains, invalid years, duplicate nameservers and oversized body", () => {
    const malformed: unknown[] = [
      { ...proposedRegistration, promotionCode: "wrong-owner" },
      { ...proposedRegistration, domain: "MYsite.io" },
      { ...proposedRegistration, years: 0 },
      { ...proposedRegistration, years: 11 },
      { ...proposedRegistration, nameservers: ["ns1.example.com", "ns1.example.com"] },
      { ...proposedRegistration, privacy: "true" },
    ];
    for (const wrong of malformed) {
      expect(bindFixture({ plannedRequest: wrong }).reason).toBe("body_invalid");
    }
    expect(bindFixture({ submittedBody: "{broken" }).reason).toBe("body_invalid");
    expect(bindFixture({ submittedBody: " ".repeat(9000) }).reason).toBe("body_invalid");
  });

  it("rejects a foreign wallet/account or unsupported Solana wallet for Base EVM x402", () => {
    expect(bindFixture({
      expectedControlledWalletAddress: "0x2222222222222222222222222222222222222222",
    }).reason).toBe("wallet_unverified");
    expect(bindFixture({
      account: { ...scopedEvmAccount, status: "wallet_mismatch",
        providerAccountId: null, walletAddress: null, walletType: null },
    }).reason).toBe("wallet_unverified");
    expect(bindFixture({
      account: { ...scopedEvmAccount, walletType: "solana" },
      expectedControlledWalletType: "solana",
    }).reason).toBe("unsupported_wallet_route");
  });

  it("rejects a non-402 response or malformed/duplicate provider requirements", () => {
    expect(bindFixture({ httpStatus: 202 }).reason).toBe("not_a_supported_402");
    expect(bindFixture({ httpStatus: 201 }).reason).toBe("not_a_supported_402");
    expect(bindFixture({
      payload: { x402Version: 2, accepts: [] },
    }).reason).toBe("not_a_supported_402");
    expect(bindFixture({
      payload: { ...validConwayDomains402,
        accepts: [...validConwayDomains402.accepts, ...validConwayDomains402.accepts] },
    }).reason).toBe("not_a_supported_402");
  });

  it("distinguishes amount, recipient, account and actual transmitted body bytes in fingerprint", () => {
    const baseline = bindFixture();
    const amount = bindFixture({ payload: {
      ...validConwayDomains402,
      accepts: [{ ...validConwayDomains402.accepts[0], amount: "43760000" }],
    } });
    const account = bindFixture({ account: {
      ...scopedEvmAccount, providerAccountId: "usr_owned_2",
    } });
    const spaced = bindFixture({
      submittedBody: JSON.stringify(proposedRegistration, null, 2),
    });
    for (const candidate of [amount, account, spaced]) {
      expect(candidate.status).toBe("scoped_candidate");
      expect(candidate.candidateFingerprint).not.toBe(baseline.candidateFingerprint);
    }
    expect(spaced.request).toEqual(baseline.request);
    expect(spaced.requestBodySha256).not.toBe(baseline.requestBodySha256);
    expect(bindFixture().candidateFingerprint).toBe(baseline.candidateFingerprint);
  });
});
