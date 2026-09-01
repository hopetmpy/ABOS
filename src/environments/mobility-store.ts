import type { Database } from "better-sqlite3";
import { ulid } from "ulid";

export type EnvironmentMigrationStatus = string;

export interface EnvironmentMigrationRecord {
  id: string;
  goalId: string | null;
  pathId: string | null;
  taskId: string | null;
  sourceResourceId: string | null;
  sourceProvider: string | null;
  targetResourceId: string | null;
  targetProvider: string | null;
  status: EnvironmentMigrationStatus;
  reason: string;
  requirements: Record<string, unknown>;
  attemptedEnvironments: string[];
  conditionFingerprints: Record<string, string>;
  evidence: string[];
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface EnvironmentMigrationEvent {
  id: string;
  migrationId: string;
  operation: string;
  fromStatus: string | null;
  toStatus: string | null;
  reason: string | null;
  evidence: string[];
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface CreateEnvironmentMigrationInput {
  id?: string;
  goalId?: string | null;
  pathId?: string | null;
  taskId?: string | null;
  sourceResourceId?: string | null;
  sourceProvider?: string | null;
  targetResourceId?: string | null;
  targetProvider?: string | null;
  status?: EnvironmentMigrationStatus;
  reason?: string;
  requirements?: Record<string, unknown>;
  attemptedEnvironments?: string[];
  conditionFingerprints?: Record<string, string>;
  evidence?: string[];
  metadata?: Record<string, unknown>;
}

export interface EnvironmentMigrationFilter {
  goalId?: string;
  pathId?: string;
  taskId?: string;
  status?: string;
  activeOnly?: boolean;
}

const TERMINAL_STATUSES = new Set([
  "completed",
  "cancelled",
  "failed",
  "retired",
]);

export class EnvironmentMigrationStore {
  constructor(private readonly db: Database) {}

  create(input: CreateEnvironmentMigrationInput): EnvironmentMigrationRecord {
    const id = input.id ?? ulid();
    const now = new Date().toISOString();
    const status = input.status ?? "planned";

    this.db.prepare(
      `INSERT INTO environment_migrations (
        id, goal_id, path_id, task_id,
        source_resource_id, source_provider,
        target_resource_id, target_provider,
        status, reason, requirements, attempted_environments,
        condition_fingerprints, evidence, metadata,
        created_at, updated_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    ).run(
      id,
      input.goalId ?? null,
      input.pathId ?? null,
      input.taskId ?? null,
      input.sourceResourceId ?? null,
      input.sourceProvider ?? null,
      input.targetResourceId ?? null,
      input.targetProvider ?? null,
      status,
      input.reason ?? "",
      JSON.stringify(input.requirements ?? {}),
      JSON.stringify(uniqueStrings(input.attemptedEnvironments ?? [])),
      JSON.stringify(input.conditionFingerprints ?? {}),
      JSON.stringify(uniqueStrings(input.evidence ?? [])),
      JSON.stringify(input.metadata ?? {}),
      now,
      now,
    );

    this.recordEvent({
      migrationId: id,
      operation: "create",
      fromStatus: null,
      toStatus: status,
      reason: input.reason ?? "Environment mobility transaction created.",
      evidence: input.evidence ?? [],
      metadata: input.metadata ?? {},
    });

    return this.get(id)!;
  }

  get(id: string): EnvironmentMigrationRecord | null {
    const row = this.db.prepare(
      "SELECT * FROM environment_migrations WHERE id = ?",
    ).get(id) as MigrationRow | undefined;
    return row ? deserializeMigration(row) : null;
  }

  list(filter: EnvironmentMigrationFilter = {}): EnvironmentMigrationRecord[] {
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (filter.goalId) {
      clauses.push("goal_id = ?");
      params.push(filter.goalId);
    }
    if (filter.pathId) {
      clauses.push("path_id = ?");
      params.push(filter.pathId);
    }
    if (filter.taskId) {
      clauses.push("task_id = ?");
      params.push(filter.taskId);
    }
    if (filter.status) {
      clauses.push("status = ?");
      params.push(filter.status);
    }
    if (filter.activeOnly) {
      clauses.push("status NOT IN ('completed','cancelled','failed','retired')");
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.db.prepare(
      `SELECT * FROM environment_migrations ${where}
       ORDER BY updated_at DESC, created_at DESC`,
    ).all(...params) as MigrationRow[];

    return rows.map(deserializeMigration);
  }

  findActiveForTask(
    taskId: string,
    pathId?: string | null,
  ): EnvironmentMigrationRecord | null {
    const rows = this.list({ taskId, activeOnly: true });
    if (pathId) {
      return rows.find((entry) => entry.pathId === pathId) ?? null;
    }
    return rows[0] ?? null;
  }

  transition(
    id: string,
    status: EnvironmentMigrationStatus,
    patch: {
      reason?: string;
      sourceResourceId?: string | null;
      sourceProvider?: string | null;
      targetResourceId?: string | null;
      targetProvider?: string | null;
      requirements?: Record<string, unknown>;
      evidence?: string[];
      metadata?: Record<string, unknown>;
      completed?: boolean;
    } = {},
    operation = "transition",
  ): EnvironmentMigrationRecord {
    const current = this.require(id);
    const now = new Date().toISOString();
    const completedAt =
      patch.completed === true || TERMINAL_STATUSES.has(status)
        ? current.completedAt ?? now
        : patch.completed === false
          ? null
          : current.completedAt;

    this.db.prepare(
      `UPDATE environment_migrations
       SET source_resource_id = ?,
           source_provider = ?,
           target_resource_id = ?,
           target_provider = ?,
           status = ?,
           reason = ?,
           requirements = ?,
           evidence = ?,
           metadata = ?,
           updated_at = ?,
           completed_at = ?
       WHERE id = ?`,
    ).run(
      patch.sourceResourceId !== undefined
        ? patch.sourceResourceId
        : current.sourceResourceId,
      patch.sourceProvider !== undefined
        ? patch.sourceProvider
        : current.sourceProvider,
      patch.targetResourceId !== undefined
        ? patch.targetResourceId
        : current.targetResourceId,
      patch.targetProvider !== undefined
        ? patch.targetProvider
        : current.targetProvider,
      status,
      patch.reason ?? current.reason,
      JSON.stringify({
        ...current.requirements,
        ...(patch.requirements ?? {}),
      }),
      JSON.stringify(uniqueStrings([
        ...current.evidence,
        ...(patch.evidence ?? []),
      ])),
      JSON.stringify({
        ...current.metadata,
        ...(patch.metadata ?? {}),
      }),
      now,
      completedAt,
      id,
    );

    this.recordEvent({
      migrationId: id,
      operation,
      fromStatus: current.status,
      toStatus: status,
      reason: patch.reason ?? null,
      evidence: patch.evidence ?? [],
      metadata: patch.metadata ?? {},
    });

    return this.get(id)!;
  }

  recordAttempt(
    id: string,
    input: {
      environmentId: string;
      conditionFingerprint: string;
      stage: string;
      evidence?: string[];
      metadata?: Record<string, unknown>;
    },
  ): EnvironmentMigrationRecord {
    const current = this.require(id);
    const environmentId = input.environmentId.trim();
    if (!environmentId) {
      throw new Error("Environment migration attempt requires environmentId.");
    }

    const attempted = uniqueStrings([
      ...current.attemptedEnvironments,
      environmentId,
    ]);
    const fingerprints = {
      ...current.conditionFingerprints,
      [environmentId]: input.conditionFingerprint,
    };
    const evidence = uniqueStrings([
      ...current.evidence,
      ...(input.evidence ?? []),
    ]);
    const metadata = {
      ...current.metadata,
      ...(input.metadata ?? {}),
      lastAttemptEnvironment: environmentId,
      lastAttemptStage: input.stage,
      lastAttemptAt: new Date().toISOString(),
    };
    const now = new Date().toISOString();

    this.db.prepare(
      `UPDATE environment_migrations
       SET attempted_environments = ?,
           condition_fingerprints = ?,
           evidence = ?,
           metadata = ?,
           updated_at = ?
       WHERE id = ?`,
    ).run(
      JSON.stringify(attempted),
      JSON.stringify(fingerprints),
      JSON.stringify(evidence),
      JSON.stringify(metadata),
      now,
      id,
    );

    this.recordEvent({
      migrationId: id,
      operation: "attempt",
      fromStatus: current.status,
      toStatus: current.status,
      reason: `Environment attempt recorded at stage=${input.stage}.`,
      evidence: input.evidence ?? [],
      metadata: {
        environmentId,
        conditionFingerprint: input.conditionFingerprint,
        stage: input.stage,
        ...(input.metadata ?? {}),
      },
    });

    return this.get(id)!;
  }

  listEvents(migrationId: string): EnvironmentMigrationEvent[] {
    const rows = this.db.prepare(
      `SELECT * FROM environment_migration_events
       WHERE migration_id = ?
       ORDER BY created_at ASC, rowid ASC`,
    ).all(migrationId) as MigrationEventRow[];

    return rows.map((row) => ({
      id: row.id,
      migrationId: row.migration_id,
      operation: row.operation,
      fromStatus: row.from_status,
      toStatus: row.to_status,
      reason: row.reason,
      evidence: parseStringArray(row.evidence),
      metadata: parseObject(row.metadata),
      createdAt: row.created_at,
    }));
  }

  private require(id: string): EnvironmentMigrationRecord {
    const migration = this.get(id);
    if (!migration) {
      throw new Error(`Environment migration not found: ${id}`);
    }
    return migration;
  }

  private recordEvent(input: {
    migrationId: string;
    operation: string;
    fromStatus: string | null;
    toStatus: string | null;
    reason: string | null;
    evidence: string[];
    metadata: Record<string, unknown>;
  }): void {
    this.db.prepare(
      `INSERT INTO environment_migration_events (
        id, migration_id, operation, from_status, to_status,
        reason, evidence, metadata, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      ulid(),
      input.migrationId,
      input.operation,
      input.fromStatus,
      input.toStatus,
      input.reason,
      JSON.stringify(uniqueStrings(input.evidence)),
      JSON.stringify(input.metadata),
      new Date().toISOString(),
    );
  }
}

interface MigrationRow {
  id: string;
  goal_id: string | null;
  path_id: string | null;
  task_id: string | null;
  source_resource_id: string | null;
  source_provider: string | null;
  target_resource_id: string | null;
  target_provider: string | null;
  status: string;
  reason: string;
  requirements: string;
  attempted_environments: string;
  condition_fingerprints: string;
  evidence: string;
  metadata: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

interface MigrationEventRow {
  id: string;
  migration_id: string;
  operation: string;
  from_status: string | null;
  to_status: string | null;
  reason: string | null;
  evidence: string;
  metadata: string;
  created_at: string;
}

function deserializeMigration(row: MigrationRow): EnvironmentMigrationRecord {
  return {
    id: row.id,
    goalId: row.goal_id,
    pathId: row.path_id,
    taskId: row.task_id,
    sourceResourceId: row.source_resource_id,
    sourceProvider: row.source_provider,
    targetResourceId: row.target_resource_id,
    targetProvider: row.target_provider,
    status: row.status,
    reason: row.reason,
    requirements: parseObject(row.requirements),
    attemptedEnvironments: parseStringArray(row.attempted_environments),
    conditionFingerprints: parseStringMap(row.condition_fingerprints),
    evidence: parseStringArray(row.evidence),
    metadata: parseObject(row.metadata),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

function parseStringMap(value: string): Record<string, string> {
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  } catch {
    return {};
  }
}

function parseObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim()).map((value) => value.trim()))];
}
