import { afterEach, describe, expect, it } from "vitest";
import { loadSkills } from "../skills/loader.js";
import type { Skill } from "../types.js";

const ENV_KEY = "ABOS_P008_MISSING_SKILL_REQUIREMENT";
const priorValue = process.env[ENV_KEY];

afterEach(() => {
  if (priorValue === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = priorValue;
});

function persistedSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    name: "persisted-runtime-skill",
    description: "Persisted skill whose runtime requirement may disappear",
    instructions: "Do useful work.",
    source: "self",
    path: "/nonexistent/skills/persisted-runtime-skill/SKILL.md",
    enabled: true,
    autoActivate: true,
    installedAt: "2026-09-13T00:00:00.000Z",
    requires: { env: [ENV_KEY] },
    ...overrides,
  };
}

describe("skill runtime truth", () => {
  it("does not reactivate a persisted skill after restart when its env requirement is gone", () => {
    delete process.env[ENV_KEY];
    const skill = persistedSkill();
    const db = {
      getSkills: () => [skill],
      getSkillByName: () => skill,
      upsertSkill: () => undefined,
    };

    const loaded = loadSkills("/path/that/does/not/exist", db as any);

    expect(loaded).toEqual([]);
  });

  it("allows persisted inventory when the current runtime requirement is actually satisfied", () => {
    process.env[ENV_KEY] = "present";
    const skill = persistedSkill();
    const db = {
      getSkills: () => [skill],
      getSkillByName: () => skill,
      upsertSkill: () => undefined,
    };

    const loaded = loadSkills("/path/that/does/not/exist", db as any);

    expect(loaded.map((entry) => entry.name)).toEqual([skill.name]);
  });
});
