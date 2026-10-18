import { afterEach, describe, expect, it, vi } from "vitest";
import { observeConwayDomainsAuthenticatedAccount } from "../conway/domains-account-proof.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const controlled = "0x1111111111111111111111111111111111111111";
const unrelated = "0x2222222222222222222222222222222222222222";
const getSession = vi.fn(async () => "synthetic.jwt.provider.signature");
const payload = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { "Content-Type": "application/json" },
});

describe("P-031 Conway Domains wallet-bound authenticated account proof", () => {
  it("observes exact supplier /auth/me identity without signing or paying, and never grants financial authority", async () => {
    const fetcher = vi.fn(async (url: string, opts: RequestInit) => {
      expect(url).toBe("https://api.conway.domains/auth/me");
      expect(opts.method).toBe("GET");
      expect(opts.redirect).toBe("error");
      expect(opts.cache).toBe("no-store");
      expect(opts.body).toBeUndefined();
      expect(new Headers(opts.headers).get("Authorization"))
        .toBe("Bearer synthetic.jwt.provider.signature");
      expect(new Headers(opts.headers).has("X-PAYMENT")).toBe(false);
      return payload({
        id: "supplier-user-synthetic", wallet_address: controlled.toUpperCase().replace("0X","0x"),
        wallet_type: "evm",
      });
    });
    vi.stubGlobal("fetch", fetcher);
    const proof = await observeConwayDomainsAuthenticatedAccount(getSession, controlled);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(proof).toMatchObject({
      status: "wallet_match", provider: "conway-domains",
      providerAccountId: "supplier-user-synthetic", walletType: "evm",
      purchaseAuthority: "not_established", financingUnit: null,
    });
    expect(JSON.stringify(proof)).not.toContain("synthetic.jwt.provider.signature");
  });

  it("does not expose or adopt another authenticated wallet/account", async () => {
    const fetcher = vi.fn(async () => payload({
      id: "unrelated-user", wallet_address: unrelated, wallet_type: "evm",
    }));
    vi.stubGlobal("fetch", fetcher);
    const result = await observeConwayDomainsAuthenticatedAccount(getSession, controlled);
    expect(result).toMatchObject({
      status: "wallet_mismatch", providerAccountId: null,
      walletAddress: null, purchaseAuthority: "not_established",
    });
    expect(JSON.stringify(result)).not.toContain("unrelated-user");
    expect(JSON.stringify(result)).not.toContain(unrelated);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not issue network requests when JWT callback or controlled wallet is missing", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    expect((await observeConwayDomainsAuthenticatedAccount(
      async () => null, controlled,
    )).status).toBe("unavailable");
    expect((await observeConwayDomainsAuthenticatedAccount(
      async () => "short", controlled,
    )).status).toBe("unavailable");
    expect((await observeConwayDomainsAuthenticatedAccount(
      getSession, "not-a-wallet",
    )).status).toBe("unavailable");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("returns UNKNOWN on expired supplier JWT, unexpected identity shape or transport errors", async () => {
    const responses = [
      () => payload({ error: "token revoked" }, 401),
      () => payload({ id: "user", wallet_type: "evm", wallet_address: "bad" }),
      () => payload({ id: "user", wallet_type: "solana", wallet_address: controlled }),
      () => Promise.reject(new Error("private-provider-secret-should-not-leak")),
    ];
    for (const answer of responses) {
      vi.stubGlobal("fetch", vi.fn(answer));
      const result = await observeConwayDomainsAuthenticatedAccount(getSession, controlled);
      expect(result).toMatchObject({
        status: "unavailable", providerAccountId: null,
        purchaseAuthority: "not_established", financingUnit: null,
      });
      expect(JSON.stringify(result)).not.toContain("private-provider-secret");
    }
  });
});
