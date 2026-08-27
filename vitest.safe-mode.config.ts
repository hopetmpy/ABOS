import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    silent: true,
    testTimeout: 30_000,
    setupFiles: ["src/__tests__/offline-setup.ts"],
    include: ["src/__tests__/safe-mode.test.ts"],
  },
});
