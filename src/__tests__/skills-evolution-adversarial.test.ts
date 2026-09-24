import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabase } from "../state/database.js";
import { appendEvidenceEvent } from "../observability/evidence.js";
import { CapabilityRegistry } from "../capabilities/registry.js";
import { CapabilityStore } from "../capabilities/store.js";
import { SkillEvolutionEngine } from "../skills/evolution.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

function runtime() {
  const dir = mkdtempSync(join(tmpdir(), "abos-skill-evolution-adversarial-"));
  tempDirs.push(dir);
  const db = createDatabase(join(dir, "state.db"));
  const registry = new CapabilityRegistry(new CapabilityStore(db.raw));
  const engine = new SkillEvolutionEngine(db.raw);
  return { db, registry, engine };
}

function evidence(db: ReturnType<typeof createDatabase>, label: string): string {
  return appendEvidenceEvent(db.raw, {
    correlationId: `test:${label}`,
    eventType: "test.observation",
    domain: "test",
    authorityType: "test_observation",
    authorityId: label,
    epistemicStatus: "observation",
    payload: { label },
    provenance: { source: "skills-evolution-adversarial.test" },
  }).id;
}

function criticalCandidate(engine: SkillEvolutionEngine, seedEvidence: string) {
  return engine.createCandidate({
    definition: {
      name: "critical-helper",
      description: "Critical reusable workflow",
      autoActivate: true,
      requires: {},
      instructions: "Execute only after independent validation evidence.",
      source: "self",
      path: "skill-evolution:critical-helper",
      capability: {
        requiredCapabilities: [],
        provides: ["critical-helper"],
        permissions: [],
        effects: [],
        compatibility: [],
        environment: null,
        inputs: ["incident"],
        outputs: ["result"],
      },
    },
    verification: {
      method: "independent critical replay",
      critical: true,
      minimumIndependentSuccesses: 2,
    },
    evidenceEventIds: [seedEvidence],
  });
}

describe("P-021 adversarial lifecycle hardening", () => {
  it("does not let one evidence event masquerade as two independent successes", () => {
    const { db, registry, engine } = runtime();
    const version = criticalCandidate(engine, evidence(db, "seed"));
    const sharedEvidence = evidence(db, "shared-success");

    engine.recordEvaluation({
      versionId: version.id,
      evaluationKind: "replay",
      outcome: "success",
      evidenceEventId: sharedEvidence,
      taskId: "incident-a",
    });
    engine.recordEvaluation({
      versionId: version.id,
      evaluationKind: "validation",
      outcome: "success",
      evidenceEventId: sharedEvidence,
      taskId: "incident-b",
    });

    expect(() => engine.validateVersion(version.id, registry)).toThrow(/Need 2 independent/i);

    engine.recordEvaluation({
      versionId: version.id,
      evaluationKind: "replay",
      outcome: "success",
      evidenceEventId: evidence(db, "independent-success"),
      taskId: "incident-b",
    });

    expect(engine.validateVersion(version.id, registry).lifecycleState).toBe("validated");
    db.close();
  });

  it("does not let a degraded version reactivate itself through validation or rollback", () => {
    const { db, registry, engine } = runtime();
    const version = criticalCandidate(engine, evidence(db, "seed-degrade"));

    engine.recordEvaluation({
      versionId: version.id,
      evaluationKind: "replay",
      outcome: "success",
      evidenceEventId: evidence(db, "success-a"),
      taskId: "incident-a",
    });
    engine.recordEvaluation({
      versionId: version.id,
      evaluationKind: "replay",
      outcome: "success",
      evidenceEventId: evidence(db, "success-b"),
      taskId: "incident-b",
    });
    engine.validateVersion(version.id, registry);
    engine.activateVersion(version.id, registry);

    engine.degradeVersion(
      version.id,
      evidence(db, "runtime-failure"),
      "runtime evidence invalidated the active version",
      registry,
    );

    expect(engine.getVersion(version.id)?.lifecycleState).toBe("degraded");
    expect(() => engine.validateVersion(version.id, registry)).toThrow(/only candidate/i);
    expect(() => engine.rollback(
      version.skillName,
      version.id,
      evidence(db, "self-rollback-attempt"),
      registry,
    )).toThrow(/superseded/i);
    expect(engine.getVersion(version.id)?.lifecycleState).toBe("degraded");
    expect(registry.isExecutionReady(`skill:${version.skillName}`)).toBe(false);
    db.close();
  });
});
