import fs from "node:fs";
import path from "node:path";
import type { Database } from "better-sqlite3";
import { persistPlan } from "./plan-mode.js";
import type { PlannerContext, PlannerOutput } from "./planner.js";
import type { FundingProtocol } from "./types.js";
import type { AgentWorkspace } from "./workspace.js";
import { getActiveGoals } from "../state/database.js";
import { EnvironmentResourceStore } from "../environments/resource-store.js";
import { listUnresolvedFinancialEffects } from "../economics/financial-effects.js";
import { describeTaskCostLearning, describeRecordedInferenceResources, getRecordedInferenceResources, getTaskCostCalibration } from "../economics/treasury-projection.js";
import { describeTreasuryReserveLearning, getTreasuryReserveLearning } from "../economics/treasury-reserves.js";

export interface PlannerContextOptions {
  db: Database;
  workspace?: Pick<AgentWorkspace, "basePath" | "listOutputs">;
  funding?: Pick<FundingProtocol, "getBalance">;
  identityAddress?: string;
  creditsCents?: number;
  usdcBalance?: number;
  availableRoles?: string[];
  customRoles?: string[];
  marketIntel?: string;
  idleAgents?: number;
  busyAgents?: number;
  maxAgents?: number;
  adaptiveContext?: string;
  environmentSnapshots?: any[];
  capabilities?: any[];
  /** Prioritize owned resources already associated with the objective. */
  goalId?: string;
}

export const DEFAULT_PLANNER_AVAILABLE_ROLES = [
  "generalist",
  "executor",
  "researcher",
  "tester",
  "debugger",
  "architect",
  "analyst",
  "writer",
  "orchestrator",
  "planner",
  "critic",
] as const;

export async function buildPlannerContext(options: PlannerContextOptions): Promise<PlannerContext> {
  const cachedBalance = readCachedBalance(options.db);
  const creditsCents = await resolveCreditsCents(options, cachedBalance?.creditsCents);
  const usdcBalance = resolveUsdcBalance(options, cachedBalance?.usdcBalance);
  const economicLearning = describeTaskCostLearning(getTaskCostCalibration(options.db));
  const computeInvestment = describeRecordedInferenceResources(getRecordedInferenceResources(options.db));
  const reserveLearning = describeTreasuryReserveLearning(getTreasuryReserveLearning(options.db));
  const resourceOutcomeLearning = describeResourceOutcomeLinks(options.db, options.goalId);
  // Join authoritative observed learning to existing adaptive context rather
  // than creating another planner/memory or decision authority.
  const adaptiveContext = [options.adaptiveContext?.trim(), economicLearning, reserveLearning, computeInvestment, resourceOutcomeLearning]
    .filter((item): item is string => Boolean(item))
    .join("\n\n") || undefined;

  return {
    creditsCents,
    usdcBalance,
    survivalTier: toSurvivalTier(creditsCents),
    availableRoles: normalizeStringList(options.availableRoles, [...DEFAULT_PLANNER_AVAILABLE_ROLES]),
    customRoles: normalizeStringList(options.customRoles, []),
    activeGoals: getActiveGoals(options.db).map((goal) => ({
      id: goal.id,
      title: goal.title,
      description: goal.description,
      status: goal.status,
    })),
    recentOutcomes: loadRecentOutcomes(options.db),
    marketIntel: normalizeLabel(options.marketIntel, "none"),
    idleAgents: clampCount(options.idleAgents),
    busyAgents: clampCount(options.busyAgents),
    maxAgents: Math.max(1, clampCount(options.maxAgents, 1)),
    workspaceFiles: listWorkspaceFiles(options.workspace),
    adaptiveContext,
    environmentSnapshots: options.environmentSnapshots ?? [],
    capabilities: options.capabilities ?? [],
    ownedResources: summarizeOwnedResourceInventory(options.db, options.goalId),
  };
}

/**
 * P-018 is the single inventory authority. This summary exposes only
 * operational identifiers/observations, not credentials, arbitrary provider
 * metadata, tool secrets, supplier cash or an inferred right to reuse.
 * The context-size limit is a transport bound, not a limit on ABOS discovery:
 * incomplete inventory explicitly demands follow-up enumeration.
 */
function summarizeOwnedResourceInventory(
  db: Database, goalId?: string,
): NonNullable<PlannerContext["ownedResources"]> {
  try {
    const owned = new EnvironmentResourceStore(db).list();
    owned.sort((a, b) => {
      const priority = (value: typeof a) =>
        value.goalId === goalId && goalId ? 0 : !value.goalId ? 1 : 2;
      return priority(a) - priority(b) || a.id.localeCompare(b.id);
    });
    const maxContextRows = 100;
    const resources = owned.slice(0, maxContextRows).map(resource => {
      const metadata = resource.metadata;
      const shape = typeof metadata.instanceType === "string"
        ? metadata.instanceType : null;
      const rawCapacity = metadata.capacity;
      const recordedMetrics = rawCapacity && typeof rawCapacity === "object" &&
        !Array.isArray(rawCapacity)
          ? Object.entries(rawCapacity).filter(([metric, quantity]) =>
              metric.trim().length > 0 && typeof quantity === "number" &&
              Number.isFinite(quantity) && quantity > 0)
          : [];
      const capacity = recordedMetrics.length > 0
        ? Object.fromEntries(recordedMetrics.slice(0, 32))
        : null;
      const capacityMetricsOmitted = Math.max(0, recordedMetrics.length - 32);
      const cpuStatus = metadata.cpuUtilizationMetricStatus === "observed"
        ? "observed" : "unknown";
      const cpu = cpuStatus === "observed" &&
        typeof metadata.cpuUtilizationAveragePct === "number" &&
        Number.isFinite(metadata.cpuUtilizationAveragePct) &&
        typeof metadata.cpuUtilizationObservedAt === "string"
          ? {
              averagePct: metadata.cpuUtilizationAveragePct,
              observedAt: metadata.cpuUtilizationObservedAt,
              source: "P-018 provider health; freshness not independently verified",
            }
          : null;
      return {
        id: resource.id,
        provider: resource.provider,
        type: resource.type,
        status: resource.status,
        region: resource.region,
        capabilities: resource.capabilities,
        goalId: resource.goalId,
        pathId: resource.pathId,
        taskId: resource.taskId,
        retentionPolicy: resource.retentionPolicy,
        instanceType: shape,
        recordedCapacity: capacity,
        capacityMetricsOmitted,
        capacityEvidence: {
          status: metadata.capacityMetricStatus === "observed" ? "observed" : "unknown",
          observedAt: typeof metadata.capacityObservedAt === "string" &&
            Number.isFinite(Date.parse(metadata.capacityObservedAt))
              ? metadata.capacityObservedAt : null,
          source: typeof metadata.capacitySource === "string" &&
            metadata.capacitySource.length <= 128
              ? metadata.capacitySource : null,
          freshnessVerified: false,
        },
        lastHealthCheck: resource.lastHealthCheck,
        cpuMeasurement: cpu,
      };
    });
    return {
      status: "observed",
      total: owned.length,
      resources,
      limitations: [
        "Owned/adopted records are not live provider availability, task-spare capacity, verified monetary liquidity or procurement authority.",
        "Check fresh provider health, capabilities, resource shape and Task/Goal ownership before reuse. P-018 capacity numbers are inventory claims until fresh execution-side verification.",
        "Recorded capacity is metric-key/unit-specific (e.g. memoryMb), not CPU utilization. Capacity metric overflow on a resource requires P-018 re-enumeration.",
        ...(owned.length > resources.length
          ? [`Only ${resources.length} of ${owned.length} inventory records fit this planning context; enumerate remaining P-018 inventory before concluding a need is missing.`]
          : []),
      ],
    };
  } catch {
    return {
      status: "unknown", total: null, resources: [],
      limitations: ["P-018 owned inventory could not be read; empty list is not proof that ABOS owns no resources."],
    };
  }
}

/**
 * P-031: correlate existing P-018 resource ownership/lifecycle with P-025
 * Task/Goal outcomes and P-030 local unresolved provider effects. This is
 * planning evidence, not an allocation of task cost to a VM or proof that
 * the resource caused a completion or generated revenue.
 *
 * Includes retired resources, which the reusable/active P-018 inventory
 * intentionally excludes. No new table, billing ledger, scheduling rule,
 * automatic scale/retirement decision or provider API call.
 */
/**
 * Resource-event IDs, not mutable present-day bindings, identify the exact
 * P-018 owner snapshot in the existing P-013 Evidence Fabric. This is an
 * observation at a point in time, never evidence of a continuous allocation
 * interval, causal contribution or provider bill.
 */
interface RecordedResourceAssignment {
  goalId: string | null;
  taskId: string | null;
  operation: string;
  observedAt: string;
  fromStatus: string | null;
  toStatus: string | null;
}

function recordedAssignmentHistory(
  db: Database, resourceId: string,
): { observations: RecordedResourceAssignment[]; events: RecordedResourceAssignment[]; incomplete: boolean } | null {
  try {
    const limit = 1024; // bounded model projection; saturation never implies no prior assignment
    const rows = db.prepare(`
      SELECT v.goal_id AS goalId, v.task_id AS taskId,
             e.operation AS operation, e.created_at AS observedAt,
             e.from_status AS fromStatus, e.to_status AS toStatus
      FROM environment_resource_events e
      INNER JOIN evidence_events v
        ON v.authority_type = 'environment_resource_event'
       AND v.authority_id = e.id AND v.event_type = 'environment.resource_event'
      WHERE e.resource_id = ?
      ORDER BY e.created_at DESC, e.rowid DESC
      LIMIT ?
    `).all(resourceId, limit) as RecordedResourceAssignment[];
    rows.reverse();
    const transitions: RecordedResourceAssignment[] = [];
    for (const row of rows) {
      const previous = transitions[transitions.length - 1];
      if (!previous || previous.goalId !== row.goalId ||
          previous.taskId !== row.taskId) transitions.push(row);
    }
    return { observations: transitions, events: rows, incomplete: rows.length === limit };
  } catch {
    return null; // Legacy/lean embeddings must preserve UNKNOWN.
  }
}


/**
 * P-031 source-only temporal discrimination, never an allocation or a bill.
 * Task execution dates are local timestamps; P-018/P-013 resource events are
 * recorded association snapshots; provider CPU datapoints may summarize a
 * wider bucket. A positive result establishes point-time compatibility ONLY.
 */
function recordedInstant(value: unknown): number | null {
  if (typeof value !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    return null;
  }
  const at = Date.parse(value);
  return Number.isFinite(at) && new Date(at).toISOString().slice(0, 10) ===
    new Date(value).toISOString().slice(0, 10) ? at : null;
}

function describeResourceTaskMeteringTime(
  db: Database,
  history: ReturnType<typeof recordedAssignmentHistory>,
  resource: { goalId: string | null; metadata: Record<string, unknown> },
  goalId?: string,
): string {
  const metadata = resource.metadata;
  const sampleAt = recordedInstant(metadata.cpuUtilizationObservedAt);
  const cpu = metadata.cpuUtilizationAveragePct;
  if (metadata.cpuUtilizationMetricStatus !== "observed" ||
      typeof cpu !== "number" || !Number.isFinite(cpu) || cpu < 0 || cpu > 100 ||
      sampleAt === null) return "UNKNOWN_NO_VALID_CPU_SAMPLE";
  if (goalId && resource.goalId !== goalId)
    return "UNKNOWN_CURRENT_OWNER_DIFFERENT_GOAL";
  if (!history || history.incomplete || history.observations.length === 0)
    return "UNKNOWN_MISSING_OR_INCOMPLETE_OWNER_JOURNAL";

  // The prior snapshot is no more than the latest *recorded* association.
  // Do not interpolate an actual usage interval or assume exclusive use.
  let atSample = -1;
  for (let i = 0; i < history.observations.length; i++) {
    const eventAt = recordedInstant(history.observations[i].observedAt);
    if (eventAt === null) return "UNKNOWN_INVALID_OWNER_EVENT_TIME";
    if (eventAt === sampleAt) return "UNKNOWN_SAMPLE_AT_OWNER_BOUNDARY";
    if (eventAt < sampleAt) atSample = i;
  }
  if (atSample < 0) return "UNKNOWN_SAMPLE_BEFORE_RECORDED_OWNER";
  const snapshot = history.observations[atSample];
  if (!snapshot.taskId || !snapshot.goalId ||
      (goalId && snapshot.goalId !== goalId))
    return "UNKNOWN_NO_SCOPED_TASK_OWNER_AT_SAMPLE";

  let task: {
    goal_id: string; status: string; retry_count: number;
    started_at: string | null; completed_at: string | null;
  } | undefined;
  try {
    task = db.prepare(
      "SELECT goal_id, status, retry_count, started_at, completed_at FROM task_graph WHERE id = ?"
    ).get(snapshot.taskId) as typeof task;
  } catch {
    return "UNKNOWN_TASK_TIME_AUTHORITY_UNREADABLE";
  }
  if (!task || task.goal_id !== snapshot.goalId)
    return "UNKNOWN_TASK_OWNER_MISMATCH";
  // failTask clears started_at/completed_at for retry; present row cannot
  // reconstruct earlier execution intervals, even after retry succeeds.
  if (!Number.isSafeInteger(task.retry_count) || task.retry_count < 0)
    return "UNKNOWN_INVALID_TASK_RETRY_HISTORY";
  if (task.retry_count > 0)
    return "UNKNOWN_RETRIED_TASK_ATTEMPTS_NOT_RECONSTRUCTABLE";
  const started = recordedInstant(task.started_at);
  const completed = task.completed_at == null ? null : recordedInstant(task.completed_at);
  if (started === null || (task.completed_at != null && completed === null) ||
      (completed !== null && completed < started) ||
      (!["running", "completed", "failed", "cancelled"].includes(task.status)) ||
      (task.status !== "running" && completed === null))
    return "UNKNOWN_INCOMPLETE_OR_INVALID_TASK_WINDOW";
  // A CloudWatch --period request is a useful bound for ambiguity checks,
  // NOT authority over the actual sample bucket start/end. For a source
  // timestamp, any Task/owner boundary within one requested period in either
  // direction may intersect the aggregate; do not assign that aggregate.
  const providerPeriod =
    metadata.cpuUtilizationMetricSource === "aws_cloudwatch_AWS/EC2_CPUUtilization_Average" &&
    metadata.cpuUtilizationPeriodEvidence === "requested_only" &&
    typeof metadata.cpuUtilizationRequestedPeriodSeconds === "number" &&
    Number.isSafeInteger(metadata.cpuUtilizationRequestedPeriodSeconds) &&
    (metadata.cpuUtilizationRequestedPeriodSeconds as number) > 0 &&
    (metadata.cpuUtilizationRequestedPeriodSeconds as number) <= Number.MAX_SAFE_INTEGER / 1000
      ? (metadata.cpuUtilizationRequestedPeriodSeconds as number) * 1000 : null;
  if (providerPeriod !== null) {
    if (Math.abs(sampleAt - started) <= providerPeriod ||
        (completed !== null && Math.abs(sampleAt - completed) <= providerPeriod))
      return "UNKNOWN_POSSIBLE_AGGREGATE_CROSSES_TASK_BOUNDARY";
    // Revisit RAW resource events, not the compressed owner-transition list,
    // so detach/reassignment/lifecycle discontinuities cannot be erased by
    // later reassignment back to the same Task.
    for (const event of history.events) {
      const when = recordedInstant(event.observedAt);
      if (when === null) return "UNKNOWN_INVALID_OWNER_EVENT_TIME";
      if (Math.abs(sampleAt - when) > providerPeriod) continue;
      if (event.goalId !== snapshot.goalId || event.taskId !== snapshot.taskId ||
          (event.fromStatus !== event.toStatus &&
            (event.fromStatus !== null || event.toStatus !== "running")))
        return "UNKNOWN_POSSIBLE_AGGREGATE_CROSSES_OWNER_OR_LIFECYCLE_BOUNDARY";
      if (event.operation === "reassign" || event.operation === "detach")
        return "UNKNOWN_POSSIBLE_AGGREGATE_CROSSES_OWNER_OR_LIFECYCLE_BOUNDARY";
    }
  }
  if (sampleAt < started || (completed !== null && sampleAt > completed))
    return "OUTSIDE_RECORDED_TASK_WINDOW_NO_ATTRIBUTION";

  // Provider aggregation coverage, source-clock reliability, exclusivity
  // and per-task metering remain unverified, regardless of timestamp match.
  return `RECORDED_TIMESTAMP_OVERLAP_ONLY task=${snapshot.taskId} ` +
    `metricAt=${metadata.cpuUtilizationObservedAt} taskStarted=${task.started_at} ` +
    `taskCompleted=${task.completed_at ?? "OPEN"} ` +
    `metricRequestedPeriodSeconds=${providerPeriod === null ? "UNKNOWN" : providerPeriod / 1000} ` +
    "metricAggregateCoverage=UNKNOWN taskCpuShare=UNKNOWN providerBilledUsage=UNKNOWN";
}

function describeResourceOutcomeLinks(db: Database, goalId?: string): string | null {
  let resources: ReturnType<EnvironmentResourceStore["list"]>;
  try {
    resources = new EnvironmentResourceStore(db).list({ includeTerminated: true });
  } catch {
    return "P-031 resource→Task outcome evidence UNKNOWN: P-018 inventory is unreadable; no resource economic learning inferred.";
  }
  // Historical goal matches must remain discoverable after reassignment or
  // detachment. The evidence owner recorded at event time is authoritative;
  // the current resource.goalId cannot stand in for that historical owner.
  let historicalIds = new Set<string>();
  let historicalLookupAvailable = true;
  try {
    const goalScope = goalId ? "AND v.goal_id = ?" : "AND v.task_id IS NOT NULL";
    const observed = db.prepare(`
      SELECT DISTINCT e.resource_id AS resourceId
      FROM evidence_events v
      JOIN environment_resource_events e ON e.id = v.authority_id
      WHERE v.authority_type = 'environment_resource_event'
        AND v.event_type = 'environment.resource_event'
        ${goalScope}
    `).all(...(goalId ? [goalId] : [])) as { resourceId: string }[];
    historicalIds = new Set(observed.map(row => row.resourceId));
  } catch {
    historicalLookupAvailable = false;
  }

  const linked = resources.filter(resource => {
    if (goalId && resource.goalId !== goalId && !historicalIds.has(resource.id))
      return false;
    return Boolean(resource.taskId) ||
      resource.metadata.retentionBillingReconciliation === "unverified_after_resource_release" ||
      historicalIds.has(resource.id);
  });
  if (linked.length === 0) {
    return !historicalLookupAvailable
      ? "P-031 historical resource assignment evidence UNKNOWN: existing P-013/P-018 event authorities are unreadable."
      : null;
  }

  linked.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
  const maxRows = 16;
  const samples = linked.slice(0, maxRows);
  let pendingEffects: ReturnType<typeof listUnresolvedFinancialEffects> | null = null;
  try {
    pendingEffects = listUnresolvedFinancialEffects(db).filter(effect =>
      effect.effectKind === "provider_resource_procurement"
    );
  } catch {
    // P-030 may not be installed in a legacy embedding.
  }
  const linkedTask = db.prepare(
    "SELECT id, goal_id, status, estimated_cost_cents, actual_cost_cents FROM task_graph WHERE id = ?"
  );
  const linkedGoal = db.prepare("SELECT id, status FROM goals WHERE id = ?");
  type RecordedTask = {
    id: string; goal_id: string; status: string;
    estimated_cost_cents: number; actual_cost_cents: number;
  };
  const seenCostTaskIds = new Set<string>();
  const lines = samples.map(resource => {
    const task = resource.taskId
      ? linkedTask.get(resource.taskId) as RecordedTask | undefined
      : undefined;
    const matchingTask = task?.goal_id === resource.goalId &&
      (!goalId || resource.goalId === goalId) ? task : undefined;
    const goal = resource.goalId
      ? linkedGoal.get(resource.goalId) as { id: string; status: string } | undefined
      : undefined;
    const outstanding = pendingEffects === null
      ? "UNKNOWN"
      : String(pendingEffects.filter(effect =>
          effect.provider === resource.provider &&
          effect.request.resourceId === resource.id
        ).length);
    const metadata = resource.metadata;
    const cpu = goalId && resource.goalId !== goalId
      ? "UNKNOWN (latest CPU belongs to another current Goal; historical time alignment absent)"
      : metadata.cpuUtilizationMetricStatus === "observed" &&
      typeof metadata.cpuUtilizationAveragePct === "number" &&
      Number.isFinite(metadata.cpuUtilizationAveragePct) &&
      metadata.cpuUtilizationAveragePct >= 0 && metadata.cpuUtilizationAveragePct <= 100 &&
      typeof metadata.cpuUtilizationObservedAt === "string" &&
      Number.isFinite(Date.parse(metadata.cpuUtilizationObservedAt))
        ? `${metadata.cpuUtilizationAveragePct}% @ ${metadata.cpuUtilizationObservedAt} (historical; freshness not established)`
        : "UNKNOWN";
    // A Task may bind to multiple resources; quote its local cost only once,
    // and never allocate that Task metric as a provider resource expense.
    const duplicateTaskCost = matchingTask
      ? seenCostTaskIds.has(matchingTask.id) : false;
    if (matchingTask) seenCostTaskIds.add(matchingTask.id);
    const localActual = duplicateTaskCost
      ? `REFERENCE_ONLY:${matchingTask?.id}`
      : matchingTask &&
          Number.isSafeInteger(matchingTask.actual_cost_cents) &&
          matchingTask.actual_cost_cents > 0 &&
          ["completed", "failed", "cancelled"].includes(matchingTask.status)
            ? String(matchingTask.actual_cost_cents) : "UNKNOWN";
    const localEstimate = duplicateTaskCost
      ? `REFERENCE_ONLY:${matchingTask?.id}`
      : matchingTask &&
          Number.isSafeInteger(matchingTask.estimated_cost_cents) &&
          matchingTask.estimated_cost_cents > 0
            ? String(matchingTask.estimated_cost_cents) : "UNKNOWN";
    const history = recordedAssignmentHistory(db, resource.id);
    const meteringTime = describeResourceTaskMeteringTime(db, history, resource, goalId);
    const assignments = history?.observations.filter(row =>
      row.taskId && (!goalId || row.goalId === goalId)
    ) ?? [];
    // Consecutive assignment events are sampled from the P-018/P-013 journal,
    // not from current ownership; timestamps are observations, not durations.
    const historicalLines = assignments.slice(-8).map(row => {
      const historicalTask = linkedTask.get(row.taskId!) as RecordedTask | undefined;
      const taskStatus = historicalTask?.goal_id === row.goalId
        ? historicalTask.status : "UNKNOWN";
      return `eventAt=${Number.isFinite(Date.parse(row.observedAt)) ? row.observedAt : "UNKNOWN"} ` +
        `goal=${row.goalId ?? "UNKNOWN"} task=${row.taskId} operation=${row.operation}; ` +
        `taskStatusNOW=${taskStatus} (not status at event time)`;
    });
    const recentAssignment = history?.observations.at(-1);
    const detachedOrReassigned = recentAssignment && goalId &&
      recentAssignment.goalId !== goalId ? "left_scoped_goal" : "not_proven";
    return `resource=${resource.id} provider=${resource.provider} lifecycle=${resource.status}; ` +
      `linkedTask=${resource.taskId ?? "UNKNOWN"} taskStatus=${matchingTask?.status ?? "UNKNOWN"}; ` +
      `linkedGoal=${resource.goalId ?? "UNKNOWN"} goalStatus=${goal?.status ?? "UNKNOWN"}; ` +
      `lastCpu=${cpu}; localTaskEstimate=${localEstimate} task_cost_cent; ` +
      `localTaskObservedCost=${localActual} task_cost_cent; ` +
      `unresolvedLocalProviderIntents=${outstanding}; supplierFinalBilling=UNKNOWN; ` +
      `historicalAssignments=${history === null || history.observations.length === 0 ? "UNKNOWN" : historicalLines.length} ` +
      `reassignmentAfterScopedGoal=${detachedOrReassigned}; ` +
      `cpuSampleTaskTimeEvidence=${meteringTime}` +
      (historicalLines.length ? "\n  " + historicalLines.join("\n  ") : "") +
      (history && (history.incomplete || assignments.length > historicalLines.length)
        ? "\n  Historical assignment journal truncated for planner context; enumerate P-018/P-013 for full sequence." : "");
  });
  return [
    "P-031 observed resource/Task/Goal links (P-018/P-013/P-025/P-030, READ ONLY; " +
      "correlation is NOT proof of resource contribution, causal ROI, profit, provider invoice, " +
      "refund, cancellation or authorization). Local Task cost is NOT allocated provider spend:",
    ...lines,
    ...(linked.length > samples.length
      ? [`${linked.length - samples.length} additional linked resources omitted from planner context; enumerate P-018 inventory before a global conclusion.`]
      : []),
    ...(!historicalLookupAvailable
      ? ["Historical P-013/P-018 assignment index is unavailable; earlier owner changes are UNKNOWN."] : []),
    "Assignment event timestamps and Task start/end dates support only conservative point-time compatibility, " +
      "not continuous allocation intervals, provider CPU aggregate bucket boundaries, attribution of utilization during a Task, or cost shares. " +
      "Repeated Task costs are references, not multiple resource expenses. CPU alone cannot establish idleness, " +
      "spare capacity, resize or retirement suitability. An unresolved-local-intent count of zero cannot prove an external bill is closed; " +
      "confirm fresh provider utilization, Task/Goal contribution, shared dependencies and independent supplier billing before economic action.",
  ].join("\n");
}

export async function persistPlannerArtifacts(params: {
  goalId: string;
  workspacePath: string;
  plan: PlannerOutput;
  version?: number;
}): Promise<{ jsonPath: string; mdPath: string; version: number }> {
  const version = params.version ?? getNextPlannerVersion(params.workspacePath);
  const persisted = await persistPlan({
    goalId: params.goalId,
    version,
    plan: params.plan,
    workspacePath: params.workspacePath,
  });

  return {
    ...persisted,
    version,
  };
}

export function getCurrentPlannerVersion(workspacePath: string): number {
  const root = path.resolve(workspacePath);
  if (!fs.existsSync(root)) {
    return 0;
  }

  let highestArchivedVersion = 0;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }

    const match = /^plan-v(\d+)\.json$/u.exec(entry.name);
    if (!match) {
      continue;
    }

    highestArchivedVersion = Math.max(highestArchivedVersion, Number.parseInt(match[1], 10));
  }

  return fs.existsSync(path.join(root, "plan.json"))
    ? Math.max(1, highestArchivedVersion + 1)
    : 0;
}

export function getNextPlannerVersion(workspacePath: string): number {
  const current = getCurrentPlannerVersion(workspacePath);
  return current > 0 ? current + 1 : 1;
}

function loadRecentOutcomes(db: Database): Array<{
  type: string;
  goalId: string | null;
  taskId: string | null;
  content: string;
  createdAt: string;
}> {
  try {
    return db.prepare(
      `SELECT type, goal_id AS goalId, task_id AS taskId, content, created_at AS createdAt
       FROM event_stream
       WHERE type IN ('task_completed', 'task_failed')
       ORDER BY created_at DESC
       LIMIT 20`,
    ).all() as Array<{
      type: string;
      goalId: string | null;
      taskId: string | null;
      content: string;
      createdAt: string;
    }>;
  } catch {
    return [];
  }
}

function readCachedBalance(db: Database): { creditsCents?: number; usdcBalance?: number } | null {
  try {
    const row = db.prepare("SELECT value FROM kv WHERE key = ?").get("last_known_balance") as
      | { value: string }
      | undefined;

    if (!row?.value) {
      return null;
    }

    const parsed = JSON.parse(row.value) as Record<string, unknown>;
    return {
      creditsCents: typeof parsed.creditsCents === "number" && Number.isFinite(parsed.creditsCents)
        ? Math.max(0, Math.floor(parsed.creditsCents))
        : undefined,
      usdcBalance: typeof parsed.usdcBalance === "number" && Number.isFinite(parsed.usdcBalance)
        ? parsed.usdcBalance
        : undefined,
    };
  } catch {
    return null;
  }
}

async function resolveCreditsCents(
  options: PlannerContextOptions,
  cachedCreditsCents?: number,
): Promise<number | null> {
  if (typeof options.creditsCents === "number" && Number.isFinite(options.creditsCents)) {
    return Math.max(0, Math.floor(options.creditsCents));
  }

  // FundingProtocol describes child funding/balance observation. It is not a
  // parent-wallet balance authority, so do not query it with identityAddress.
  // A fresh explicit observation wins; otherwise use a valid cached parent
  // observation. If neither exists, preserve UNKNOWN instead of manufacturing 0.
  if (typeof cachedCreditsCents === "number" && Number.isFinite(cachedCreditsCents)) {
    return Math.max(0, Math.floor(cachedCreditsCents));
  }

  return null;
}

function resolveUsdcBalance(options: PlannerContextOptions, cachedUsdcBalance?: number): number | null {
  if (typeof options.usdcBalance === "number" &&
      Number.isFinite(options.usdcBalance) && options.usdcBalance >= 0) {
    return options.usdcBalance;
  }

  return typeof cachedUsdcBalance === "number" &&
    Number.isFinite(cachedUsdcBalance) && cachedUsdcBalance >= 0
    ? cachedUsdcBalance
    : null;
}

function toSurvivalTier(creditsCents: number | null): string {
  if (creditsCents === null) {
    return "unknown";
  }
  if (creditsCents <= 0) {
    return "critical";
  }
  if (creditsCents < 100) {
    return "low";
  }
  if (creditsCents < 5_000) {
    return "stable";
  }
  return "comfortable";
}

function listWorkspaceFiles(workspace?: Pick<AgentWorkspace, "basePath" | "listOutputs">): string[] {
  if (!workspace) {
    return [];
  }

  try {
    return workspace.listOutputs()
      .map((file) => path.relative(workspace.basePath, file.path).split(path.sep).join("/"))
      .filter((filePath) => filePath.length > 0);
  } catch {
    return [];
  }
}

function normalizeStringList(values: string[] | undefined, fallback: string[]): string[] {
  const normalized = (values ?? fallback)
    .map((value) => normalizeLabel(value, ""))
    .filter((value) => value.length > 0);

  return normalized.length > 0 ? [...new Set(normalized)] : fallback;
}

function normalizeLabel(value: string | undefined, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized.length > 0 ? normalized : fallback;
}

function clampCount(value: number | undefined, fallback = 0): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(0, Math.floor(value));
}
