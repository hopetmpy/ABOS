import type { Database } from "better-sqlite3";
import { ulid } from "ulid";
import type {
  EnvironmentResource,
  EnvironmentResourceStatus,
  EnvironmentRetentionPolicy,
} from "./types.js";

export interface EnvironmentResourceEvent {
  id: string;
  resourceId: string;
  provider: string;
  operation: string;
  fromStatus: EnvironmentResourceStatus | null;
  toStatus: EnvironmentResourceStatus | null;
  reason: string | null;
  evidence: string[];
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface CreateEnvironmentResourceInput {
  id?: string;
  provider: string;
  externalId?: string | null;
  type: string;
  goalId?: string | null;
  pathId?: string | null;
  taskId?: string | null;
  status?: EnvironmentResourceStatus;
  region?: string | null;
  capabilities?: string[];
  estimatedCostCents?: number | null;
  actualCostCents?: number;
  credentialsReference?: string | null;
  retentionPolicy?: EnvironmentRetentionPolicy;
  providerState?: string | null;
  evidence?: string[];
  metadata?: Record<string, unknown>;
}

export interface EnvironmentResourceFilter {
  provider?: string;
  status?: EnvironmentResourceStatus;
  goalId?: string;
  pathId?: string;
  taskId?: string;
  includeTerminated?: boolean;
}

export class EnvironmentResourceStore {
  constructor(private readonly db: Database) {}

  create(input: CreateEnvironmentResourceInput): EnvironmentResource {
    const now = new Date().toISOString();
    const id = input.id ?? ulid();
    const status = input.status ?? "requested";

    this.db.prepare(
      `INSERT INTO environment_resources (
        id, provider, external_id, type, goal_id, path_id, task_id, status,
        region, capabilities, estimated_cost_cents, actual_cost_cents,
        credentials_reference, retention_policy, provider_state, evidence,
        metadata, created_at, updated_at, last_health_check
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    ).run(
      id,
      input.provider,
      input.externalId ?? null,
      input.type,
      input.goalId ?? null,
      input.pathId ?? null,
      input.taskId ?? null,
      status,
      input.region ?? null,
      JSON.stringify(input.capabilities ?? []),
      input.estimatedCostCents ?? null,
      Math.max(0, input.actualCostCents ?? 0),
      input.credentialsReference ?? null,
      input.retentionPolicy ?? "until_goal_complete",
      input.providerState ?? null,
      JSON.stringify(input.evidence ?? []),
      JSON.stringify(input.metadata ?? {}),
      now,
      now,
    );

    this.recordEvent({
      resourceId: id,
      provider: input.provider,
      operation: "create",
      fromStatus: null,
      toStatus: status,
      reason: "Resource ownership registered before lifecycle execution.",
      evidence: input.evidence ?? [],
      metadata: input.metadata ?? {},
    });

    return this.get(id)!;
  }

  upsert(resource: EnvironmentResource): EnvironmentResource {
    this.db.prepare(
      `INSERT INTO environment_resources (
        id, provider, external_id, type, goal_id, path_id, task_id, status,
        region, capabilities, estimated_cost_cents, actual_cost_cents,
        credentials_reference, retention_policy, provider_state, evidence,
        metadata, created_at, updated_at, last_health_check
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        provider = excluded.provider,
        external_id = excluded.external_id,
        type = excluded.type,
        goal_id = excluded.goal_id,
        path_id = excluded.path_id,
        task_id = excluded.task_id,
        status = excluded.status,
        region = excluded.region,
        capabilities = excluded.capabilities,
        estimated_cost_cents = excluded.estimated_cost_cents,
        actual_cost_cents = excluded.actual_cost_cents,
        credentials_reference = excluded.credentials_reference,
        retention_policy = excluded.retention_policy,
        provider_state = excluded.provider_state,
        evidence = excluded.evidence,
        metadata = excluded.metadata,
        updated_at = excluded.updated_at,
        last_health_check = excluded.last_health_check`,
    ).run(
      resource.id,
      resource.provider,
      resource.externalId,
      resource.type,
      resource.goalId,
      resource.pathId,
      resource.taskId,
      resource.status,
      resource.region,
      JSON.stringify(resource.capabilities),
      resource.estimatedCostCents,
      Math.max(0, resource.actualCostCents),
      resource.credentialsReference,
      resource.retentionPolicy,
      resource.providerState,
      JSON.stringify(resource.evidence),
      JSON.stringify(resource.metadata),
      resource.createdAt,
      resource.updatedAt,
      resource.lastHealthCheck,
    );

    return this.get(resource.id)!;
  }

  get(id: string): EnvironmentResource | null {
    const row = this.db.prepare(
      "SELECT * FROM environment_resources WHERE id = ?",
    ).get(id) as ResourceRow | undefined;
    return row ? deserializeResource(row) : null;
  }

  findByExternalId(
    provider: string,
    externalId: string,
  ): EnvironmentResource | null {
    const row = this.db.prepare(
      "SELECT * FROM environment_resources WHERE provider = ? AND external_id = ?",
    ).get(provider, externalId) as ResourceRow | undefined;
    return row ? deserializeResource(row) : null;
  }

  list(filter: EnvironmentResourceFilter = {}): EnvironmentResource[] {
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (filter.provider) {
      clauses.push("provider = ?");
      params.push(filter.provider);
    }
    if (filter.status) {
      clauses.push("status = ?");
      params.push(filter.status);
    }
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
    if (!filter.includeTerminated) {
      clauses.push("status != 'terminated'");
    }

    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.db.prepare(
      `SELECT * FROM environment_resources ${where} ORDER BY created_at ASC`,
    ).all(...params) as ResourceRow[];

    return rows.map(deserializeResource);
  }

  transition(
    id: string,
    toStatus: EnvironmentResourceStatus,
    options: {
      operation?: string;
      reason?: string | null;
      evidence?: string[];
      providerState?: string | null;
      metadata?: Record<string, unknown>;
    } = {},
  ): EnvironmentResource {
    const current = this.get(id);
    if (!current) throw new Error(`Environment resource not found: ${id}`);

    const now = new Date().toISOString();
    const evidence = mergeUnique(current.evidence, options.evidence ?? []);
    const metadata = { ...current.metadata, ...(options.metadata ?? {}) };

    this.db.prepare(
      `UPDATE environment_resources
       SET status = ?, provider_state = COALESCE(?, provider_state),
           evidence = ?, metadata = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      toStatus,
      options.providerState ?? null,
      JSON.stringify(evidence),
      JSON.stringify(metadata),
      now,
      id,
    );

    this.recordEvent({
      resourceId: id,
      provider: current.provider,
      operation: options.operation ?? "transition",
      fromStatus: current.status,
      toStatus,
      reason: options.reason ?? null,
      evidence: options.evidence ?? [],
      metadata: options.metadata ?? {},
    });

    return this.get(id)!;
  }

  applyMutation(
    id: string,
    patch: {
      externalId?: string | null;
      type?: string;
      status?: EnvironmentResourceStatus;
      region?: string | null;
      capabilities?: string[];
      estimatedCostCents?: number | null;
      actualCostCents?: number;
      credentialsReference?: string | null;
      retentionPolicy?: EnvironmentRetentionPolicy;
      providerState?: string | null;
      evidence?: string[];
      metadata?: Record<string, unknown>;
      lastHealthCheck?: string | null;
    },
    operation = "update",
    reason?: string,
  ): EnvironmentResource {
    const current = this.get(id);
    if (!current) throw new Error(`Environment resource not found: ${id}`);

    const nextStatus = patch.status ?? current.status;
    const next: EnvironmentResource = {
      ...current,
      externalId: patch.externalId !== undefined ? patch.externalId : current.externalId,
      type: patch.type ?? current.type,
      status: nextStatus,
      region: patch.region !== undefined ? patch.region : current.region,
      capabilities: patch.capabilities ?? current.capabilities,
      estimatedCostCents:
        patch.estimatedCostCents !== undefined
          ? patch.estimatedCostCents
          : current.estimatedCostCents,
      actualCostCents:
        patch.actualCostCents !== undefined
          ? Math.max(0, patch.actualCostCents)
          : current.actualCostCents,
      credentialsReference:
        patch.credentialsReference !== undefined
          ? patch.credentialsReference
          : current.credentialsReference,
      retentionPolicy: patch.retentionPolicy ?? current.retentionPolicy,
      providerState:
        patch.providerState !== undefined ? patch.providerState : current.providerState,
      evidence: mergeUnique(current.evidence, patch.evidence ?? []),
      metadata: { ...current.metadata, ...(patch.metadata ?? {}) },
      updatedAt: new Date().toISOString(),
      lastHealthCheck:
        patch.lastHealthCheck !== undefined
          ? patch.lastHealthCheck
          : current.lastHealthCheck,
    };

    this.upsert(next);
    this.recordEvent({
      resourceId: id,
      provider: current.provider,
      operation,
      fromStatus: current.status,
      toStatus: nextStatus,
      reason: reason ?? null,
      evidence: patch.evidence ?? [],
      metadata: patch.metadata ?? {},
    });
    return this.get(id)!;
  }

  recordHealth(
    id: string,
    patch: {
      status?: EnvironmentResourceStatus;
      providerState?: string | null;
      evidence?: string[];
      metadata?: Record<string, unknown>;
    },
  ): EnvironmentResource {
    return this.applyMutation(
      id,
      {
        ...patch,
        lastHealthCheck: new Date().toISOString(),
      },
      "health",
      "Environment health observation recorded.",
    );
  }

  listEvents(resourceId: string): EnvironmentResourceEvent[] {
    const rows = this.db.prepare(
      `SELECT * FROM environment_resource_events
       WHERE resource_id = ?
       ORDER BY created_at ASC, rowid ASC`,
    ).all(resourceId) as EventRow[];

    return rows.map((row) => ({
      id: row.id,
      resourceId: row.resource_id,
      provider: row.provider,
      operation: row.operation,
      fromStatus: row.from_status as EnvironmentResourceStatus | null,
      toStatus: row.to_status as EnvironmentResourceStatus | null,
      reason: row.reason,
      evidence: parseStringArray(row.evidence),
      metadata: parseObject(row.metadata),
      createdAt: row.created_at,
    }));
  }

  private recordEvent(input: {
    resourceId: string;
    provider: string;
    operation: string;
    fromStatus: EnvironmentResourceStatus | null;
    toStatus: EnvironmentResourceStatus | null;
    reason: string | null;
    evidence: string[];
    metadata: Record<string, unknown>;
  }): void {
    this.db.prepare(
      `INSERT INTO environment_resource_events (
        id, resource_id, provider, operation, from_status, to_status,
        reason, evidence, metadata, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      ulid(),
      input.resourceId,
      input.provider,
      input.operation,
      input.fromStatus,
      input.toStatus,
      input.reason,
      JSON.stringify(input.evidence),
      JSON.stringify(input.metadata),
      new Date().toISOString(),
    );
  }
}

interface ResourceRow {
  id: string;
  provider: string;
  external_id: string | null;
  type: string;
  goal_id: string | null;
  path_id: string | null;
  task_id: string | null;
  status: string;
  region: string | null;
  capabilities: string;
  estimated_cost_cents: number | null;
  actual_cost_cents: number;
  credentials_reference: string | null;
  retention_policy: string;
  provider_state: string | null;
  evidence: string;
  metadata: string;
  created_at: string;
  updated_at: string;
  last_health_check: string | null;
}

interface EventRow {
  id: string;
  resource_id: string;
  provider: string;
  operation: string;
  from_status: string | null;
  to_status: string | null;
  reason: string | null;
  evidence: string;
  metadata: string;
  created_at: string;
}

function deserializeResource(row: ResourceRow): EnvironmentResource {
  return {
    id: row.id,
    provider: row.provider,
    externalId: row.external_id,
    type: row.type,
    goalId: row.goal_id,
    pathId: row.path_id,
    taskId: row.task_id,
    status: row.status as EnvironmentResourceStatus,
    region: row.region,
    capabilities: parseStringArray(row.capabilities),
    estimatedCostCents: row.estimated_cost_cents,
    actualCostCents: row.actual_cost_cents,
    credentialsReference: row.credentials_reference,
    retentionPolicy: row.retention_policy,
    providerState: row.provider_state,
    evidence: parseStringArray(row.evidence),
    metadata: parseObject(row.metadata),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastHealthCheck: row.last_health_check,
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

function mergeUnique(left: string[], right: string[]): string[] {
  return [...new Set([...left, ...right].filter(Boolean))];
}
