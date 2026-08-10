import { describe, expect, it } from "vitest";
import { formatReviewPaymentOutput } from "../restricted-live/cli-output.js";

describe("restricted-live review CLI output", () => {
  it("serializes internal bigint balances as decimal strings", () => {
    const output = formatReviewPaymentOutput({ status: 200, balanceAfterBaseUnits: 4_990_000n });
    expect(() => JSON.stringify(output)).not.toThrow();
    expect(output).toEqual({ mode: "restricted-live-review-payment", status: 200, balanceAfterBaseUnits: "4990000" });
  });
});
