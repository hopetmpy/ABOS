import { afterEach, describe, expect, it, vi } from "vitest";
import { authenticateConwayDomainsControlledEvmWallet } from "../conway/domains-siwe-session.js";
import { createBuiltinTools } from "../agent/tools.js";
import { authenticateConwayDomainsControlledSolanaWallet } from "../conway/domains-siwe-session.js";
import { SolanaChainIdentity } from "../identity/chain.js";
import nacl from "tweetnacl";

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
    expect(message).toContain("nonce1234ABCD");
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
      return json({ nonce: "nonce1234ABCD" });
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

const solanaWallet = new SolanaChainIdentity(
  nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(7)).secretKey,
);
const otherSolanaWallet = new SolanaChainIdentity(
  nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(8)).secretKey,
);

function solanaProvider(observedWallet = solanaWallet.address) {
  return vi.fn(async (url: string, options: RequestInit) => {
    expect(new URL(url).origin).toBe("https://api.conway.domains");
    expect(options.redirect).toBe("error");
    expect(new Headers(options.headers).has("X-PAYMENT")).toBe(false);
    if (url.endsWith("/auth/solana/nonce")) {
      expect(options.method).toBe("POST");
      expect(options.body).toBeUndefined();
      return json({ nonce: "solNonce12345" });
    }
    if (url.endsWith("/auth/solana/verify")) {
      expect(options.method).toBe("POST");
      const body = JSON.parse(String(options.body));
      expect(body.message).toContain(solanaWallet.address);
      expect(body.message).toContain("solNonce12345");
      expect(body.message).toContain("Chain ID: mainnet");
      expect(body.signature).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/);
      return json({ access_token: "synthetic.solana.JWT" });
    }
    expect(url).toBe("https://api.conway.domains/auth/me");
    expect(options.method).toBe("GET");
    expect(new Headers(options.headers).get("Authorization"))
      .toBe("Bearer synthetic.solana.JWT");
    return json({
      id: "solana-provider-account",
      wallet_address: observedWallet,
      wallet_type: "solana",
    });
  });
}

describe("P-031 Conway Domains SIWS uses the existing Solana identity", () => {
  it("authenticates with a locally verifiable Ed25519 signature and proves exact account ownership", async () => {
    const fetcher = solanaProvider();
    vi.stubGlobal("fetch", fetcher);
    const proof = await authenticateConwayDomainsControlledSolanaWallet(solanaWallet);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(proof).toMatchObject({
      provider: "conway-domains", status: "wallet_match",
      walletAddress: solanaWallet.address, walletType: "solana",
      providerAccountId: "solana-provider-account",
      purchaseAuthority: "not_established", financingUnit: null,
    });
    expect(JSON.stringify(proof)).not.toContain("synthetic.solana.JWT");
  });

  it("routes the builtin tool through chainIdentity, never the EVM stub account", async () => {
    const fetcher = solanaProvider();
    vi.stubGlobal("fetch", fetcher);
    const tool = createBuiltinTools("fixture").find(
      t => t.name === "conway_domains_account_proof",
    )!;
    expect(tool.riskLevel).toBe("caution");
    expect(tool.parameters).toMatchObject({ properties: {} });
    const output = JSON.parse(await tool.execute({}, {
      identity: {
        chainType: "solana",
        address: solanaWallet.address,
        chainIdentity: solanaWallet,
        account: { address: solanaWallet.address, signMessage: vi.fn(() => {
          throw new Error("EVM stub signer must never be used");
        }) },
      },
    } as any));
    expect(output).toMatchObject({
      status: "wallet_match", walletType: "solana",
      purchaseAuthority: "not_established",
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("rejects a signer for a different Solana wallet before login verification", async () => {
    const fetcher = solanaProvider();
    vi.stubGlobal("fetch", fetcher);
    const proof = await authenticateConwayDomainsControlledSolanaWallet({
      chainType: "solana",
      address: solanaWallet.address,
      signMessage: message => otherSolanaWallet.signMessage(message),
    });
    expect(proof).toMatchObject({
      status: "unavailable", providerAccountId: null,
      purchaseAuthority: "not_established",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not claim ownership of another Solana account or reveal it", async () => {
    const fetcher = solanaProvider(otherSolanaWallet.address);
    vi.stubGlobal("fetch", fetcher);
    const proof = await authenticateConwayDomainsControlledSolanaWallet(solanaWallet);
    expect(proof).toMatchObject({
      status: "wallet_mismatch", providerAccountId: null, walletAddress: null,
    });
    expect(JSON.stringify(proof)).not.toContain(otherSolanaWallet.address);
    expect(JSON.stringify(proof)).not.toContain("solana-provider-account");
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("returns UNKNOWN without networking when no controlled Solana signer is available", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const tool = createBuiltinTools("fixture").find(
      t => t.name === "conway_domains_account_proof",
    )!;
    const result = JSON.parse(await tool.execute({}, {
      identity: {
        chainType: "solana",
        address: otherSolanaWallet.address,
        chainIdentity: solanaWallet,
      },
    } as any));
    expect(result.status).toBe("unavailable");
    expect(result.purchaseAuthority).toBe("not_established");
    expect(fetcher).not.toHaveBeenCalled();
  });
});

function fixtureOwnedResponse(url: string) {
  if (url.endsWith("/domains")) return json({
    domains: [{ id: "dom_fixture", domain: "mysite.io",
      status: "Active", expiresAt: "2027-02-13T00:00:00Z" }],
  });
  return json({
    transactions: [{ id: "txn_fixture", domainId: "dom_fixture",
      type: "registration", amount: 43.75, currency: "USD",
      status: "completed", createdAt: "2026-02-13T00:00:00Z" }],
  });
}

describe("P-031 host-owned Conway Domains inventory tool and JWT scope", () => {
  it("authenticates EVM once and reuses only its private session for authenticated account and inventory GET", async () => {
    const login = provider();
    const fetcher = vi.fn(async (url: string, options: RequestInit) => {
      expect(new URL(url).origin).toBe("https://api.conway.domains");
      expect(new Headers(options.headers).has("X-PAYMENT")).toBe(false);
      if (url.endsWith("/domains") || url.endsWith("/transactions")) {
        expect(options.method).toBe("GET");
        expect(options.redirect).toBe("error");
        expect(new Headers(options.headers).get("Authorization"))
          .toBe("Bearer synthetic.JWT.signature");
        return fixtureOwnedResponse(url);
      }
      return login(url, options);
    });
    vi.stubGlobal("fetch", fetcher);
    const tool = createBuiltinTools("fixture").find(t => t.name === "conway_domains_owned_resources")!;
    expect(tool).toBeDefined();
    expect(tool.riskLevel).toBe("caution");
    expect(tool.parameters).toMatchObject({ properties: {} });
    const result = JSON.parse(await tool.execute({}, {
      identity: {
        chainType: "evm", address: controlled,
        account: { address: controlled, signMessage: signer.signMessage },
      },
    } as any));
    expect(fetcher).toHaveBeenCalledTimes(6);
    expect(result).toMatchObject({
      status: "observed",
      account: { status: "wallet_match", walletAddress: controlled.toLowerCase() },
      domains: [{ domain: "mysite.io" }],
      transactions: [{ amountUsdCents: 4375 }],
      financialSettlementEstablished: false,
      purchaseAuthority: "not_established",
    });
    expect(JSON.stringify(result)).not.toContain("synthetic.JWT.signature");
    expect(JSON.stringify(result)).not.toContain("0x" + "aa".repeat(65));
  });

  it("signs Solana SIWS with the existing ChainIdentity, never the unrelated EVM stub", async () => {
    const login = solanaProvider();
    const fetcher = vi.fn(async (url: string, opts: RequestInit) => {
      if (url.endsWith("/domains") || url.endsWith("/transactions")) {
        expect(opts.method).toBe("GET");
        expect(new Headers(opts.headers).get("Authorization"))
          .toBe("Bearer synthetic.solana.JWT");
        return fixtureOwnedResponse(url);
      }
      return login(url, opts);
    });
    vi.stubGlobal("fetch", fetcher);
    const tool = createBuiltinTools("fixture").find(t => t.name === "conway_domains_owned_resources")!;
    const result = JSON.parse(await tool.execute({}, {
      identity: {
        chainType: "solana", address: solanaWallet.address,
        chainIdentity: solanaWallet,
        account: { address: solanaWallet.address, signMessage: vi.fn(() => {
          throw new Error("wrong chain signer");
        }) },
      },
    } as any));
    expect(fetcher).toHaveBeenCalledTimes(6);
    expect(result).toMatchObject({
      status: "observed", account: { status: "wallet_match",
        walletAddress: solanaWallet.address, walletType: "solana" },
      domains: [{ domain: "mysite.io" }],
      financialSettlementEstablished: false,
    });
    expect(JSON.stringify(result)).not.toContain("synthetic.solana.JWT");
  });

  it("never requests inventory for an authenticated supplier account with a different EVM wallet", async () => {
    const fetcher = vi.fn(async (url: string, opts: RequestInit) => {
      if (url.endsWith("/auth/me")) {
        return json({ id: "private-foreign-user",
          wallet_address: unrelated, wallet_type: "evm" });
      }
      if (url.endsWith("/domains") || url.endsWith("/transactions")) {
        throw new Error("Foreign account inventory must not be requested");
      }
      return provider()(url, opts);
    });
    vi.stubGlobal("fetch", fetcher);
    const tool = createBuiltinTools("fixture").find(t => t.name === "conway_domains_owned_resources")!;
    const result = JSON.parse(await tool.execute({}, {
      identity: { chainType: "evm", address: controlled,
        account: { address: controlled, signMessage: signer.signMessage } },
    } as any));
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({
      status: "unavailable", domains: null, transactions: null,
      account: { status: "wallet_mismatch", providerAccountId: null },
      financialSettlementEstablished: false,
    });
    expect(JSON.stringify(result)).not.toContain("private-foreign-user");
    expect(JSON.stringify(result)).not.toContain(unrelated);
  });

  it("never logs in when the host wallet is absent, mismatched or wrong-chain", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const tool = createBuiltinTools("fixture").find(t => t.name === "conway_domains_owned_resources")!;
    for (const identity of [
      { chainType: "evm", address: controlled, account: { address: unrelated } },
      { chainType: "solana", address: otherSolanaWallet.address,
        chainIdentity: solanaWallet },
    ]) {
      const result = JSON.parse(await tool.execute({}, { identity } as any));
      expect(result).toMatchObject({
        status: "unavailable",
        financialSettlementEstablished: false,
        purchaseAuthority: "not_established",
      });
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("keeps transaction outages partial, without falsely reconciling payment", async () => {
    const login = provider();
    const fetcher = vi.fn(async (url: string, opts: RequestInit) => {
      if (url.endsWith("/domains")) return fixtureOwnedResponse(url);
      if (url.endsWith("/transactions")) return json({ error: "sensitive" }, 503);
      return login(url, opts);
    });
    vi.stubGlobal("fetch", fetcher);
    const tool = createBuiltinTools("fixture").find(t => t.name === "conway_domains_owned_resources")!;
    const result = JSON.parse(await tool.execute({}, {
      identity: { chainType: "evm", address: controlled,
        account: { address: controlled, signMessage: signer.signMessage } },
    } as any));
    expect(result).toMatchObject({
      status: "partial", domains: [{ domain: "mysite.io" }],
      transactions: null, financialSettlementEstablished: false,
    });
    expect(JSON.stringify(result)).not.toContain("sensitive");
    expect(fetcher).toHaveBeenCalledTimes(6);
  });
});

function dnsFixture(url: string, source: "live" | "cache" | "stale" = "live") {
  if (url.endsWith("/domains/mysite.io/dns")) return json({
    source,
    records: [{ recordId: "rec_a", type: "A", host: "@",
      value: "192.0.2.1", ttl: 3600 }],
  });
  return fixtureOwnedResponse(url);
}
function dnsTestProvider(account = controlled, source: "live" | "cache" | "stale" = "live") {
  const login = provider();
  return vi.fn(async (url: string, opts: RequestInit) => {
    expect(new URL(url).origin).toBe("https://api.conway.domains");
    expect(new Headers(opts.headers).has("X-PAYMENT")).toBe(false);
    if (url.endsWith("/auth/me")) return json({
      id:"supplier-account-fixture",wallet_address:account,wallet_type:"evm",
    });
    if (url.endsWith("/domains") || url.endsWith("/transactions") ||
        url.endsWith("/domains/mysite.io/dns")) {
      expect(opts.method).toBe("GET");
      expect(opts.redirect).toBe("error");
      expect(new Headers(opts.headers).get("Authorization"))
        .toBe("Bearer synthetic.JWT.signature");
      return dnsFixture(url,source);
    }
    return login(url,opts);
  });
}

describe("P-031 owned-domain DNS observation remains distinct from usable resource", () => {
  it("reads only owned domain DNS using EVM's verified host JWT, without purchase or propagation claim", async () => {
    const fetcher=dnsTestProvider();
    vi.stubGlobal("fetch",fetcher);
    const tool=createBuiltinTools("fixture").find(t=>t.name==="conway_domain_dns_observation")!;
    expect(tool.riskLevel).toBe("caution");
    const output=JSON.parse(await tool.execute({domain:"mysite.io"},{
      identity:{chainType:"evm",address:controlled,
        account:{address:controlled,signMessage:signer.signMessage}},
    } as any));
    expect(fetcher).toHaveBeenCalledTimes(7);
    expect(output).toMatchObject({
      status:"observed",domain:"mysite.io",dnsSource:"live",
      inventoryStatus:"Active",
      records:[{id:"rec_a",type:"A",host:"@",value:"192.0.2.1",ttl:3600}],
      independentDnsPropagationVerified:false,resourceUsable:false,
      financialSettlementEstablished:false,purchaseAuthority:"not_established",
    });
    expect(JSON.stringify(output)).not.toContain("synthetic.JWT.signature");
  });

  it("classifies supplier stale DNS as partial, not independently usable", async () => {
    const fetcher=dnsTestProvider(controlled,"stale");
    vi.stubGlobal("fetch",fetcher);
    const tool=createBuiltinTools("fixture").find(t=>t.name==="conway_domain_dns_observation")!;
    const output=JSON.parse(await tool.execute({domain:"mysite.io"},{
      identity:{chainType:"evm",address:controlled,
        account:{address:controlled,signMessage:signer.signMessage}},
    } as any));
    expect(output).toMatchObject({
      status:"partial",dnsSource:"stale",resourceUsable:false,
      independentDnsPropagationVerified:false,
    });
    expect(output.evidence.join(" ")).toContain("stale");
    expect(fetcher).toHaveBeenCalledTimes(7);
  });

  it("does not read any DNS if provider identity belongs to another wallet", async () => {
    const fetcher=dnsTestProvider(unrelated);
    vi.stubGlobal("fetch",fetcher);
    const tool=createBuiltinTools("fixture").find(t=>t.name==="conway_domain_dns_observation")!;
    const output=JSON.parse(await tool.execute({domain:"mysite.io"},{
      identity:{chainType:"evm",address:controlled,
        account:{address:controlled,signMessage:signer.signMessage}},
    } as any));
    expect(output).toMatchObject({
      status:"unavailable",records:null,resourceUsable:false,
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(output)).not.toContain("private");
  });

  it("does not query a domain not present in verified account inventory", async () => {
    const fetcher=dnsTestProvider();
    vi.stubGlobal("fetch",fetcher);
    const tool=createBuiltinTools("fixture").find(t=>t.name==="conway_domain_dns_observation")!;
    const output=JSON.parse(await tool.execute({domain:"other.io"},{
      identity:{chainType:"evm",address:controlled,
        account:{address:controlled,signMessage:signer.signMessage}},
    } as any));
    expect(output).toMatchObject({
      status:"not_in_inventory",records:null,resourceUsable:false,
    });
    expect(fetcher).toHaveBeenCalledTimes(6);
  });

  it("returns unavailable for malformed target without DNS HTTP and wrong-chain signer without login", async () => {
    const fetcher=dnsTestProvider();
    vi.stubGlobal("fetch",fetcher);
    const tool=createBuiltinTools("fixture").find(t=>t.name==="conway_domain_dns_observation")!;
    const invalid=JSON.parse(await tool.execute({domain:"https://mysite.io/../secrets"},{
      identity:{chainType:"evm",address:controlled,
        account:{address:controlled,signMessage:signer.signMessage}},
    } as any));
    expect(invalid).toMatchObject({status:"unavailable",records:null,resourceUsable:false});
    expect(fetcher).toHaveBeenCalledTimes(3);
    const other=JSON.parse(await tool.execute({domain:"mysite.io"},{
      identity:{chainType:"solana",address:otherSolanaWallet.address,
        chainIdentity:solanaWallet},
    } as any));
    expect(other.status).toBe("unavailable");
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("uses the existing Solana SIWS wallet for DNS observation without EVM signer", async () => {
    const login=solanaProvider();
    const fetcher=vi.fn(async(url:string, opts:RequestInit)=>{
      if(url.endsWith("/domains")||url.endsWith("/transactions")||
         url.endsWith("/domains/mysite.io/dns")){
        expect(new Headers(opts.headers).get("Authorization"))
          .toBe("Bearer synthetic.solana.JWT");
        return dnsFixture(url);
      }
      return login(url,opts);
    });
    vi.stubGlobal("fetch",fetcher);
    const tool=createBuiltinTools("fixture").find(t=>t.name==="conway_domain_dns_observation")!;
    const output=JSON.parse(await tool.execute({domain:"mysite.io"},{
      identity:{chainType:"solana",address:solanaWallet.address,
        chainIdentity:solanaWallet,
        account:{address:solanaWallet.address,signMessage:vi.fn(()=>{
          throw new Error("EVM must not sign");
        })}},
    } as any));
    expect(output).toMatchObject({
      status:"observed",dnsSource:"live",resourceUsable:false,
      providerAccountId:"solana-provider-account",
    });
    expect(fetcher).toHaveBeenCalledTimes(7);
  });
});
