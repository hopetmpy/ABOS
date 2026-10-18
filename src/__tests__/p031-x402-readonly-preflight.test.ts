import { afterEach, describe, expect, it, vi } from "vitest";
import { probeX402ReadOnly } from "../conway/x402.js";
import { createBuiltinTools } from "../agent/tools.js";

const origin = "https://api.conway.tech/charged/service?ticket=private-example";
const recipient = "0x1111111111111111111111111111111111111111";
const usdc = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

const required = {
  x402Version: 2,
  accepts: [{
    scheme: "exact",
    network: "eip155:8453",
    maxAmountRequired: "30000",
    payTo: recipient,
    asset: usdc,
    maxTimeoutSeconds: 120,
  }],
};

function response402(value: unknown) {
  return new Response(null, {
    status: 402,
    headers: { "X-Payment-Required": JSON.stringify(value) },
  });
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("P-031 x402 nonpaying GET/HEAD price preflight", () => {
  it("uses one HEAD without payment authorization and reports only a nonbinding price preview", async () => {
    const fetcher = vi.fn(async (url: string, options: RequestInit) => {
      expect(url).toBe(origin);
      expect(options.method).toBe("HEAD");
      expect(options.redirect).toBe("error");
      expect(options.cache).toBe("no-store");
      expect(new Headers(options.headers).get("Cache-Control")).toContain("no-store");
      expect(options.body).toBeUndefined();
      expect(new Headers(options.headers).has("X-PAYMENT")).toBe(false);
      expect(new Headers(options.headers).has("PAYMENT-SIGNATURE")).toBe(false);
      return response402(required);
    });
    vi.stubGlobal("fetch", fetcher);
    const observed = await probeX402ReadOnly(origin);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(observed).toMatchObject({
      kind: "x402_head_preflight",
      targetMethod: "GET", inspectedMethod: "HEAD",
      status: "head_requirements_observed",
      reasonCode: "payment_required",
      exactOperationQuoteEstablished: false,
      providerAccountId: null, purchaseAuthorized: false,
      requirement: {
        scheme: "exact", network: "eip155:8453",
        payToAddress: recipient, usdcAddress: usdc,
        amountMicroUsdc: "30000", policyAmountCents: 3,
      },
    });
    expect(JSON.stringify(observed)).not.toContain("private-example");
  });

  it("never HEAD-probes a mutating target or claims a POST sandbox quote", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "HEAD"]) {
      expect(await probeX402ReadOnly(origin, method)).toMatchObject({
        status: "unsupported_target_method",
        inspectedMethod: null, requirement: null,
        exactOperationQuoteEstablished: false, purchaseAuthorized: false,
      });
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not interpret an HTTP 200 HEAD as a free GET or a valid supplier quote", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    expect(await probeX402ReadOnly(origin)).toMatchObject({
      status: "head_no_402", reasonCode: "head_not_payment_required",
      requirement: null, purchaseAuthorized: false,
      exactOperationQuoteEstablished: false,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("preserves UNKNOWN on methods unsupported by the supplier, invalid x402 requirements or failed network", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);

    fetcher.mockResolvedValueOnce(new Response(null, { status: 405 }));
    const notAllowed = await probeX402ReadOnly(origin);
    expect(notAllowed.status).toBe("unknown");
    expect(notAllowed.reasonCode).toBe("unexpected_http_status");

    fetcher.mockResolvedValueOnce(response402({
      ...required, accepts: [{ ...required.accepts[0], asset: recipient }],
    }));
    const invalidAsset = await probeX402ReadOnly(origin);
    expect(invalidAsset).toMatchObject({
      status: "unknown", reasonCode: "malformed_payment_requirements",
      requirement: null,
    });

    fetcher.mockResolvedValueOnce(response402({
      ...required, accepts: [{ ...required.accepts[0], maxAmountRequired: "bad-amount" }],
    }));
    const invalidAmount = await probeX402ReadOnly(origin);
    expect(invalidAmount.status).toBe("unknown");
    expect(invalidAmount.requirement).toBeNull();

    fetcher.mockRejectedValueOnce(new Error("secret-provider-response-should-be-redacted"));
    const network = await probeX402ReadOnly(origin);
    expect(network).toMatchObject({
      status: "unknown", reasonCode: "unavailable",
    });
    expect(JSON.stringify(network)).not.toContain("secret-provider-response");

    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("rejects unsupported schemes, unsafe URLs and page redirects without paying or revealing secrets", async () => {
    const fetcher = vi.fn(async () => response402({
      ...required, accepts: [{ ...required.accepts[0], scheme: "unknown-scheme" }],
    }));
    vi.stubGlobal("fetch", fetcher);
    const unsupported = await probeX402ReadOnly(origin);
    expect(unsupported.status).toBe("unknown");

    const embedded = await probeX402ReadOnly("https://user:credential@api.conway.tech/a");
    expect(embedded.status).toBe("unknown");
    expect(JSON.stringify(embedded)).not.toContain("credential");

    const plainHttp = await probeX402ReadOnly("http://api.conway.tech/a");
    expect(plainHttp.status).toBe("unknown");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("the agent exposes the optional probe, but never treats it as a purchase or P-010 receipt", async () => {
    const fetcher = vi.fn(async () => response402(required));
    vi.stubGlobal("fetch", fetcher);
    const tools = createBuiltinTools("fixture-sandbox");
    const tool = tools.find(t => t.name === "x402_price_probe");
    expect(tool).toBeDefined();
    expect(tool?.riskLevel).toBe("caution");
    const result = await tool!.execute({ url: origin, method: "GET" }, {} as any);
    const data = JSON.parse(result);
    expect(data).toMatchObject({
      status: "head_requirements_observed",
      purchaseAuthorized: false, exactOperationQuoteEstablished: false,
      providerAccountId: null,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);

    const unavailable = JSON.parse(await tool!.execute(
      { url: origin, method: "POST" }, {} as any,
    ));
    expect(unavailable.status).toBe("unsupported_target_method");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
