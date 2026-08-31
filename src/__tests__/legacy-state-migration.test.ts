import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_HOME = process.env.HOME;
const tempHomes: string[] = [];

function useTempHome(): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "abos-legacy-state-"));
  tempHomes.push(home);
  process.env.HOME = home;
  return home;
}

afterEach(() => {
  if (ORIGINAL_HOME === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = ORIGINAL_HOME;
  }
  vi.resetModules();

  while (tempHomes.length > 0) {
    const home = tempHomes.pop()!;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

describe("legacy Automaton state migration", () => {
  it("moves the complete legacy state into ~/.abos without changing wallet identity", async () => {
    const home = useTempHome();
    const legacyDir = path.join(home, ".automaton");
    const abosDir = path.join(home, ".abos");

    fs.mkdirSync(path.join(legacyDir, "skills", "survival"), { recursive: true });

    const wallet = {
      privateKey: `0x${"1".padStart(64, "0")}`,
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    fs.writeFileSync(
      path.join(legacyDir, "wallet.json"),
      JSON.stringify(wallet, null, 2),
      { mode: 0o600 },
    );
    fs.writeFileSync(
      path.join(legacyDir, "automaton.json"),
      JSON.stringify(
        {
          name: "legacy-agent",
          heartbeatConfigPath: "~/.automaton/heartbeat.yml",
          dbPath: "~/.automaton/state.db",
          skillsDir: "~/.automaton/skills",
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    fs.writeFileSync(path.join(legacyDir, "state.db"), "legacy-db");
    fs.writeFileSync(path.join(legacyDir, "heartbeat.yml"), "entries: []\n");
    fs.writeFileSync(path.join(legacyDir, "skills", "survival", "SKILL.md"), "# survival\n");

    vi.resetModules();
    const walletModule = await import("../identity/wallet.js");

    expect(walletModule.getAbosDir()).toBe(abosDir);
    expect(fs.existsSync(legacyDir)).toBe(false);
    expect(fs.existsSync(path.join(abosDir, "wallet.json"))).toBe(true);
    expect(
      JSON.parse(fs.readFileSync(path.join(abosDir, "wallet.json"), "utf-8")),
    ).toEqual(wallet);
    expect(fs.existsSync(path.join(abosDir, "automaton.json"))).toBe(false);
    expect(fs.existsSync(path.join(abosDir, "abos.json"))).toBe(true);
    expect(fs.readFileSync(path.join(abosDir, "state.db"), "utf-8")).toBe("legacy-db");
    expect(fs.existsSync(path.join(abosDir, "skills", "survival", "SKILL.md"))).toBe(true);

    const migratedConfig = JSON.parse(
      fs.readFileSync(path.join(abosDir, "abos.json"), "utf-8"),
    );
    expect(migratedConfig.heartbeatConfigPath).toBe("~/.abos/heartbeat.yml");
    expect(migratedConfig.dbPath).toBe("~/.abos/state.db");
    expect(migratedConfig.skillsDir).toBe("~/.abos/skills");
    expect(walletModule.walletExists()).toBe(true);
  });

  it("migrates legacy identity when an early ABOS runtime already occupies ~/.abos/runtime", async () => {
    const home = useTempHome();
    const legacyDir = path.join(home, ".automaton");
    const abosDir = path.join(home, ".abos");

    fs.mkdirSync(path.join(legacyDir, "runtime"), { recursive: true });
    fs.mkdirSync(path.join(abosDir, "runtime"), { recursive: true });

    fs.writeFileSync(path.join(legacyDir, "runtime", "old-runtime.txt"), "legacy-code");
    fs.writeFileSync(path.join(abosDir, "runtime", "new-runtime.txt"), "abos-code");

    const wallet = {
      privateKey: `0x${"5".padStart(64, "0")}`,
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    fs.writeFileSync(path.join(legacyDir, "wallet.json"), JSON.stringify(wallet));
    fs.writeFileSync(
      path.join(legacyDir, "automaton.json"),
      JSON.stringify({
        name: "legacy-agent",
        heartbeatConfigPath: "~/.automaton/heartbeat.yml",
        dbPath: "~/.automaton/state.db",
        skillsDir: "~/.automaton/skills",
      }),
    );
    fs.writeFileSync(path.join(legacyDir, "state.db"), "legacy-db");

    vi.resetModules();
    const walletModule = await import("../identity/wallet.js");

    expect(walletModule.getAbosDir()).toBe(abosDir);
    expect(walletModule.walletExists()).toBe(true);
    expect(
      JSON.parse(fs.readFileSync(path.join(abosDir, "wallet.json"), "utf-8")),
    ).toEqual(wallet);
    expect(fs.readFileSync(path.join(abosDir, "state.db"), "utf-8")).toBe("legacy-db");
    expect(fs.statSync(abosDir).mode & 0o777).toBe(0o700);

    // New ABOS executable source is never overwritten by legacy state migration.
    expect(fs.readFileSync(path.join(abosDir, "runtime", "new-runtime.txt"), "utf-8")).toBe("abos-code");

    // Historical Automaton executable source is not treated as identity state.
    expect(fs.readFileSync(path.join(legacyDir, "runtime", "old-runtime.txt"), "utf-8")).toBe("legacy-code");
    expect(fs.existsSync(path.join(legacyDir, "wallet.json"))).toBe(false);
    expect(fs.existsSync(path.join(legacyDir, "automaton.json"))).toBe(false);
  });

  it("validates legacy config before moving identity state", async () => {
    const home = useTempHome();
    const legacyDir = path.join(home, ".automaton");
    const abosDir = path.join(home, ".abos");

    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(
      path.join(legacyDir, "wallet.json"),
      JSON.stringify({
        privateKey: `0x${"6".padStart(64, "0")}`,
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
    );
    fs.writeFileSync(path.join(legacyDir, "state.db"), "must-not-move");
    fs.writeFileSync(path.join(legacyDir, "automaton.json"), "{broken-json");

    vi.resetModules();
    const walletModule = await import("../identity/wallet.js");

    expect(() => walletModule.getAbosDir()).toThrow(/configuration is invalid/);
    expect(fs.existsSync(path.join(legacyDir, "wallet.json"))).toBe(true);
    expect(fs.readFileSync(path.join(legacyDir, "state.db"), "utf-8")).toBe("must-not-move");
    expect(fs.existsSync(abosDir)).toBe(false);
  });

  it("fails closed on every call when legacy identity conflicts with a nonempty ~/.abos without a wallet", async () => {
    const home = useTempHome();
    const legacyDir = path.join(home, ".automaton");
    const abosDir = path.join(home, ".abos");

    fs.mkdirSync(legacyDir, { recursive: true });
    fs.mkdirSync(abosDir, { recursive: true });
    fs.writeFileSync(
      path.join(legacyDir, "wallet.json"),
      JSON.stringify({
        privateKey: `0x${"2".padStart(64, "0")}`,
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
      { mode: 0o600 },
    );
    fs.writeFileSync(path.join(abosDir, "marker.txt"), "already-here");

    vi.resetModules();
    const walletModule = await import("../identity/wallet.js");

    expect(() => walletModule.getAbosDir()).toThrow(/Refusing ABOS startup/);
    expect(() => walletModule.getAbosDir()).toThrow(/Refusing ABOS startup/);
    expect(fs.existsSync(path.join(legacyDir, "wallet.json"))).toBe(true);
    expect(fs.readFileSync(path.join(abosDir, "marker.txt"), "utf-8")).toBe("already-here");
  });

  it("does not overwrite a current ABOS wallet when legacy state also exists", async () => {
    const home = useTempHome();
    const legacyDir = path.join(home, ".automaton");
    const abosDir = path.join(home, ".abos");

    fs.mkdirSync(legacyDir, { recursive: true });
    fs.mkdirSync(abosDir, { recursive: true });

    const legacyWallet = {
      privateKey: `0x${"3".padStart(64, "0")}`,
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const currentWallet = {
      privateKey: `0x${"4".padStart(64, "0")}`,
      createdAt: "2026-02-01T00:00:00.000Z",
    };

    fs.writeFileSync(path.join(legacyDir, "wallet.json"), JSON.stringify(legacyWallet));
    fs.writeFileSync(path.join(abosDir, "wallet.json"), JSON.stringify(currentWallet));

    vi.resetModules();
    const walletModule = await import("../identity/wallet.js");

    expect(walletModule.getAbosDir()).toBe(abosDir);
    expect(
      JSON.parse(fs.readFileSync(path.join(abosDir, "wallet.json"), "utf-8")),
    ).toEqual(currentWallet);
    expect(fs.existsSync(path.join(legacyDir, "wallet.json"))).toBe(true);
  });
});
