import { afterEach, describe, expect, it, vi } from "vitest";
import type { X402PaymentResult } from "../conway/x402.js";

vi.mock("../conway/x402.js", () => ({
  x402Fetch: vi.fn(),
}));
import { x402Fetch } from "../conway/x402.js";
import { topupCredits } from "../conway/topup.js";

const paid = {
  amountMicroUsdc: "5000000",
  policyAmountCents: 500,
  payToAddress: "0xmerchant",
  network: "eip155:8453",
  settlement: "accepted_response" as const,
};
afterEach(() => { vi.resetAllMocks(); });

describe("P-030 topup HTTP claims vs observed credit quantity", () => {
  it.each([
    [{}, undefined],
    [{ credits_cents: "500" }, undefined],
    [{ credits_cents: -1 }, undefined],
    [{ amount_cents: 499 }, undefined],
    [{ credits_cents: 0 }, 0],
  ] as const)("never substitutes nominal tier for absent or invalid credited balance %j", async (response, expected) => {
    vi.mocked(x402Fetch).mockResolvedValue({
      success: true,
      payment: paid,
      response,
    } satisfies X402PaymentResult);
    const result = await topupCredits("https://conway.example", { address:"0xwallet" } as any, 5);
    expect(result.success).toBe(true);
    expect(result.creditsCentsAdded).toBe(expected);
    expect(result.payment?.settlement).toBe("accepted_response");
    expect(x402Fetch).toHaveBeenCalledTimes(1);
  });

  it("distinguishes a paid request that lost its response from a confirmed payment", async () => {
    vi.mocked(x402Fetch).mockResolvedValue({
      success: false, error: "HTTP transport dropped",
      payment: { ...paid, settlement: "unknown" },
    });
    await expect(topupCredits("https://conway.example",{ address:"0xwallet" } as any,5))
      .rejects.toMatchObject({ externalEffectOutcomeUnknown: true });
  });
});
