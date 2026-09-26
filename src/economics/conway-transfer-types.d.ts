import type { CreditTransferResult } from "../types.js";

declare module "../types.js" {
  interface ConwayClient {
    transferCredits(
      toAddress: string,
      amountCents: number,
      note?: string,
      options?: { idempotencyKey?: string },
    ): Promise<CreditTransferResult>;
  }
}

export {};
