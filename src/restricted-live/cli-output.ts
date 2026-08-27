export interface ReviewCliResult { status: number; balanceAfterBaseUnits: bigint }

/** Convert the internal review result to the stable, JSON-safe CLI shape. */
export function formatReviewPaymentOutput(result: ReviewCliResult): {
  mode: "restricted-live-review-payment";
  status: number;
  balanceAfterBaseUnits: string;
} {
  return {
    mode: "restricted-live-review-payment",
    status: result.status,
    balanceAfterBaseUnits: result.balanceAfterBaseUnits.toString(),
  };
}
