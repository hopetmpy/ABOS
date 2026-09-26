import type { Database } from "better-sqlite3";
import type { CapabilityRegistry } from "../capabilities/registry.js";
import {
  appendEvidenceEvent,
  correlationIdFor,
  type EvidenceEventRecord,
} from "../observability/evidence.js";
import type { TaskNode } from "./task-graph.js";

export type DelegationActorKind = "parent" | "worker";
export type DelegationCapabilityState = "verified" | "unknown" | "not_required";
export type DelegationAvailabilityState = "available" | "unknown" | "unavailable";
export type DelegationAuthorityState = "self" | "delegated_route" | "unknown";

export interface DelegationActorCandidate {
  address: string;
  name: string;
  role?: string | null;
  status?: string | null;
  kind: DelegationActorKind;
  spawned?: boolean;
}

export interface DelegationHistory {
  taskClass: string;
  successes: number;
  failures: number;
  samples: number;
  successRate: number | null;
  averageCostCents: number | null;
  averageLatencyMs: number | null;
  evidence: string[];
}

export interface DelegationCandidateAssessment {
  actor: DelegationActorCandidate;
  environmentId: string | null;
  availability: DelegationAvailabilityState;
  authority: DelegationAuthorityState;
  capabilityState: DelegationCapabilityState;
  verifiedCapabilities: string[];
  unresolvedCapabilities: string[];
  history: DelegationHistory;
  expectedCostCents: number | null;
  expectedLatencyMs: number | null;
  roleHintMatch: boolean;
  blockers: string[];
  evidence: string[];
}

export interface DelegationDecision {
  taskId: string;
  goalId: string;
  taskClass: string;
  requiredCapabilities: string[];
  preferredEnvironment: string | null;
  selected: DelegationCandidateAssessment | null;
  candidates: DelegationCandidateAssessment[];
  reason: string;
}

export interface CompetenceDelegationInput {
  db: Database;
  task: TaskNode;
  actors: DelegationActorCandidate[];
  parentAddress: string;
  capabilityRegistry?: CapabilityRegistry;
  resolveAgentEnvironment?: (address: string) => string | null;
  isActorAlive?: (address: string) => boolean;
  delegatedDispatchConfigured?: boolean;
}

interface HistoricalTaskRow {
  id: string;
  agentRole: string | null;
  status: string;
  result: string | null;
  assignedTo: string | null;
  requiredCapabilities: string | null;
}

interface ResourceRow {
  provider: string;
  status: string;
  capabilities: string;
  estimatedCostCents: number | null;
  actualCostCents: number | null;
  metadata: string;
  updatedAt: string;
}

interface DelegationReceiptPayload {
  selectedActor?: {
    address?: string;
  };
}

const TERMINAL_TASK_STATUSES = new Set(["completed", "failed"]);
const READY_RESOURCE_STATUSES = new Set(["ready", "running"]);

export function selectDelegationActor(
  input: CompetenceDelegationInput,
): DelegationDecision {
  const requiredCapabilities = normalizeUnique(input.task.requiredCapabilities ?? []);
  const preferredEnvironment = normalizeOptional(input.task.preferredEnvironment);
  const taskClass = delegationTaskClass(input.task);

  const uniqueActors = deduplicateActors(input.actors);
  const assessments = uniqueActors.map((actor) =>
    assessActor({
      ...input,
      actors: uniqueActors,
      actor,
      taskClass,
      requiredCapabilities,
      preferredEnvironment,
    }),
  );

  const eligible = assessments
    .filter((candidate) => candidate.blockers.length === 0)
    .sort(compareAssessments);
  const selected = eligible[0] ?? null;

  return {
    taskId: input.task.id,
    goalId: input.task.goalId,
    taskClass,
    requiredCapabilities,
    preferredEnvironment,
    selected,
    candidates: assessments.sort((left, right) =>
      left.actor.address.localeCompare(right.actor.address),
    ),
    reason: selected
      ? explainSelection(selected, eligible.slice(1))
      : explainNoSelection(assessments),
  };
}

export function recordDelegationDecision(
  db: Database,
  task: TaskNode,
  decision: DelegationDecision,
): EvidenceEventRecord | null {
  if (!tableExists(db, "evidence_events")) return null;

  return appendEvidenceEvent(db, {
    correlationId: correlationIdFor("task", task.id),
    eventType: decision.selected
      ? "orchestration.delegation_selected"
      : "orchestration.delegation_unresolved",
    domain: "orchestration",
    authorityType: "task",
    authorityId: task.id,
    goalId: task.goalId,
    taskId: task.id,
    epistemicStatus: "observation",
    payload: {
      taskClass: decision.taskClass,
      requirements: {
        requiredCapabilities: decision.requiredCapabilities,
        preferredEnvironment: decision.preferredEnvironment,
        roleHint: normalizeOptional(task.agentRole),
      },
      selectedActor: decision.selected
        ? serializeAssessment(decision.selected)
        : null,
      candidates: decision.candidates.map(serializeAssessment),
      reason: decision.reason,
    },
    provenance: {
      source: "P-028 competence delegation",
      derivation:
        "Task requirements + current actor/resource/capability evidence + contextual Task outcomes",
    },
  });
}

export function latestDelegationReceipt(
  db: Database,
  taskId: string,
): EvidenceEventRecord | null {
  if (!tableExists(db, "evidence_events")) return null;
  const row = db.prepare(
    `SELECT *
     FROM evidence_events
     WHERE task_id = ?
       AND event_type IN (
         'orchestration.delegation_selected',
         'orchestration.delegation_unresolved'
       )
     ORDER BY sequence DESC
     LIMIT 1`,
  ).get(taskId) as any | undefined;
  if (!row) return null;
  return {
    sequence: row.sequence,
    id: row.id,
    correlationId: row.correlation_id,
    causationId: row.causation_id ?? null,
    eventType: row.event_type,
    domain: row.domain,
    authorityType: row.authority_type,
    authorityId: row.authority_id ?? null,
    goalId: row.goal_id ?? null,
    taskId: row.task_id ?? null,
    turnId: row.turn_id ?? null,
    toolCallId: row.tool_call_id ?? null,
    epistemicStatus: row.epistemic_status,
    payload: parseJson(row.payload_json) ?? {},
    provenance: parseJson(row.provenance_json) ?? {},
    createdAt: row.created_at,
  };
}

function assessActor(
  input: CompetenceDelegationInput & {
    actor: DelegationActorCandidate;
    taskClass: string;
    requiredCapabilities: string[];
    preferredEnvironment: string | null;
  },
): DelegationCandidateAssessment {
  const actor = input.actor;
  const isParent = sameActorAddress(actor.address, input.parentAddress);
  const blockers: string[] = [];
  const evidence: string[] = [];

  let availability: DelegationAvailabilityState = "unknown";
  if (isParent) {
    availability = "available";
    evidence.push("Parent actor is the currently executing ABOS runtime.");
  } else if (input.isActorAlive) {
    try {
      if (input.isActorAlive(actor.address)) {
        availability = "available";
        evidence.push("Current runtime health/ownership evidence marks the actor execution-ready.");
      } else {
        availability = "unavailable";
        blockers.push("actor is not execution-ready under current health/resource evidence");
        evidence.push("Current runtime health/ownership evidence marks the actor unavailable for assignment.");
      }
    } catch (error) {
      availability = "unknown";
      evidence.push(
        `Actor health observation failed; availability remains UNKNOWN: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  } else if (["running", "healthy"].includes(actor.status ?? "")) {
    availability = "unknown";
    evidence.push(
      `Legacy actor status=${actor.status} is present but no current health authority was supplied; readiness remains UNKNOWN.`,
    );
  }

  const environmentId = resolveEnvironment(input, actor, isParent);
  if (input.preferredEnvironment) {
    if (!environmentId) {
      blockers.push(
        `preferred environment ${input.preferredEnvironment} is not proven for this actor`,
      );
      evidence.push(
        `Actor environment is UNKNOWN while Task requires ${input.preferredEnvironment}.`,
      );
    } else if (normalize(environmentId) !== normalize(input.preferredEnvironment)) {
      blockers.push(
        `actor environment ${environmentId} does not satisfy preferred environment ${input.preferredEnvironment}`,
      );
    }
  }

  const capability = assessCapabilities(
    input.db,
    actor,
    isParent,
    input.requiredCapabilities,
    input.capabilityRegistry,
  );
  evidence.push(...capability.evidence);

  const history = deriveHistory(
    input.db,
    actor.address,
    input.taskClass,
  );
  evidence.push(...history.evidence);

  const resourceEvidence = actorResourceEvidence(input.db, actor.address);
  evidence.push(...resourceEvidence.evidence);

  const expectedCostCents = history.averageCostCents ?? resourceEvidence.estimatedCostCents;
  const expectedLatencyMs = history.averageLatencyMs;

  let authority: DelegationAuthorityState;
  if (isParent) {
    authority = "self";
    evidence.push("Execution uses the parent actor's own authority; no child authority is borrowed.");
  } else if (input.delegatedDispatchConfigured) {
    authority = "delegated_route";
    evidence.push(
      "A canonical delegated Task dispatch route is configured; the child still executes only with its own environment/runtime authority.",
    );
  } else {
    authority = "unknown";
    evidence.push(
      "Delegated dispatch authority was not supplied to the matcher; authority remains UNKNOWN rather than assumed.",
    );
  }

  const requestedRole = normalizeOptional(input.task.agentRole);
  const roleHintMatch = Boolean(
    requestedRole && normalizeOptional(actor.role) === normalize(requestedRole),
  );
  if (roleHintMatch) {
    evidence.push(
      `Human/planner role hint matches (${requestedRole}); this is a tie-break hint, not competence authority.`,
    );
  }

  return {
    actor,
    environmentId,
    availability,
    authority,
    capabilityState: capability.state,
    verifiedCapabilities: capability.verified,
    unresolvedCapabilities: capability.unresolved,
    history,
    expectedCostCents,
    expectedLatencyMs,
    roleHintMatch,
    blockers,
    evidence: uniqueStrings(evidence),
  };
}

function assessCapabilities(
  db: Database,
  actor: DelegationActorCandidate,
  isParent: boolean,
  required: string[],
  capabilityRegistry?: CapabilityRegistry,
): {
  state: DelegationCapabilityState;
  verified: string[];
  unresolved: string[];
  evidence: string[];
} {
  if (required.length === 0) {
    return {
      state: "not_required",
      verified: [],
      unresolved: [],
      evidence: ["Task declares no explicit capability requirements."],
    };
  }

  if (isParent) {
    const verified: string[] = [];
    const evidence: string[] = [];
    for (const requirement of required) {
      const supporting = (capabilityRegistry?.findSupporting(requirement) ?? [])
        .filter(isParentOwnedCapability);
      if (supporting.length > 0) {
        verified.push(requirement);
        evidence.push(
          `Parent capability ${requirement} VERIFIED by ${supporting
            .map((entry) => `${entry.id}@${entry.authority ?? "unknown-authority"}`)
            .join(", ")}.`,
        );
      }
    }
    const unresolved = required.filter(
      (requirement) => !verified.includes(requirement),
    );
    return {
      state: unresolved.length === 0 ? "verified" : "unknown",
      verified,
      unresolved,
      evidence: [
        ...evidence,
        ...(unresolved.length > 0
          ? [
              `Parent capability evidence is UNKNOWN for: ${unresolved.join(", ")}. Absence is not incapability.`,
            ]
          : []),
      ],
    };
  }

  const resources = actorResourceRows(db, actor.address)
    .filter((resource) => READY_RESOURCE_STATUSES.has(resource.status));
  const observed = normalizeUnique(
    resources.flatMap((resource) => parseStringArray(resource.capabilities)),
  );
  const verified = required.filter((requirement) =>
    observed.some((capability) => normalize(capability) === normalize(requirement)),
  );
  const unresolved = required.filter(
    (requirement) => !verified.includes(requirement),
  );

  return {
    state: unresolved.length === 0 ? "verified" : "unknown",
    verified,
    unresolved,
    evidence: [
      ...(verified.length > 0
        ? [
            `Actor-specific ready/running resource evidence verifies: ${verified.join(", ")}.`,
          ]
        : []),
      ...(unresolved.length > 0
        ? [
            `Actor-specific capability evidence is UNKNOWN for: ${unresolved.join(", ")}. Parent/global capabilities were not lent to this actor.`,
          ]
        : []),
    ],
  };
}

function isParentOwnedCapability(capability: any): boolean {
  const environment = normalizeOptional(capability.environment);
  const authority = normalizeOptional(capability.authority);
  if (environment && environment !== "local") return false;
  if (authority?.startsWith("environment:") && authority !== "environment:local") {
    return false;
  }
  return true;
}

function actorResourceEvidence(
  db: Database,
  actorAddress: string,
): { estimatedCostCents: number | null; evidence: string[] } {
  const ready = actorResourceRows(db, actorAddress)
    .filter((resource) => READY_RESOURCE_STATUSES.has(resource.status));
  if (ready.length === 0) {
    return {
      estimatedCostCents: null,
      evidence: [
        "No ready/running actor-linked EnvironmentResource cost observation is available; environment cost remains UNKNOWN.",
      ],
    };
  }

  const knownCosts = ready
    .map((resource) => resource.estimatedCostCents)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0);
  return {
    estimatedCostCents:
      knownCosts.length > 0
        ? Math.min(...knownCosts)
        : null,
    evidence: [
      ...ready.map(
        (resource) =>
          `Actor resource provider=${resource.provider} status=${resource.status} observed/updated=${resource.updatedAt}.`,
      ),
      ...(knownCosts.length === 0
        ? ["Actor-linked environment cost remains UNKNOWN; it was not coerced to zero."]
        : [`Known actor-linked environment estimate min=${Math.min(...knownCosts)} cents.`]),
    ],
  };
}

function actorResourceRows(db: Database, actorAddress: string): ResourceRow[] {
  if (!tableExists(db, "environment_resources")) return [];
  const rows = db.prepare(
    `SELECT
       provider,
       status,
       capabilities,
       estimated_cost_cents AS estimatedCostCents,
       actual_cost_cents AS actualCostCents,
       metadata,
       updated_at AS updatedAt
     FROM environment_resources
     WHERE status != 'terminated'
     ORDER BY updated_at DESC`,
  ).all() as ResourceRow[];

  return rows.filter((row) => {
    const metadata = parseJson(row.metadata);
    if (!metadata) return false;
    const executorAddress = typeof metadata.executorAddress === "string"
      ? metadata.executorAddress
      : null;
    const childAddress = typeof metadata.childAddress === "string"
      ? metadata.childAddress
      : null;
    return (
      (executorAddress && sameActorAddress(executorAddress, actorAddress)) ||
      (childAddress && sameActorAddress(childAddress, actorAddress))
    );
  });
}

function deriveHistory(
  db: Database,
  actorAddress: string,
  taskClass: string,
): DelegationHistory {
  if (!tableExists(db, "task_graph")) {
    return emptyHistory(taskClass, "Task history table is unavailable; competence outcome remains UNKNOWN.");
  }

  const byId = new Map<string, HistoricalTaskRow>();
  for (const row of directHistoricalRows(db, actorAddress)) {
    byId.set(row.id, row);
  }
  for (const taskId of receiptAttributedTaskIds(db, actorAddress)) {
    if (byId.has(taskId)) continue;
    const row = historicalTaskById(db, taskId);
    if (row) byId.set(row.id, row);
  }

  const contextual = [...byId.values()]
    .filter((row) => TERMINAL_TASK_STATUSES.has(row.status))
    .filter((row) => historicalTaskClass(row) === taskClass);

  if (contextual.length === 0) {
    return emptyHistory(
      taskClass,
      `No terminal Task outcomes are attributable to this actor for class ${taskClass}; outcome quality remains UNKNOWN.`,
    );
  }

  let successes = 0;
  let failures = 0;
  const costs: number[] = [];
  const latencies: number[] = [];

  for (const row of contextual) {
    const parsed = parseTaskResult(row.result);
    const success = parsed?.success ?? (row.status === "completed");
    if (success) successes += 1;
    else failures += 1;

    if (
      typeof parsed?.costCents === "number" &&
      Number.isFinite(parsed.costCents) &&
      parsed.costCents >= 0
    ) {
      costs.push(parsed.costCents);
    }
    if (
      typeof parsed?.duration === "number" &&
      Number.isFinite(parsed.duration) &&
      parsed.duration >= 0
    ) {
      latencies.push(parsed.duration);
    }
  }

  const samples = successes + failures;
  return {
    taskClass,
    successes,
    failures,
    samples,
    successRate: samples > 0 ? successes / samples : null,
    averageCostCents: average(costs),
    averageLatencyMs: average(latencies),
    evidence: [
      `Contextual actor history class=${taskClass}: successes=${successes}, failures=${failures}, samples=${samples}.`,
      ...(costs.length > 0
        ? [`Observed TaskResult cost average=${average(costs)} cents across ${costs.length} sample(s).`]
        : ["Contextual cost remains UNKNOWN; no attributable TaskResult cost observation was found."]),
      ...(latencies.length > 0
        ? [`Observed TaskResult latency average=${average(latencies)} ms across ${latencies.length} sample(s).`]
        : ["Contextual latency remains UNKNOWN; no attributable TaskResult duration observation was found."]),
    ],
  };
}

function directHistoricalRows(db: Database, actorAddress: string): HistoricalTaskRow[] {
  const hasBindings = tableExists(db, "adaptive_task_bindings");
  const sql = hasBindings
    ? `SELECT
         t.id,
         t.agent_role AS agentRole,
         t.status,
         t.result,
         t.assigned_to AS assignedTo,
         b.required_capabilities AS requiredCapabilities
       FROM task_graph t
       LEFT JOIN adaptive_task_bindings b ON b.task_id = t.id
       WHERE t.assigned_to = ?
         AND t.status IN ('completed', 'failed')
       ORDER BY COALESCE(t.completed_at, t.created_at) DESC
       LIMIT 100`
    : `SELECT
         t.id,
         t.agent_role AS agentRole,
         t.status,
         t.result,
         t.assigned_to AS assignedTo,
         NULL AS requiredCapabilities
       FROM task_graph t
       WHERE t.assigned_to = ?
         AND t.status IN ('completed', 'failed')
       ORDER BY COALESCE(t.completed_at, t.created_at) DESC
       LIMIT 100`;
  try {
    return db.prepare(sql).all(actorAddress) as HistoricalTaskRow[];
  } catch {
    return [];
  }
}

function historicalTaskById(db: Database, taskId: string): HistoricalTaskRow | null {
  const hasBindings = tableExists(db, "adaptive_task_bindings");
  const sql = hasBindings
    ? `SELECT
         t.id,
         t.agent_role AS agentRole,
         t.status,
         t.result,
         t.assigned_to AS assignedTo,
         b.required_capabilities AS requiredCapabilities
       FROM task_graph t
       LEFT JOIN adaptive_task_bindings b ON b.task_id = t.id
       WHERE t.id = ?
       LIMIT 1`
    : `SELECT
         t.id,
         t.agent_role AS agentRole,
         t.status,
         t.result,
         t.assigned_to AS assignedTo,
         NULL AS requiredCapabilities
       FROM task_graph t
       WHERE t.id = ?
       LIMIT 1`;
  try {
    return (db.prepare(sql).get(taskId) as HistoricalTaskRow | undefined) ?? null;
  } catch {
    return null;
  }
}

function receiptAttributedTaskIds(db: Database, actorAddress: string): string[] {
  if (!tableExists(db, "evidence_events")) return [];
  let rows: Array<{ taskId: string | null; payloadJson: string }> = [];
  try {
    rows = db.prepare(
      `SELECT task_id AS taskId, payload_json AS payloadJson
       FROM evidence_events
       WHERE event_type = 'orchestration.delegation_selected'
         AND task_id IS NOT NULL
       ORDER BY sequence DESC
       LIMIT 250`,
    ).all() as Array<{ taskId: string | null; payloadJson: string }>;
  } catch {
    return [];
  }

  return uniqueStrings(
    rows.flatMap((row) => {
      if (!row.taskId) return [];
      const payload = parseJson(row.payloadJson) as DelegationReceiptPayload | null;
      const selected = payload?.selectedActor?.address;
      return selected && sameActorAddress(selected, actorAddress) ? [row.taskId] : [];
    }),
  );
}

function historicalTaskClass(row: HistoricalTaskRow): string {
  const capabilities = normalizeUnique(parseStringArray(row.requiredCapabilities));
  if (capabilities.length > 0) {
    return `caps:${capabilities.map(normalize).sort().join("|")}`;
  }
  const role = normalizeOptional(row.agentRole);
  return role ? `role:${normalize(role)}` : "unclassified";
}

export function delegationTaskClass(task: TaskNode): string {
  const capabilities = normalizeUnique(task.requiredCapabilities ?? []);
  if (capabilities.length > 0) {
    return `caps:${capabilities.map(normalize).sort().join("|")}`;
  }
  const role = normalizeOptional(task.agentRole);
  return role ? `role:${normalize(role)}` : "unclassified";
}

function compareAssessments(
  left: DelegationCandidateAssessment,
  right: DelegationCandidateAssessment,
): number {
  const capability = capabilityRank(right.capabilityState) - capabilityRank(left.capabilityState);
  if (capability !== 0) return capability;

  const leftOutcome = outcomeRank(left.history);
  const rightOutcome = outcomeRank(right.history);
  if (rightOutcome !== leftOutcome) return rightOutcome - leftOutcome;

  if (
    left.history.successRate != null &&
    right.history.successRate != null &&
    left.history.successRate !== right.history.successRate
  ) {
    return right.history.successRate - left.history.successRate;
  }

  if (
    left.expectedCostCents != null &&
    right.expectedCostCents != null &&
    left.expectedCostCents !== right.expectedCostCents
  ) {
    return left.expectedCostCents - right.expectedCostCents;
  }

  if (
    left.expectedLatencyMs != null &&
    right.expectedLatencyMs != null &&
    left.expectedLatencyMs !== right.expectedLatencyMs
  ) {
    return left.expectedLatencyMs - right.expectedLatencyMs;
  }

  if (left.roleHintMatch !== right.roleHintMatch) {
    return left.roleHintMatch ? -1 : 1;
  }

  if (left.actor.kind !== right.actor.kind) {
    return left.actor.kind === "parent" ? -1 : 1;
  }

  return normalizedAddress(left.actor.address)
    .localeCompare(normalizedAddress(right.actor.address));
}

function capabilityRank(state: DelegationCapabilityState): number {
  if (state === "verified") return 2;
  if (state === "not_required") return 1;
  return 0;
}

function outcomeRank(history: DelegationHistory): number {
  if (history.samples === 0 || history.successRate == null) return 1;
  if (history.successes > history.failures) return 2;
  if (history.successes < history.failures) return 0;
  return 1;
}

function explainSelection(
  selected: DelegationCandidateAssessment,
  alternatives: DelegationCandidateAssessment[],
): string {
  const facts = [
    `selected=${selected.actor.address}`,
    `capability=${selected.capabilityState}`,
    `outcomes=${selected.history.successes}/${selected.history.samples}`,
    `environment=${selected.environmentId ?? "UNKNOWN"}`,
    `cost=${selected.expectedCostCents ?? "UNKNOWN"}`,
    `latency=${selected.expectedLatencyMs ?? "UNKNOWN"}`,
    `authority=${selected.authority}`,
  ];
  if (alternatives.length > 0) {
    facts.push(
      `alternatives=${alternatives.map((candidate) => candidate.actor.address).join(",")}`,
    );
  }
  return `Evidence-driven delegation chose ${selected.actor.name}: ${facts.join("; ")}.`;
}

function explainNoSelection(candidates: DelegationCandidateAssessment[]): string {
  if (candidates.length === 0) {
    return "No current actor candidates were supplied. This is current unavailability/discovery state, not proof the Task is impossible.";
  }
  return `No current actor satisfies hard execution constraints: ${candidates
    .map((candidate) =>
      `${candidate.actor.address}=[${candidate.blockers.join("; ") || "unresolved"}]`,
    )
    .join(" | ")}.`;
}

function serializeAssessment(candidate: DelegationCandidateAssessment) {
  return {
    address: candidate.actor.address,
    name: candidate.actor.name,
    kind: candidate.actor.kind,
    roleHint: candidate.actor.role ?? null,
    spawned: candidate.actor.spawned ?? false,
    environmentId: candidate.environmentId,
    availability: candidate.availability,
    authority: candidate.authority,
    capabilityState: candidate.capabilityState,
    verifiedCapabilities: candidate.verifiedCapabilities,
    unresolvedCapabilities: candidate.unresolvedCapabilities,
    history: {
      taskClass: candidate.history.taskClass,
      successes: candidate.history.successes,
      failures: candidate.history.failures,
      samples: candidate.history.samples,
      successRate: candidate.history.successRate,
    },
    expectedCostCents: candidate.expectedCostCents,
    expectedLatencyMs: candidate.expectedLatencyMs,
    roleHintMatch: candidate.roleHintMatch,
    blockers: candidate.blockers,
    evidence: candidate.evidence,
  };
}

function resolveEnvironment(
  input: CompetenceDelegationInput,
  actor: DelegationActorCandidate,
  isParent: boolean,
): string | null {
  if (isParent) return "local";
  try {
    return normalizeOptional(input.resolveAgentEnvironment?.(actor.address)) ?? null;
  } catch {
    return null;
  }
}

function deduplicateActors(
  actors: DelegationActorCandidate[],
): DelegationActorCandidate[] {
  const byAddress = new Map<string, DelegationActorCandidate>();
  for (const actor of actors) {
    const address = actor.address.trim();
    if (!address) continue;
    const key = normalizedAddress(address);
    const existing = byAddress.get(key);
    if (!existing || actor.kind === "parent") {
      byAddress.set(key, { ...actor, address });
    }
  }
  return [...byAddress.values()];
}

function emptyHistory(taskClass: string, evidence: string): DelegationHistory {
  return {
    taskClass,
    successes: 0,
    failures: 0,
    samples: 0,
    successRate: null,
    averageCostCents: null,
    averageLatencyMs: null,
    evidence: [evidence],
  };
}

function parseTaskResult(value: string | null): {
  success?: boolean;
  costCents?: number;
  duration?: number;
} | null {
  if (!value) return null;
  const parsed = parseJson(value);
  if (!parsed) return null;
  return {
    success: typeof parsed.success === "boolean" ? parsed.success : undefined,
    costCents: typeof parsed.costCents === "number" ? parsed.costCents : undefined,
    duration: typeof parsed.duration === "number" ? parsed.duration : undefined,
  };
}

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string");
  }
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

function parseJson(value: string): Record<string, any> | null {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, any>
      : null;
  } catch {
    return null;
  }
}

function tableExists(db: Database, table: string): boolean {
  try {
    return Boolean(
      db.prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name = ? LIMIT 1",
      ).get(table),
    );
  } catch {
    return false;
  }
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(6));
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function normalizeOptional(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeUnique(values: string[]): string[] {
  const entries = new Map<string, string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = normalize(trimmed);
    if (!entries.has(key)) entries.set(key, trimmed);
  }
  return [...entries.values()];
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function normalizedAddress(address: string): string {
  return address.startsWith("0x") ? address.toLowerCase() : address;
}

function sameActorAddress(left: string, right: string): boolean {
  return normalizedAddress(left) === normalizedAddress(right);
}
