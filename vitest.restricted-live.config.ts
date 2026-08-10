import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    silent: true,
    testTimeout: 30_000,
    setupFiles: ["src/__tests__/offline-setup.ts"],
    env: { VITEST_RESTRICTED_LIVE: "true" },
    include: ["src/__tests__/restricted-live.test.ts", "src/__tests__/x402scan-once.test.ts", "src/__tests__/payment-proposals.test.ts", "src/__tests__/restricted-live-cli-output.test.ts"],
  },
});
