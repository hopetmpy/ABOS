/**
 * Jintel Integration
 *
 * Builds a `JintelClient` (https://github.com/YojinHQ/jintel-sdk) that pays
 * per-query in USDC on Base via x402, signed by the automaton's wallet.
 *
 * Implementation note: rather than depend on `x402-fetch` (which would create a
 * second, parallel payment path with its own spend cap), we feed the SDK a
 * custom `fetch` that delegates to the existing `x402Fetch` in
 * `src/conway/x402.ts`. This way the treasury policy's `maxX402PaymentCents`
 * cap and the resilient HTTP client are honored automatically.
 */

import type { PrivateKeyAccount } from "viem";
import { JintelClient } from "@yojinhq/jintel-client";
import { x402Fetch } from "../conway/x402.js";

export interface JintelClientFactoryOptions {
  account: PrivateKeyAccount;
  /** Cap per-query USDC spend, in cents. Forwarded to `x402Fetch`. */
  maxPaymentCents?: number;
  /** Override the API base. Defaults to the SDK's `https://api.jintel.ai/api`. */
  baseUrl?: string;
}

/**
 * Build a fetch impl that walks the automaton's existing x402 path.
 * The Jintel SDK only inspects `response.status`, `response.headers`, and
 * `response.json()`, so we wrap `x402Fetch`'s result back into a `Response`.
 */
function createJintelFetch(
  account: PrivateKeyAccount,
  maxPaymentCents?: number,
): (input: string | URL | Request, init?: RequestInit) => Promise<Response> {
  return async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    const method = (init?.method ?? "GET").toUpperCase();
    const body =
      typeof init?.body === "string" ? init.body : undefined;
    const headers = flattenHeaders(init?.headers);

    const result = await x402Fetch(
      url,
      account,
      method,
      body,
      headers,
      maxPaymentCents,
    );

    if (!result.success) {
      // Surface the failure as a Response so the SDK can map it to a typed
      // error (402 → JintelPaymentRequiredError, others → JintelError).
      const status = result.status ?? 500;
      const payload = JSON.stringify({ error: result.error ?? "x402 fetch failed" });
      return new Response(payload, {
        status,
        headers: { "Content-Type": "application/json" },
      });
    }

    const responseBody =
      typeof result.response === "string"
        ? result.response
        : JSON.stringify(result.response ?? null);
    return new Response(responseBody, {
      status: result.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  };
}

function flattenHeaders(
  raw: HeadersInit | undefined,
): Record<string, string> | undefined {
  if (!raw) return undefined;
  if (raw instanceof Headers) {
    const out: Record<string, string> = {};
    raw.forEach((value, key) => {
      out[key] = value;
    });
    return out;
  }
  if (Array.isArray(raw)) {
    return Object.fromEntries(raw);
  }
  return { ...(raw as Record<string, string>) };
}

/**
 * Build a JintelClient that pays per query via the automaton's wallet.
 */
export function createJintelClient(opts: JintelClientFactoryOptions): JintelClient {
  return new JintelClient({
    fetch: createJintelFetch(opts.account, opts.maxPaymentCents),
    baseUrl: opts.baseUrl,
  });
}
