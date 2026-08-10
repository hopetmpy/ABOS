import { defineConfig, mergeConfig } from "vitest/config";
import base from "./vitest.config.js";

export default mergeConfig(base, defineConfig({
  test: {
    silent: true,
    setupFiles: ["src/__tests__/offline-setup.ts"],
    exclude: [
      "src/__tests__/safe-mode.test.ts",
      "src/__tests__/restricted-live.test.ts",
      "src/__tests__/x402scan-once.test.ts",
      "src/__tests__/wallet-solana.test.ts",
      "src/__tests__/funding.test.ts",
      "src/__tests__/social.test.ts",
      "src/__tests__/discovery-abi.test.ts",
      "src/__tests__/payment-proposals.test.ts",
    ],
  },
}));
