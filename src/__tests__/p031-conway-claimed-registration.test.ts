import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { createTestDb } from "./mocks.js";
import {
  claimFinancialEffectDispatch,
  getFinancialEffectByOperationKey,
  prepareFinancialEffect,
} from "../economics/financial-effects.js";
import { createConwayDomainsRegistrationDependencies } from "../conway/domains-claimed-registration.js";
import type { ProviderProcurementScope } from "../economics/provider-procurement-execution.js";

const wallet = "0x1111111111111111111111111111111111111111";
const recipient = "0x2222222222222222222222222222222222222222";
const token = "synthetic.jwt.valid";
const body = { domain: "mysite.io", years: 2, privacy: true };
const quote = {
  x402Version: 2,
  accepts: [{
    scheme: "exact",
    network: "eip155:8453",
    asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    amount: "43750000",
    payTo: recipient,
    maxTimeoutSeconds: 300,
  }],
};
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), {
  status, headers: { "Content-Type": "application/json" },
});

const opened: ReturnType<typeof createTestDb>[] = [];
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  while (opened.length) opened.pop()!.close();
});

function setup(claim = true) {
  const db = createTestDb();
  opened.push(db);
  const scope: ProviderProcurementScope = {
    operationKey: "domain:claimed:one",
    operation: "provision", provider: "conway-domains",
    providerAccountId: "account-controlled", unit: "usdc_cent",
    goalId: "goal-1", taskId: "task-1", pathId: "path-1",
    resourceId: "domain-resource-1", region: "global",
    resourceShape: "registered-domain", paymentRecipient: recipient,
    requestBodySha256: createHash("sha256")
      .update(JSON.stringify(body), "utf8").digest("hex"),
  };
  const authorized = {
    policyDecisionId: "persisted-policy-fixture",
    amountCents: 4375, unit: "usdc_cent",
  };
  if (claim) {
    prepareFinancialEffect(db.raw, {
      operationKey: scope.operationKey,
      effectKind: "provider_resource_procurement",
      provider: "conway-domains", recipient,
      amountCents: 4375, unit: "usdc_cent",
      policyDecisionId: authorized.policyDecisionId,
      request: { ...scope },
      evidence: ["Fixture P-010/P-030 reviewed amount and payTo."],
    });
    claimFinancialEffectDispatch(db.raw, scope.operationKey);
  }
  const signer = {
    address: wallet,
    signMessage: vi.fn(async ({ message }: { message: string }) => {
      expect(message).toContain("api.conway.domains");
      return "0x" + "aa".repeat(65);
    }),
  };
  return { db, scope, authorized, signer };
}

function fixtureProvider(
  options: { quote?: unknown; status?: number; foreign?: boolean; failPost?: boolean } = {},
) {
  const calls: string[] = [];
  const fetcher = vi.fn(async (url: string, init: RequestInit) => {
    calls.push(url);
    expect(new URL(url).origin).toBe("https://api.conway.domains");
    expect(init.redirect).toBe("error");
    expect(new Headers(init.headers).has("X-PAYMENT")).toBe(false);
    expect(new Headers(init.headers).has("PAYMENT-SIGNATURE")).toBe(false);
    if (url.endsWith("/auth/nonce")) {
      return json({ nonce: "nonce1234ABCD" });
    }
    if (url.endsWith("/auth/verify")) {
      return json({ access_token: token });
    }
    if (url.endsWith("/auth/me")) {
      return json({
        id: "account-controlled", wallet_type: "evm",
        wallet_address: options.foreign
          ? "0x3333333333333333333333333333333333333333" : wallet,
      });
    }
    expect(url).toBe("https://api.conway.domains/domains/register");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify(body));
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer " + token);
    if (options.failPost) throw new Error("private provider timeout");
    return json(options.quote ?? quote, options.status ?? 402);
  });
  return { fetcher, calls };
}

describe("P-031 registered-domain quote from claimed canonical financial dispatch", () => {
  it("refuses all supplier networking when no P-030 dispatch claim exists", async () => {
    const { db, scope, authorized, signer } = setup(false);
    const provider = fixtureProvider();
    vi.stubGlobal("fetch", provider.fetcher);
    const deps = createConwayDomainsRegistrationDependencies(db.raw, {
      wallet: signer, observeAuthenticatedEconomics: vi.fn(),
      resolveRegistrationRequest: async () => body,
    });
    await expect(deps.dispatch(scope, authorized))
      .rejects.toMatchObject({ externalEffectNotDispatched: true });
    expect(provider.fetcher).not.toHaveBeenCalled();
  });

  it("refuses a different payment recipient, wrong policy or amount before any authentication", async () => {
    const { db, scope, authorized, signer } = setup();
    const provider = fixtureProvider();
    vi.stubGlobal("fetch", provider.fetcher);
    for (const changed of [
      [{ ...scope, paymentRecipient: wallet }, authorized],
      [scope, { ...authorized, amountCents: 5000 }],
      [scope, { ...authorized, policyDecisionId: "foreign-policy" }],
      [{ ...scope, requestBodySha256: "0".repeat(64) }, authorized],
    ] as const) {
      const deps = createConwayDomainsRegistrationDependencies(db.raw, {
        wallet: signer, observeAuthenticatedEconomics: vi.fn(),
        resolveRegistrationRequest: async () => body,
      });
      await expect(deps.dispatch(changed[0], changed[1]))
        .rejects.toMatchObject({ externalEffectNotDispatched: true });
    }
    expect(provider.fetcher).not.toHaveBeenCalled();
  });

  it("refuses an exact supplier body change even when the quote, payTo and price would match", async () => {
    const { db, scope, authorized, signer } = setup();
    const provider = fixtureProvider();
    vi.stubGlobal("fetch", provider.fetcher);
    const deps = createConwayDomainsRegistrationDependencies(db.raw, {
      wallet: signer, observeAuthenticatedEconomics: vi.fn(),
      resolveRegistrationRequest: async () => ({ ...body, domain: "other.io" }),
    });
    await expect(deps.dispatch(scope, authorized))
      .rejects.toMatchObject({ externalEffectNotDispatched: true });
    expect(provider.fetcher).not.toHaveBeenCalled();
  });

  it("observes an authenticated unsigned 402 once, never paying without a trusted host payment callback", async () => {
    const { db, scope, authorized, signer } = setup();
    const provider = fixtureProvider();
    vi.stubGlobal("fetch", vi.fn(async (url: string, request: RequestInit) => {
      if (url.endsWith("/domains/register")) {
        // The financial UNKNOWN/CAS must be durably visible BEFORE HTTP,
        // not retroactively recorded after receiving provider 402.
        expect(getFinancialEffectByOperationKey(db.raw, scope.operationKey)?.state)
          .toBe("unknown");
      }
      return provider.fetcher(url, request);
    }));
    const deps = createConwayDomainsRegistrationDependencies(db.raw, {
      wallet: signer, observeAuthenticatedEconomics: vi.fn(),
      resolveRegistrationRequest: async () => body,
    });
    await expect(deps.dispatch(scope, authorized))
      .rejects.toMatchObject({ externalEffectNotDispatched: true });
    expect(provider.calls).toHaveLength(4);
    expect(provider.calls.filter(x => x.endsWith("/domains/register"))).toHaveLength(1);
    await expect(deps.dispatch(scope, authorized)).rejects.toThrow(/requires reconciliation/);
    expect(provider.calls).toHaveLength(4);
    expect(getFinancialEffectByOperationKey(db.raw, scope.operationKey)?.state)
      .toBe("unknown");
    // A different adapter instance (or host restart) cannot reissue the
    // same supplier POST, because P-030 persists the external request claim.
    const restarted = createConwayDomainsRegistrationDependencies(db.raw, {
      wallet: signer, observeAuthenticatedEconomics: vi.fn(),
      resolveRegistrationRequest: async () => body,
    });
    await expect(restarted.dispatch(scope, authorized))
      .rejects.toThrow(/requires reconciliation/);
    expect(provider.calls).toHaveLength(4);
  });

  it("does not call the paid host on a quote with a changed price or payTo", async () => {
    for (const item of [
      { amount: "43760000" },
      { payTo: wallet },
    ]) {
      const { db, scope, authorized, signer } = setup();
      const provider = fixtureProvider({
        quote: { ...quote, accepts: [{ ...quote.accepts[0], ...item }] },
      });
      vi.stubGlobal("fetch", provider.fetcher);
      const paid = vi.fn();
      const deps = createConwayDomainsRegistrationDependencies(db.raw, {
        wallet: signer, observeAuthenticatedEconomics: vi.fn(),
        resolveRegistrationRequest: async () => body,
        dispatchAuthorizedPayment: paid,
      });
      await expect(deps.dispatch(scope, authorized))
        .rejects.toMatchObject({ externalEffectNotDispatched: true });
      expect(paid).not.toHaveBeenCalled();
      expect(provider.calls).toHaveLength(4);
      vi.unstubAllGlobals();
    }
  });

  it("only hands exact supplier-matched data to the trusted host paid callback", async () => {
    const { db, scope, authorized, signer } = setup();
    const provider = fixtureProvider();
    vi.stubGlobal("fetch", provider.fetcher);
    const paid = vi.fn(async (args: any) => {
      expect(args.scope).toBe(scope);
      expect(args.authorized).toBe(authorized);
      expect(args.account).toMatchObject({
        status: "wallet_match", providerAccountId: "account-controlled",
      });
      expect(args.token).toBe(token);
      expect(args.requestBody).toBe(JSON.stringify(body));
      expect(args.candidate).toMatchObject({
        status: "scoped_candidate", financialIntentPrepared: false,
        requirement: { payToAddress: recipient, amountMicroUsdc: "43750000" },
        paymentAuthorized: false, purchaseDispatched: false,
      });
      return {
        status: "pending" as const, providerStatus: "registrar_pending",
        evidence: ["Trusted host synthetic paid callback, no real payment."],
      };
    });
    const deps = createConwayDomainsRegistrationDependencies(db.raw, {
      wallet: signer, observeAuthenticatedEconomics: vi.fn(),
      resolveRegistrationRequest: async () => body,
      dispatchAuthorizedPayment: paid,
    });
    const result = await deps.dispatch(scope, authorized);
    expect(result.status).toBe("pending");
    expect(result.evidence.join(" ")).not.toContain(token);
    expect(paid).toHaveBeenCalledTimes(1);
    expect(provider.calls).toHaveLength(4);
  });

  it("preserves UNKNOWN on lost provider response, unexpected 202 and failed paid callback", async () => {
    for (const variant of ["timeout", "unexpected", "paid"] as const) {
      const { db, scope, authorized, signer } = setup();
      const provider = fixtureProvider({
        failPost: variant === "timeout",
        status: variant === "unexpected" ? 202 : 402,
      });
      vi.stubGlobal("fetch", provider.fetcher);
      const deps = createConwayDomainsRegistrationDependencies(db.raw, {
        wallet: signer, observeAuthenticatedEconomics: vi.fn(),
        resolveRegistrationRequest: async () => body,
        ...(variant === "paid"
          ? { dispatchAuthorizedPayment: async () => {
              throw new Error("private paid transport failed");
            } }
          : {}),
      });
      await expect(deps.dispatch(scope, authorized))
        .rejects.toThrow(/outcome UNKNOWN|external effect UNKNOWN|do not replay/);
      expect(provider.calls).toHaveLength(4);
      vi.unstubAllGlobals();
    }
  });

  it("rejects a JWT exposed in the host's paid provider receipt as UNKNOWN", async () => {
    const { db, scope, authorized, signer } = setup();
    const provider = fixtureProvider();
    vi.stubGlobal("fetch", provider.fetcher);
    const deps = createConwayDomainsRegistrationDependencies(db.raw, {
      wallet: signer, observeAuthenticatedEconomics: vi.fn(),
      resolveRegistrationRequest: async () => body,
      dispatchAuthorizedPayment: async () => ({
        status: "pending", providerStatus: "synthetic",
        evidence: ["accidental JWT leak: " + token],
      }),
    });
    await expect(deps.dispatch(scope, authorized))
      .rejects.toThrow(/outcome UNKNOWN/);
    expect(provider.calls).toHaveLength(4);
    expect(getFinancialEffectByOperationKey(db.raw, scope.operationKey)?.state)
      .toBe("unknown");
  });

  it("does not quote a different supplier account after wallet mismatch", async () => {
    const { db, scope, authorized, signer } = setup();
    const provider = fixtureProvider({ foreign: true });
    vi.stubGlobal("fetch", provider.fetcher);
    const paid = vi.fn();
    const deps = createConwayDomainsRegistrationDependencies(db.raw, {
      wallet: signer, observeAuthenticatedEconomics: vi.fn(),
      resolveRegistrationRequest: async () => body,
      dispatchAuthorizedPayment: paid,
    });
    await expect(deps.dispatch(scope, authorized))
      .rejects.toMatchObject({ externalEffectNotDispatched: true });
    expect(provider.calls).toHaveLength(3);
    expect(paid).not.toHaveBeenCalled();
  });
});
