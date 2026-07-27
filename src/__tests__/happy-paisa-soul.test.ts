import { describe, it, expect, beforeEach } from "vitest";
import {
  HappyPaisaSoul,
  loadHappyPaisaConfig,
} from "../soul/HappyPaisaSoul.js";
import { loadHeartbeatConfig } from "../heartbeat/config.js";
import fs from "fs";
import os from "os";
import path from "path";

describe("HappyPaisaSoul", () => {
  let soul: HappyPaisaSoul;

  beforeEach(() => {
    soul = new HappyPaisaSoul(loadHappyPaisaConfig());
  });

  it("loads config with Happy Paisa identity", () => {
    const cfg = soul.getConfig();
    expect(cfg.soul.name).toBe("Happy Paisa");
    expect(cfg.soul.type).toBe("spark-engine");
    expect(cfg.soul.beliefs.length).toBeGreaterThan(0);
  });

  it("builds a system-prompt block with persona markers", () => {
    const block = soul.toSystemPromptBlock();
    expect(block).toContain("Happy Paisa");
    expect(block).toContain("spark-engine");
    expect(block).toContain("## End Persona");
    expect(block).toContain(soul.getSoulLine());
  });

  it("responds in charge mode when stuck", () => {
    const msg = soul.respond("blocked on task", "stuck");
    expect(msg.length).toBeGreaterThan(10);
    expect(soul.getState().mode).toBe("charge");
  });

  it("heartbeat waits when recently active", async () => {
    soul.noteInteraction();
    const check = await soul.heartbeatCheck(30);
    expect(check.action).toBe("wait");
  });

  it("heartbeat pokes after long idle", async () => {
    const old = new HappyPaisaSoul(loadHappyPaisaConfig());
    (old as any).state.lastInteraction = new Date(Date.now() - 45 * 60_000);
    const check = await old.heartbeatCheck(30);
    expect(check.action).toBe("poke");
    expect(check.message).toMatch(/fight/i);
  });
});

describe("heartbeat default config", () => {
  it("includes happy_paisa_poke entry", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hb-"));
    const missing = path.join(tmp, "does-not-exist.yml");
    const config = loadHeartbeatConfig(missing);
    const entry = config.entries.find((e) => e.name === "happy_paisa_poke");
    expect(entry).toBeDefined();
    expect(entry?.task).toBe("happy_paisa_poke");
    expect(entry?.enabled).toBe(true);
  });
});
