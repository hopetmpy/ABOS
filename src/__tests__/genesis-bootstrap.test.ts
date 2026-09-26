import fs from "fs";
import os from "os";
import path from "path";
import { createHash } from "crypto";
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
const PARENT = "0x2222222222222222222222222222222222222222";
const CHILD = "0x1111111111111111111111111111111111111111";

function writeGenesis(overrides: Record<string, unknown> = {}): void {
  fs.writeFileSync(
    path.join(state.dir, "genesis.json"),
    JSON.stringify({
      name: "child-one",
      genesisPrompt: "Execute the delegated mission.",
      creatorMessage: "Created by parent.",
      creatorAddress: PARENT,
      parentAddress: PARENT,
      chainType: "evm",
      ...overrides,
    }),
  );
}

function writeFamilyBundle(
  overrides: Record<string, unknown> = {},
  hashOverride?: string,
): string {
  const raw = JSON.stringify(
    {
      format: "abos-family-knowledge/v1",
      version: 1,
      parentAddress: PARENT,
      generatedAt: "2026-09-25T00:00:00.000Z",
      knowledge: [],
      skills: [],
      capabilities: [],
      ...overrides,
    },
    null,
    2,
  );
  const hash = createHash("sha256").update(raw, "utf-8").digest("hex");
  fs.writeFileSync(path.join(state.dir, "family-knowledge.json"), raw);
  fs.writeFileSync(
    path.join(state.dir, "family-knowledge.sha256"),
    hashOverride ?? hash,
  );
  return hash;
}

describe("replicated child genesis bootstrap", () => {
  beforeEach(() => {
    state.home = fs.mkdtempSync(path.join(os.tmpdir(), "abos-genesis-bootstrap-"));
    state.dir = path.join(state.home, ".abos");
    fs.mkdirSync(state.dir, { recursive: true });
    process.env.HOME = state.home;
    state.provision.mockReset();
    state.provision.mockResolvedValue({
      apiKey: "cnwy_k_test_child",
      walletAddress: CHILD,
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

  it("creates complete non-interactive child state only with verified family bootstrap", async () => {
    writeGenesis();
    const familyHash = writeFamilyBundle({
      knowledge: [
        {
          category: "operational",
          key: "family:lesson:one",
          content: "Prefer evidence before claims.",
          source: PARENT,
          confidence: 0.9,
          lastVerified: "2026-09-25T00:00:00.000Z",
          tokenCount: 5,
          expiresAt: null,
        },
      ],
    });

    const { bootstrapFromGenesisIfPresent } = await import(
      "../setup/genesis-bootstrap.js"
    );
    const config = await bootstrapFromGenesisIfPresent();

    expect(config).not.toBeNull();
    expect(config?.name).toBe("child-one");
    expect(config?.sandboxId).toBe("sandbox-child-1");
    expect(config?.conwayApiKey).toBe("cnwy_k_test_child");
    expect(config?.parentAddress).toBe(PARENT);

    const persisted = JSON.parse(
      fs.readFileSync(path.join(state.dir, "abos.json"), "utf-8"),
    );
    expect(persisted.name).toBe("child-one");
    expect(persisted.conwayApiKey).toBe("cnwy_k_test_child");
    expect(persisted.walletAddress).toBe(CHILD);

    const receipt = JSON.parse(
      fs.readFileSync(
        path.join(state.dir, "family-knowledge.applied.json"),
        "utf-8",
      ),
    );
    expect(receipt.parentAddress).toBe(PARENT);
    expect(receipt.childWalletAddress).toBe(CHILD);
    expect(receipt.bundleHash).toBe(familyHash);
    expect(receipt.knowledgeImported).toBe(1);

    expect(fs.existsSync(path.join(state.dir, "state.db"))).toBe(true);
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

  it("is idempotent once abos.json exists and reapplies the same bundle", async () => {
    writeGenesis();
    writeFamilyBundle();

    const { bootstrapFromGenesisIfPresent } = await import(
      "../setup/genesis-bootstrap.js"
    );

    const first = await bootstrapFromGenesisIfPresent();
    const second = await bootstrapFromGenesisIfPresent();

    expect(first?.conwayApiKey).toBe("cnwy_k_test_child");
    expect(second?.conwayApiKey).toBe("cnwy_k_test_child");
    expect(state.provision).toHaveBeenCalledTimes(1);
    expect(
      fs.existsSync(path.join(state.dir, "family-knowledge.applied.json")),
    ).toBe(true);
  });

  it("refuses stale existing child identity when genesis lineage changes", async () => {
    writeGenesis();
    writeFamilyBundle();

    const { bootstrapFromGenesisIfPresent } = await import(
      "../setup/genesis-bootstrap.js"
    );
    await bootstrapFromGenesisIfPresent();

    writeGenesis({
      parentAddress: "0x3333333333333333333333333333333333333333",
      creatorAddress: "0x3333333333333333333333333333333333333333",
    });

    await expect(bootstrapFromGenesisIfPresent()).rejects.toThrow(
      /does not match current genesis lineage/,
    );
  });

  it("returns null for a normal human first run without genesis.json", async () => {
    const { bootstrapFromGenesisIfPresent } = await import(
      "../setup/genesis-bootstrap.js"
    );

    await expect(bootstrapFromGenesisIfPresent()).resolves.toBeNull();
    expect(state.provision).not.toHaveBeenCalled();
  });

  it("fails before provisioning when genesis.json is invalid", async () => {
    writeGenesis({ genesisPrompt: "", parentAddress: undefined });

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
    writeGenesis();
    writeFamilyBundle();
    state.provision.mockRejectedValueOnce(new Error("Conway unavailable"));

    const { bootstrapFromGenesisIfPresent } = await import(
      "../setup/genesis-bootstrap.js"
    );

    await expect(bootstrapFromGenesisIfPresent()).rejects.toThrow(
      "Conway unavailable",
    );
    expect(fs.existsSync(path.join(state.dir, "abos.json"))).toBe(false);
  });

  it("fails closed when the required family bundle is missing", async () => {
    writeGenesis();

    const { bootstrapFromGenesisIfPresent } = await import(
      "../setup/genesis-bootstrap.js"
    );

    await expect(bootstrapFromGenesisIfPresent()).rejects.toThrow(
      /missing family knowledge bundle\/hash/,
    );
    expect(fs.existsSync(path.join(state.dir, "abos.json"))).toBe(false);
  });

  it("fails closed on family bundle hash mismatch", async () => {
    writeGenesis();
    writeFamilyBundle({}, "0".repeat(64));

    const { bootstrapFromGenesisIfPresent } = await import(
      "../setup/genesis-bootstrap.js"
    );

    await expect(bootstrapFromGenesisIfPresent()).rejects.toThrow(
      /hash mismatch/,
    );
    expect(fs.existsSync(path.join(state.dir, "abos.json"))).toBe(false);
  });
});
