import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  home: "",
  dir: "",
}));

vi.mock("../identity/wallet.js", () => ({
  getAbosDir: () => state.dir,
}));

vi.mock("../identity/provision.js", () => ({
  loadApiKeyFromConfig: () => null,
}));

describe("config integrity", () => {
  beforeEach(() => {
    state.home = fs.mkdtempSync(path.join(os.tmpdir(), "abos-config-integrity-"));
    state.dir = path.join(state.home, ".abos");
    fs.mkdirSync(state.dir, { recursive: true });
    vi.resetModules();
  });

  afterEach(() => {
    if (state.home) {
      fs.rmSync(state.home, { recursive: true, force: true });
    }
  });

  it("returns null only when abos.json does not exist", async () => {
    const { loadConfig } = await import("../config.js");
    expect(loadConfig()).toBeNull();
  });

  it("loads an existing valid config and merges canonical defaults", async () => {
    fs.writeFileSync(
      path.join(state.dir, "abos.json"),
      JSON.stringify({
        name: "configured-abos",
        creatorAddress: "0x2222222222222222222222222222222222222222",
        walletAddress: "0x1111111111111111111111111111111111111111",
        sandboxId: "  sandbox-1  ",
      }),
      "utf8",
    );

    const { loadConfig } = await import("../config.js");
    const config = loadConfig();

    expect(config).not.toBeNull();
    expect(config?.name).toBe("configured-abos");
    expect(config?.sandboxId).toBe("sandbox-1");
    expect(config?.maxChildren).toBe(3);
  });

  it("throws when an existing abos.json contains invalid JSON instead of treating it as first run", async () => {
    const configPath = path.join(state.dir, "abos.json");
    const original = "{ invalid-json";
    fs.writeFileSync(configPath, original, "utf8");

    const { loadConfig } = await import("../config.js");

    expect(() => loadConfig()).toThrow(
      /Failed to load existing ABOS config.*abos\.json/i,
    );
    expect(fs.readFileSync(configPath, "utf8")).toBe(original);
  });

  it("throws when an existing config has a structurally unusable root value", async () => {
    fs.writeFileSync(path.join(state.dir, "abos.json"), "null", "utf8");

    const { loadConfig } = await import("../config.js");

    expect(() => loadConfig()).toThrow(
      /Failed to load existing ABOS config.*abos\.json/i,
    );
  });
});
