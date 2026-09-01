import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  home: "",
  dir: "",
  provision: vi.fn(),
}));

vi.mock("../identity/wallet.js", () => ({
  getAbosDir: () => state.dir,
  getWallet: vi.fn(async (chainType?: "evm" | "solana") => ({
    account: { address: "0x1111111111111111111111111111111111111111" },
    chainIdentity: {
      address: "0x1111111111111111111111111111111111111111",
      chainType: chainType || "evm",
    },
    chainType: chainType || "evm",
    isNew: false,
  })),
}));

vi.mock("../identity/provision.js", () => ({
  provision: state.provision,
  loadApiKeyFromConfig: () => null,
}));

vi.mock("../setup/environment.js", () => ({
  detectEnvironment: () => ({
    type: "conway-sandbox",
    sandboxId: "sandbox-child-1",
  }),
}));

const ORIGINAL_HOME = process.env.HOME;

describe("replicated child genesis bootstrap", () => {
  beforeEach(() => {
    state.home = fs.mkdtempSync(path.join(os.tmpdir(), "abos-genesis-bootstrap-"));
    state.dir = path.join(state.home, ".abos");
    fs.mkdirSync(state.dir, { recursive: true });
    process.env.HOME = state.home;
    state.provision.mockReset();
    state.provision.mockResolvedValue({
      apiKey: "cnwy_k_test_child",
      walletAddress: "0x1111111111111111111111111111111111111111",
      keyPrefix: "cnwy",
    });
    vi.resetModules();
  });

  afterEach(() => {
    if (ORIGINAL_HOME === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = ORIGINAL_HOME;
    }
    if (state.home) {
      fs.rmSync(state.home, { recursive: true, force: true });
    }
  });

  it("creates complete non-interactive child state from genesis.json", async () => {
    fs.writeFileSync(
      path.join(state.dir, "genesis.json"),
      JSON.stringify({
        name: "child-one",
        genesisPrompt: "Execute the delegated mission.",
        creatorMessage: "Created by parent.",
        creatorAddress: "0x2222222222222222222222222222222222222222",
        parentAddress: "0x2222222222222222222222222222222222222222",
        chainType: "evm",
      }),
    );

    const { bootstrapFromGenesisIfPresent } = await import(
      "../setup/genesis-bootstrap.js"
    );
    const config = await bootstrapFromGenesisIfPresent();

    expect(config).not.toBeNull();
    expect(config?.name).toBe("child-one");
    expect(config?.sandboxId).toBe("sandbox-child-1");
    expect(config?.conwayApiKey).toBe("cnwy_k_test_child");
    expect(config?.parentAddress).toBe(
      "0x2222222222222222222222222222222222222222",
    );

    const persisted = JSON.parse(
      fs.readFileSync(path.join(state.dir, "abos.json"), "utf-8"),
    );
    expect(persisted.name).toBe("child-one");
    expect(persisted.conwayApiKey).toBe("cnwy_k_test_child");
    expect(persisted.walletAddress).toBe(
      "0x1111111111111111111111111111111111111111",
    );

    expect(fs.existsSync(path.join(state.dir, "heartbeat.yml"))).toBe(true);
    expect(fs.existsSync(path.join(state.dir, "SOUL.md"))).toBe(true);
    expect(
      fs.existsSync(path.join(state.dir, "skills", "survival", "SKILL.md")),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(state.dir, "skills", "conway-compute", "SKILL.md"),
      ),
    ).toBe(true);

    expect(state.provision).toHaveBeenCalledTimes(1);
  });

  it("is idempotent once abos.json exists", async () => {
    fs.writeFileSync(
      path.join(state.dir, "genesis.json"),
      JSON.stringify({
        name: "child-one",
        genesisPrompt: "Execute the delegated mission.",
        creatorAddress: "0x2222222222222222222222222222222222222222",
        parentAddress: "0x2222222222222222222222222222222222222222",
        chainType: "evm",
      }),
    );

    const { bootstrapFromGenesisIfPresent } = await import(
      "../setup/genesis-bootstrap.js"
    );

    const first = await bootstrapFromGenesisIfPresent();
    const second = await bootstrapFromGenesisIfPresent();

    expect(first?.conwayApiKey).toBe("cnwy_k_test_child");
    expect(second?.conwayApiKey).toBe("cnwy_k_test_child");
    expect(state.provision).toHaveBeenCalledTimes(1);
  });

  it("returns null for a normal human first run without genesis.json", async () => {
    const { bootstrapFromGenesisIfPresent } = await import(
      "../setup/genesis-bootstrap.js"
    );

    await expect(bootstrapFromGenesisIfPresent()).resolves.toBeNull();
    expect(state.provision).not.toHaveBeenCalled();
  });

  it("fails before provisioning when genesis.json is invalid", async () => {
    fs.writeFileSync(
      path.join(state.dir, "genesis.json"),
      JSON.stringify({
        name: "child-one",
        genesisPrompt: "",
        creatorAddress: "0x2222222222222222222222222222222222222222",
      }),
    );

    const { bootstrapFromGenesisIfPresent } = await import(
      "../setup/genesis-bootstrap.js"
    );

    await expect(bootstrapFromGenesisIfPresent()).rejects.toThrow(
      /genesis\.json/,
    );
    expect(state.provision).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(state.dir, "abos.json"))).toBe(false);
  });

  it("does not persist a runnable config when Conway provisioning fails", async () => {
    fs.writeFileSync(
      path.join(state.dir, "genesis.json"),
      JSON.stringify({
        name: "child-one",
        genesisPrompt: "Execute the delegated mission.",
        creatorAddress: "0x2222222222222222222222222222222222222222",
        parentAddress: "0x2222222222222222222222222222222222222222",
        chainType: "evm",
      }),
    );
    state.provision.mockRejectedValueOnce(new Error("Conway unavailable"));

    const { bootstrapFromGenesisIfPresent } = await import(
      "../setup/genesis-bootstrap.js"
    );

    await expect(bootstrapFromGenesisIfPresent()).rejects.toThrow(
      "Conway unavailable",
    );
    expect(fs.existsSync(path.join(state.dir, "abos.json"))).toBe(false);
  });
});
