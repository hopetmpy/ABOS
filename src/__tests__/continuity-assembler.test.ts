import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
  CREATE_TABLES,
  MIGRATION_V9,
  MIGRATION_V10,
  MIGRATION_V12,
  MIGRATION_V13,
  MIGRATION_V14,
  SCHEMA_VERSION,
} from "../state/schema.js";
import { AdaptiveStore } from "../intelligence/store.js";
import { EventStream } from "../memory/event-stream.js";
import {
  ContinuityAssembler,
  type ContinuityContributor,
} from "../environments/continuity-assembler.js";
import { EnvironmentMigrationStore } from "../environments/mobility-store.js";
import { EnvironmentResourceStore } from "../environments/resource-store.js";

function createDb(filename = ":memory:") {
  const db = new Database(filename);
  db.pragma("foreign_keys = ON");
  db.exec(CREATE_TABLES);
  db.exec(MIGRATION_V9);
  db.exec(MIGRATION_V10);
  db.exec(MIGRATION_V12);
  db.exec(MIGRATION_V13);
  db.exec(MIGRATION_V14);
  return db;
}

function seed(db: Database.Database) {
  const now = new Date(0).toISOString();

  db.prepare(
    `INSERT INTO goals (
      id, title, description, status, strategy,
      expected_revenue_cents, actual_revenue_cents, created_at
    ) VALUES (?, ?, ?, 'active', ?, 0, 0, ?)`,
  ).run(
    "goal-continuity-1",
    "Continue objective",
    "Continue verified work across environment changes.",
    "Preserve learned state while allowing a new execution environment.",
    now,
  );

  db.prepare(
    `INSERT INTO task_graph (
      id, parent_id, goal_id, title, description, status,
      assigned_to, agent_role, priority, dependencies, result,
      estimated_cost_cents, actual_cost_cents, max_retries,
      retry_count, timeout_ms, created_at, started_at
    ) VALUES (?, NULL, ?, ?, ?, 'pending', NULL, ?, 50, '[]', ?, 10, 3, 3, 1, 60000, ?, ?)`,
  ).run(
    "task-continuity-1",
    "goal-continuity-1",
    "Resume processing",
    "Continue after an environment failure without restarting verified preprocessing.",
    "generalist",
    JSON.stringify({
      success: false,
      output: "Preprocessing completed before executor loss.",
      artifacts: [
        "aws://ec2/i-continuity/artifact/%2Ftmp%2Fpartial.bin",
      ],
      costCents: 3,
      duration: 1500,
    }),
    now,
    now,
  );

  db.prepare(
    `INSERT INTO adaptive_paths (
      id, goal_id, task_id, signature, hypothesis, strategy,
      assumptions, required_capabilities, environment, executor,
      sequence, expected_outcome, expected_cost_cents, evidence,
      status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 10, ?, 'executing', ?, ?)`,
  ).run(
    "path-continuity-a",
    "goal-continuity-1",
    "task-continuity-1",
    "signature-a",
    "Verified preprocessing can continue on a replacement executor.",
    "Resume preprocessing output, then complete processing.",
    JSON.stringify(["The partial artifact remains recoverable."]),
    JSON.stringify(["compute"]),
    "aws",
    "aws://ec2/i-continuity",
    JSON.stringify(["preprocess", "complete"]),
    "Processing completes without repeating preprocessing.",
    JSON.stringify(["Preprocessing was observed complete."]),
    now,
    now,
  );

  db.prepare(
    `INSERT INTO adaptive_paths (
      id, goal_id, task_id, signature, hypothesis, strategy,
      assumptions, required_capabilities, environment, executor,
      sequence, expected_outcome, expected_cost_cents, evidence,
      status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, 8, ?, 'candidate', ?, ?)`,
  ).run(
    "path-continuity-b",
    "goal-continuity-1",
    "task-continuity-1",
    "signature-b",
    "A distinct strategy can use the learned history without old executable state.",
    "Reconstruct from durable evidence and continue with an alternate method.",
    JSON.stringify(["Durable evidence is sufficient to replan."]),
    JSON.stringify(["compute"]),
    JSON.stringify(["reconstruct", "complete"]),
    "Processing completes through an alternate strategy.",
    JSON.stringify(["Alternate strategy exists."]),
    now,
    now,
  );

  const adaptive = new AdaptiveStore(db);
  adaptive.bindTask({
    taskId: "task-continuity-1",
    goalId: "goal-continuity-1",
    pathId: "path-continuity-a",
    requiredCapabilities: ["compute"],
    preferredEnvironment: "aws",
  });
  const failedAttempt = adaptive.recordAttempt({
    pathId: "path-continuity-a",
    goalId: "goal-continuity-1",
    taskId: "task-continuity-1",
    outcome: "failed",
    failureClass: "environment_unavailable",
    failureReason: "AWS executor became unavailable after preprocessing.",
    observations: ["Preprocessing had already completed."],
    evidence: ["SSM transport stopped responding."],
    conditionFingerprint: "aws-condition-a",
    noveltyScore: 0.1,
    learnedFacts: ["Do not repeat preprocessing if the artifact is recovered."],
    retryEligible: true,
  });
  adaptive.recordEvidence({
    goalId: "goal-continuity-1",
    pathId: "path-continuity-a",
    attemptId: failedAttempt.id,
    kind: "observation",
    content: "Verified preprocessing completion before executor loss.",
    source: "continuity-test",
    confidence: 1,
  });

  const resources = new EnvironmentResourceStore(db);
  resources.create({
    id: "resource-continuity-aws",
    provider: "aws",
    externalId: "i-continuity",
    type: "aws-ec2-instance",
    goalId: "goal-continuity-1",
    pathId: "path-continuity-a",
    taskId: "task-continuity-1",
    status: "degraded",
    evidence: ["AWS resource became degraded after Task progress."],
    metadata: {
      artifactCollectionState: "pending",
      artifactHost: "aws://ec2/i-continuity",
      remoteArtifacts: ["/tmp/partial.bin"],
      collectedArtifacts: [
        {
          remotePath: "/tmp/verified.txt",
          localPath: "/tmp/abos-collected/verified.txt",
          bytes: 128,
          compressedBytes: 80,
        },
      ],
    },
  });

  const migrations = new EnvironmentMigrationStore(db);
  migrations.create({
    id: "migration-continuity-1",
    goalId: "goal-continuity-1",
    pathId: "path-continuity-a",
    taskId: "task-continuity-1",
    sourceResourceId: "resource-continuity-aws",
    sourceProvider: "aws",
    status: "recovering",
    reason: "Move execution after AWS failure.",
    evidence: ["Mobility retained the failed environment evidence."],
  });
  migrations.recordAttempt("migration-continuity-1", {
    environmentId: "aws",
    conditionFingerprint: "aws-condition-a",
    stage: "dispatch",
    evidence: ["AWS dispatch failed under the recorded condition."],
  });

  const events = new EventStream(db);
  events.append({
    type: "error",
    agentAddress: "parent",
    goalId: "goal-continuity-1",
    taskId: "task-continuity-1",
    content: "Task execution environment failed after partial progress.",
    tokenCount: 0,
    compactedTo: null,
  });

  return { adaptive, resources, migrations, events };
}

function createAssembler(
  db: Database.Database,
  contributors: ContinuityContributor[] = [],
) {
  const seeded = seed(db);
  return new ContinuityAssembler(db, {
    ...seeded,
    contributors,
  });
}

function stableContext(value: ReturnType<ContinuityAssembler["assemble"]>) {
  return {
    ...value,
    assembledAt: "<ignored>",
  };
}

describe("ContinuityAssembler", () => {
  it("composes Task, Goal, Path, failures, mobility evidence, resources, and artifacts without a new authority", () => {
    const db = createDb();
    try {
      const assembler = createAssembler(db);
      const context = assembler.assemble("task-continuity-1");

      expect(context.identity).toEqual({
        goalId: "goal-continuity-1",
        taskId: "task-continuity-1",
        pathId: "path-continuity-a",
      });
      expect(context.goal.title).toBe("Continue objective");
      expect(context.task.title).toBe("Resume processing");
      expect(context.path?.id).toBe("path-continuity-a");
      expect(context.path?.strategy).toContain("Resume preprocessing");

      expect(context.history.failures).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            pathId: "path-continuity-a",
            classification: "environment_unavailable",
            reason: "AWS executor became unavailable after preprocessing.",
          }),
        ]),
      );
      expect(context.history.evidence.map((entry) => entry.content)).toEqual(
        expect.arrayContaining([
          "Verified preprocessing completion before executor loss.",
          "Mobility retained the failed environment evidence.",
          "AWS dispatch failed under the recorded condition.",
          "Task execution environment failed after partial progress.",
        ]),
      );

      expect(context.artifacts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            reference: "/tmp/partial.bin",
            state: "pending",
          }),
          expect.objectContaining({
            reference: "/tmp/abos-collected/verified.txt",
            state: "available",
            materializedPath: "/tmp/abos-collected/verified.txt",
          }),
          expect.objectContaining({
            reference:
              "aws://ec2/i-continuity/artifact/%2Ftmp%2Fpartial.bin",
            state: "unknown",
          }),
        ]),
      );
      expect(context.pending).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "artifact_materialization",
            state: "pending",
          }),
        ]),
      );
      expect(context.checkpoint).toBeNull();

      const tables = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'environment_work_handoff%'",
        )
        .all();
      expect(tables).toEqual([]);
      expect(SCHEMA_VERSION).toBe(14);
    } finally {
      db.close();
    }
  });

  it("loads the requested new Path while preserving learned failures from the previous Path", () => {
    const db = createDb();
    try {
      const assembler = createAssembler(db);
      const context = assembler.assemble("task-continuity-1", {
        targetPathId: "path-continuity-b",
      });

      expect(context.identity.pathId).toBe("path-continuity-b");
      expect(context.path?.id).toBe("path-continuity-b");
      expect(context.path?.strategy).toContain("alternate method");
      expect(context.history.failures).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            pathId: "path-continuity-a",
            reason: "AWS executor became unavailable after preprocessing.",
          }),
        ]),
      );
      expect(context.checkpoint).toBeNull();
    } finally {
      db.close();
    }
  });

  it("keeps optional knowledge contributors open-ended without allowing them to overwrite canonical identity", () => {
    const db = createDb();
    try {
      const contributor: ContinuityContributor = {
        id: "future-memory-provider",
        contribute: () => ({
          memory: [
            {
              content: "A future memory authority supplied relevant context.",
              kind: "future-kind",
              source: {
                authority: "future-memory-authority",
                recordId: "memory-42",
              },
            },
          ],
          extensions: {
            transportHint: "future+transport://opaque",
          },
        }),
      };
      const assembler = createAssembler(db, [contributor]);
      const context = assembler.assemble("task-continuity-1");

      expect(context.identity.taskId).toBe("task-continuity-1");
      expect(context.memory[0]?.content).toContain("future memory authority");
      expect(context.extensions["future-memory-provider"]).toEqual({
        transportHint: "future+transport://opaque",
      });
    } finally {
      db.close();
    }
  });

  it("reconstructs the same logical continuation after a real SQLite close and reopen", () => {
    const dir = fs.mkdtempSync(
      path.join(os.tmpdir(), "abos-continuity-restart-"),
    );
    const filename = path.join(dir, "state.db");

    try {
      const db = createDb(filename);
      const assembler = createAssembler(db);
      const before = stableContext(
        assembler.assemble("task-continuity-1"),
      );
      db.close();

      const reopened = new Database(filename);
      reopened.pragma("foreign_keys = ON");
      const after = stableContext(
        new ContinuityAssembler(reopened).assemble("task-continuity-1"),
      );

      expect(after).toEqual(before);
      reopened.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
