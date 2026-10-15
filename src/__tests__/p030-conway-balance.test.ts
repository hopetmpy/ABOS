import { afterEach, describe, expect, it, vi } from "vitest";
import { createConwayClient } from "../conway/client.js";

afterEach(() => { vi.unstubAllGlobals(); });

function mockBalance(body: unknown) {
  const mock = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), {
    status: 200, headers: { "Content-Type": "application/json" },
  }));
  vi.stubGlobal("fetch", mock);
  return {
    client: createConwayClient({
      apiUrl: "https://api.conway.tech",
      apiKey: "test-key",
      sandboxId: "test-sandbox",
    }),
    mock,
  };
}

describe("P-030: Conway financial balance observation is not fabricated", () => {
  it.each([{}, { balance_cents: null }, { balance_cents: "0" }, { credits_cents: Number.NaN }, { balance_cents: 0.1 }])(
    "rejects an unobserved or invalid balance instead of pretending it is zero: %j",
    async (payload) => {
      const { client } = mockBalance(payload);
      await expect(client.getCreditsBalance()).rejects.toThrow(/valid observed integer/);
    },
  );

  it.each([
    [{ balance_cents: 0 }, 0],
    [{ credits_cents: 750 }, 750],
    [{ balance_cents: -15 }, -15],
  ] as const)("preserves actual provider observations %j", async (body, expected) => {
    const { client, mock } = mockBalance(body);
    expect(await client.getCreditsBalance()).toBe(expected);
    expect(mock).toHaveBeenCalledTimes(1);
  });
  it("requests an uncached balance without treating provider metadata as verified wallet provenance", async () => {
    const { client, mock } = mockBalance({
      balance_cents: 525,
      wallet_address: "0xnot-attested",
      observed_at: "1970-01-01T00:00:00Z",
    });
    expect(await client.getCreditsBalance()).toBe(525);
    const [url, options] = mock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.conway.tech/v1/credits/balance");
    expect(options.cache).toBe("no-store");
    const headers = new Headers(options.headers);
    expect(headers.get("cache-control")).toContain("no-store");
    expect(headers.get("pragma")).toBe("no-cache");
    // The existing number-only API contract deliberately does not attest the
    // wallet address, provider timestamp or finality from these extra fields.
  });

});
