import { afterEach, describe, expect, it, vi } from "vitest";
import { authenticateConwayDomainsControlledEvmWallet } from "../conway/domains-siwe-session.js";
import { createBuiltinTools } from "../agent/tools.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const controlled = "0x1111111111111111111111111111111111111111";
const unrelated = "0x2222222222222222222222222222222222222222";
const signer = {
  address: controlled,
  signMessage: vi.fn(async ({ message }: { message: string }) => {
    expect(message).toContain("api.conway.domains");
    expect(message).toContain(controlled);
    expect(message).toContain("nonce-1234-ABCD");
    return `0x${"aa".repeat(65)}`;
  }),
};
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { "Content-Type": "application/json" },
});

function provider() {
  return vi.fn(async (url: string, options: RequestInit) => {
    expect(new URL(url).origin).toBe("https://api.conway.domains");
    expect(options.redirect).toBe("error");
    expect(options.cache).toBe("no-store");
    expect(new Headers(options.headers).has("X-PAYMENT")).toBe(false);
    expect(new Headers(options.headers).has("PAYMENT-SIGNATURE")).toBe(false);
    if (url.endsWith("/auth/nonce")) {
      expect(options.method).toBe("POST");
      expect(options.body).toBeUndefined();
      return json({ nonce: "nonce-1234-ABCD" });
    }
    if (url.endsWith("/auth/verify")) {
      expect(options.method).toBe("POST");
      const body = JSON.parse(String(options.body));
      expect(body.message).toContain("api.conway.domains");
      expect(body.signature).toMatch(/^0x[a-fA-F0-9]{130}$/);
      return json({ access_token: "synthetic.JWT.signature" });
    }
    expect(url).toBe("https://api.conway.domains/auth/me");
    expect(options.method).toBe("GET");
    expect(new Headers(options.headers).get("Authorization"))
      .toBe("Bearer synthetic.JWT.signature");
    return json({
      id: "supplier-account-fixture", wallet_address: controlled, wallet_type: "evm",
    });
  });
}

describe("P-031 Conway Domains existing-wallet ephemeral SIWE identity", () => {
  it("signs only an existing host-owned login message and verifies the same wallet at the supplier", async () => {
    const fetcher = provider();
    vi.stubGlobal("fetch", fetcher);
    const proof = await authenticateConwayDomainsControlledEvmWallet(signer);
    expect(proof).toMatchObject({
      provider: "conway-domains", status: "wallet_match",
      providerAccountId: "supplier-account-fixture",
      purchaseAuthority: "not_established", financingUnit: null,
    });
    expect(signer.signMessage).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(proof)).not.toContain("synthetic.JWT.signature");
    expect(JSON.stringify(proof)).not.toContain("0x" + "aa".repeat(65));
  });

  it("fails closed if supplier nonce is invalid, without signing anything", async () => {
    const sign = vi.fn();
    const fetcher = vi.fn(async () => json({ nonce: "too_short_" }));
    vi.stubGlobal("fetch", fetcher);
    const result = await authenticateConwayDomainsControlledEvmWallet({
      address: controlled, signMessage: sign,
    });
    expect(result.status).toBe("unavailable");
    expect(sign).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not call account GET or claim an authenticated identity after verification failure", async () => {
    const fetcher = vi.fn(async (url: string) =>
      url.endsWith("/auth/nonce") ? json({ nonce: "abcdef012345" }) :
      json({ error: "private-provider-secret" }, 401));
    vi.stubGlobal("fetch", fetcher);
    const sign = vi.fn(async () => `0x${"ee".repeat(65)}`);
    const result = await authenticateConwayDomainsControlledEvmWallet({
      address: controlled, signMessage: sign,
    });
    expect(result).toMatchObject({
      status: "unavailable", providerAccountId: null,
      purchaseAuthority: "not_established",
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(result)).not.toContain("private-provider-secret");
  });

  it("agent tool uses its own wallet only, never accepts a token or signs for a mismatched/other chain identity", async () => {
    const fetcher = provider();
    vi.stubGlobal("fetch", fetcher);
    const tool = createBuiltinTools("fixture").find(
      t => t.name === "conway_domains_account_proof",
    )!;
    expect(tool).toBeDefined();
    expect(tool.riskLevel).toBe("caution");
    expect(tool.parameters).toMatchObject({ properties: {} });
    const jsonOutput = await tool.execute({}, {
      identity: {
        address: controlled,
        chainType: "evm",
        account: { address: controlled, signMessage: signer.signMessage },
      },
    } as any);
    const output = JSON.parse(jsonOutput);
    expect(output.status).toBe("wallet_match");
    expect(output.purchaseAuthority).toBe("not_established");
    expect(fetcher).toHaveBeenCalledTimes(3);

    const unusable = JSON.parse(await tool.execute({}, {
      identity: {
        address: controlled,
        chainType: "evm",
        account: { address: unrelated, signMessage: signer.signMessage },
      },
    } as any));
    expect(unusable.status).toBe("unavailable");
    expect(fetcher).toHaveBeenCalledTimes(3);
    const solana = JSON.parse(await tool.execute({}, {
      identity: {
        address: "SolanaFixturePublicKey",
        chainType: "solana",
        account: { address: controlled, signMessage: signer.signMessage },
      },
    } as any));
    expect(solana.status).toBe("unavailable");
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
