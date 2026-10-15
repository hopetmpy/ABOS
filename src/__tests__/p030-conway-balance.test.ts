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
});
