import { afterEach, describe, expect, it, vi } from "vitest";
import { observeConwayDomainsAuthenticatedAccount } from "../conway/domains-account-proof.js";
import { observeConwayDomainsOwnedResources } from "../conway/domains-owned-inventory.js";
import { SolanaChainIdentity } from "../identity/chain.js";
import nacl from "tweetnacl";

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

const owned = {
  domains: [{
    id: "dom_abc123", domain: "mysite.io", status: "Active",
    expiresAt: "2027-02-13T00:00:00Z",
  }],
};
const historical = {
  transactions: [{
    id: "txn_abc123", domainId: "dom_abc123", type: "registration",
    amount: 43.75, currency: "USD", status: "completed",
    createdAt: "2026-02-13T00:00:00Z",
  }],
};
function supplierReadResponses(
  wallet: string = controlled,
  walletType: "evm" | "solana" = "evm",
  domains: unknown = owned,
  transactions: unknown = historical,
) {
  return vi.fn(async (url: string, opts: RequestInit) => {
    expect(new URL(url).origin).toBe("https://api.conway.domains");
    expect(opts.method).toBe("GET");
    expect(opts.redirect).toBe("error");
    expect(opts.cache).toBe("no-store");
    expect(opts.body).toBeUndefined();
    expect(new Headers(opts.headers).get("Authorization"))
      .toBe("Bearer synthetic.jwt.provider.signature");
    expect(new Headers(opts.headers).has("X-PAYMENT")).toBe(false);
    expect(new Headers(opts.headers).has("PAYMENT-SIGNATURE")).toBe(false);
    if (url.endsWith("/auth/me")) {
      return payload({ id: "verified-provider-account",
        wallet_address: wallet, wallet_type: walletType });
    }
    if (url.endsWith("/domains")) return payload(domains);
    if (url.endsWith("/transactions")) return payload(transactions);
    throw new Error("Unexpected supplier request");
  });
}

describe("P-031 read-only owned Conway Domains resource reconciliation", () => {
  it("verifies host wallet/account before reading owned domains and transactions, with no purchase", async () => {
    const fetcher = supplierReadResponses();
    vi.stubGlobal("fetch", fetcher);
    const result = await observeConwayDomainsOwnedResources(getSession, controlled);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({
      status: "observed",
      account: { status: "wallet_match", providerAccountId: "verified-provider-account" },
      domains: [{ id: "dom_abc123", domain: "mysite.io", status: "Active" }],
      transactions: [{ id: "txn_abc123", amountUsdCents: 4375, status: "completed" }],
      financialSettlementEstablished: false,
      purchaseAuthority: "not_established",
    });
    expect(JSON.stringify(result)).not.toContain("synthetic.jwt.provider.signature");
  });

  it("does not read inventory or expose other-wallet holdings on provider account mismatch", async () => {
    const fetcher = supplierReadResponses(unrelated);
    vi.stubGlobal("fetch", fetcher);
    const result = await observeConwayDomainsOwnedResources(getSession, controlled);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      status: "unavailable", domains: null, transactions: null,
      account: { status: "wallet_mismatch", providerAccountId: null },
    });
    expect(JSON.stringify(result)).not.toContain(unrelated);
  });

  it("keeps unknown inventory when a host JWT is missing or invalid", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const result = await observeConwayDomainsOwnedResources(
      async () => null, controlled,
    );
    expect(result).toMatchObject({
      status: "unavailable", domains: null, transactions: null,
      financialSettlementEstablished: false,
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("preserves partial observation, never inferring empty balances or settled USDC", async () => {
    const fetcher = supplierReadResponses();
    fetcher.mockImplementation(async (url: string, opts: RequestInit) => {
      if (url.endsWith("/transactions")) return payload({ error: "private-txn-error" }, 503);
      return supplierReadResponses()(url, opts);
    });
    vi.stubGlobal("fetch", fetcher);
    const result = await observeConwayDomainsOwnedResources(getSession, controlled);
    expect(result).toMatchObject({
      status: "partial", domains: [{ domain: "mysite.io" }],
      transactions: null, financialSettlementEstablished: false,
    });
    expect(JSON.stringify(result)).not.toContain("private-txn-error");
  });

  it("rejects duplicate/malformed supplier transactions without false reconciliation", async () => {
    const bad = {
      transactions: [historical.transactions[0], historical.transactions[0]],
    };
    const fetcher = supplierReadResponses(controlled, "evm", owned, bad);
    vi.stubGlobal("fetch", fetcher);
    const result = await observeConwayDomainsOwnedResources(getSession, controlled);
    expect(result.status).toBe("partial");
    expect(result.domains).toHaveLength(1);
    expect(result.transactions).toBeNull();
    expect(result.financialSettlementEstablished).toBe(false);
  });

  it("accepts a controlled Solana identity for read-only matching, without EVM signing", async () => {
    const solana = new SolanaChainIdentity(
      nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(21)).secretKey,
    );
    const fetcher = supplierReadResponses(solana.address, "solana");
    vi.stubGlobal("fetch", fetcher);
    const result = await observeConwayDomainsOwnedResources(
      getSession, solana.address, "solana",
    );
    expect(result).toMatchObject({
      status: "observed",
      account: {
        status: "wallet_match", walletAddress: solana.address,
        walletType: "solana",
      },
      purchaseAuthority: "not_established",
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
