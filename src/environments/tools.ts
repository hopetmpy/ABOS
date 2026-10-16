import type { AbosTool } from "../types.js";
import type { EnvironmentLifecycleManager } from "./lifecycle.js";
import type { EnvironmentRegistry } from "./registry.js";
import type { EnvironmentSelector } from "./selector.js";
import type { EnvironmentMobilityCoordinator } from "./mobility.js";
import { capabilityStateOf } from "../capabilities/model.js";
import {
  assessProviderProcurementScenario,
  assessConditionalProviderCreditFit,
  type ProviderProcurementScenarioInput,
} from "../economics/treasury-scenario.js";

const MAX_PROVIDER_OUTPUT_CHARS = 64_000;

function sanitizeProviderOutput(value: string): string {
  if (!value) return "";

  let sanitized = value
    // AWS access-key IDs.
    .replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, "[REDACTED_AWS_ACCESS_KEY_ID]")
    // Common JSON / CLI credential fields. Keep field names for diagnostics.
    .replace(
      /("(?:SecretAccessKey|SessionToken|SecretString|Password|password|apiKey|api_key|token)"\s*:\s*")[^"]*(")/gi,
      "$1[REDACTED]$2",
    )
    .replace(
      /((?:SecretAccessKey|SessionToken|SecretString|Password|api[_-]?key|token)\s*[=:]\s*)[^\s]+/gi,
      "$1[REDACTED]",
    );

  if (sanitized.length > MAX_PROVIDER_OUTPUT_CHARS) {
    sanitized =
      sanitized.slice(0, MAX_PROVIDER_OUTPUT_CHARS) +
      `\n[TRUNCATED: provider output exceeded ${MAX_PROVIDER_OUTPUT_CHARS} characters]`;
  }

  return sanitized;
}

const SENSITIVE_AWS_PATTERNS: Array<(args: string[]) => boolean> = [
  (args) => args[0] === "configure" && args.includes("get"),
  (args) => args[0] === "configure" && args.includes("export-credentials"),
  (args) => args[0] === "iam" && args[1] === "create-access-key",
  (args) => args[0] === "secretsmanager" && args[1] === "get-secret-value",
  (args) =>
    args[0] === "ssm" &&
    args[1] === "get-parameter" &&
    args.includes("--with-decryption"),
];

export interface EnvironmentToolingOptions {
  selector?: EnvironmentSelector;
  lifecycle?: EnvironmentLifecycleManager;
  /**
   * Lazy because Task executors are registered after the general tool catalog
   * is assembled. Returns the single runtime mobility authority when ready.
   */
  getMobility?: () => EnvironmentMobilityCoordinator | null;
  /** Read-only P-025 Orchestrator receipt; no model-provided path can attest itself. */
  getReviewedTaskPath?: (taskId: string) => {
    goalId: string; pathId: string; evidence: string[];
  } | null;
  /** Canonical P-030 read of known local pending provider obligations. */
  getProviderAccountFinancialExposure?: (
    providerId: string, providerAccountId: string, unit: string,
  ) => {
    recordedPendingCount: number;
    recordedPendingCents: number;
    unscopedPendingCount: number;
    scopeCoverage: "scoped_records" | "unscoped_records_present";
    limitations: string[];
  };
}

export function createEnvironmentTools(
  registry: EnvironmentRegistry,
  options: EnvironmentToolingOptions = {},
): AbosTool[] {
  const tools: AbosTool[] = [
    {
      name: "environment_exec",
      description:
        "Execute a provider-native command using an explicitly registered environment. " +
        "Arguments are passed as an argv array without shell interpolation. Use environment " +
        "inspection/capability evidence before choosing a provider.",
      category: "environment",
      riskLevel: "caution",
      parameters: {
        type: "object",
        properties: {
          environment: {
            type: "string",
            description: "Registered environment ID, for example aws.",
          },
          args: {
            type: "array",
            items: { type: "string" },
            description:
              "Provider-native argv after the provider executable. For AWS: ['s3','ls'].",
          },
          timeoutMs: {
            type: "number",
            description: "Execution timeout in milliseconds.",
          },
        },
        required: ["environment", "args"],
      },
      execute: async (args) => {
        const environment = String(args.environment ?? "").trim();
        const argv = Array.isArray(args.args)
          ? args.args.filter((value): value is string => typeof value === "string")
          : [];
        const timeoutMs =
          typeof args.timeoutMs === "number" && Number.isFinite(args.timeoutMs)
            ? Math.max(1_000, Math.min(args.timeoutMs, 900_000))
            : 120_000;

        if (!environment) return "BLOCKED: environment is required.";
        if (argv.length === 0) return "BLOCKED: provider argv must not be empty.";

        // Do not feed raw credential/secret material back into the model context.
        // This does not impose a service allowlist; it excludes only known secret-
        // extraction operations from this generic agent-facing surface.
        if (
          environment === "aws" &&
          SENSITIVE_AWS_PATTERNS.some((predicate) => predicate(argv))
        ) {
          return "BLOCKED: provider command would expose credential or secret material.";
        }

        const snapshot = await registry.get(environment)?.inspect();
        if (!snapshot) return `BLOCKED: unknown environment "${environment}".`;
        if (snapshot.availability === "unavailable") {
          return `UNAVAILABLE: ${environment}: ${snapshot.constraints.join("; ") || "environment unavailable"}`;
        }
        if (snapshot.availability === "requires_authorization") {
          return `UNAVAILABLE: ${environment} requires legitimate authorization before execution.`;
        }

        const result = await registry.execute(environment, argv, timeoutMs);
        return [
          `environment: ${environment}`,
          `exit_code: ${result.exitCode}`,
          `stdout: ${sanitizeProviderOutput(result.stdout)}`,
          `stderr: ${sanitizeProviderOutput(result.stderr)}`,
        ].join("\n");
      },
    },
    {
      name: "environment_capabilities",
      description:
        "Inspect every registered environment and its currently supported lifecycle/provider-native operations. " +
        "Capability lifecycle state, authority and evidence are exposed explicitly; discovery/available booleans do not imply execution readiness.",
      category: "environment",
      riskLevel: "safe",
      parameters: { type: "object", properties: {} },
      execute: async () => {
        const snapshots = await registry.inspectAll();
        return JSON.stringify(
          snapshots.map((snapshot) => ({
            id: snapshot.id,
            label: snapshot.label,
            availability: snapshot.availability,
            operations: registry.getSupportedOperations(snapshot.id),
            capabilities: snapshot.capabilities.map((capability) => ({
              id: capability.id,
              type: capability.type,
              provider: capability.provider,
              description: capability.description,
              available: capability.available,
              state: capabilityStateOf(capability),
              observedAt: capability.observedAt ?? null,
              authority: capability.authority ?? null,
              requirements: capability.requirements,
              provides: capability.provides ?? [],
              permissions: capability.permissions,
              dependencies: capability.dependencies ?? [],
              compatibility: capability.compatibility ?? [],
              estimatedCostCents: capability.estimatedCostCents ?? null,
              evidence: capability.evidence ?? [],
            })),
            constraints: snapshot.constraints,
            evidence: snapshot.evidence,
            costModel: snapshot.costModel ?? null,
          })),
          null,
          2,
        );
      },
    },
  ];

  // Explicit read-only economic observation for any provider that implements
  // the open lifecycle contract; it never grants spending authority.
  tools.push({
    name: "environment_economic_evidence",
    description:
      "Observe provider-attributed account/budget cost evidence on demand. " +
      "Budget thresholds, reported spend, Conway credits and usable liquidity are separate; " +
      "this tool never approves or executes a purchase.",
    category: "environment",
    riskLevel: "caution",
    parameters: {
      type: "object",
      properties: {
        environment: { type: "string", description: "Registered provider ID." },
        include_provider_credits: {
          type: "boolean",
          description: "Explicit opt-in to additional provider-account credit observation; provider API reads may have their own costs.",
        },
      },
      required: ["environment"],
    },
    execute: async (args) => {
      const environment = String(args.environment ?? "").trim();
      if (!environment) return "BLOCKED: environment is required.";
      const provider = registry.get(environment);
      if (!provider) return `BLOCKED: unknown environment "${environment}".`;
      if (!provider.observeEconomics) {
        return `UNAVAILABLE: ${environment} has no economic observation adapter yet; not evidence that external economics are impossible.`;
      }
      try {
        const result = await provider.observeEconomics({
          includeProviderCredits: args.include_provider_credits === true,
        });
        return sanitizeProviderOutput(JSON.stringify(result, null, 2));
      } catch {
        return `UNKNOWN: ${environment} economic observation failed; no account balance, budget or spending authority can be inferred.`;
      }
    },
  });

  tools.push({
    name: "environment_procurement_review",
    description:
      "Review a proposed provider acquisition under P-030 with cost recurrence, contingency and alternatives. " +
      "Provider economic observations are used for identity only; AWS budget limits are not financing. " +
      "This is a read-only preliminary scenario, never permission to buy.",
    category: "environment",
    riskLevel: "caution",
    parameters: {
      type: "object",
      properties: {
        environment: { type: "string" },
        unit: { type: "string", description: "Explicit currency unit (for example usd_cent)." },
        task_id: { type: "string", description: "Optional canonical task ID whose reviewed P-025 path must be independently checked." },
        include_provider_credits: { type: "boolean", description: "Explicit additional provider billing read; never financing or authorization." },
        service_name: { type: "string", description: "Exact provider service label for conditional credit comparison." },
        purchase_type: { type: "string", description: "Exact supplier purchase type, not a general category guess." },
        service_start_at: { type: "string", description: "Future ISO date when the quoted service begins." },
        service_end_at: { type: "string", description: "ISO date when this quoted commitment ends." },
        resource_need_evidence: { type: "array", items: { type: "string" } },
        one_time_cents: { type: ["number", "null"] },
        recurring_cents_per_period: { type: ["number", "null"] },
        periods: { type: ["number", "null"] },
        other_charges_cents: { type: ["number", "null"] },
        unpriced_components: { type: "array", items: { type: "string" } },
        billing_terms_evidence: { type: "array", items: { type: "string" } },
        alternatives: { type: "array", items: { type: "object" } },
        no_alternative_evidence: { type: "array", items: { type: "string" } },
        additional_contingency_cents: { type: ["number", "null"] },
        contingency_evidence: { type: "array", items: { type: "string" } },
      },
      required: ["environment", "unit"],
    },
    execute: async (args) => {
      const id = String(args.environment ?? "").trim();
      if (!id) return "BLOCKED: environment is required.";
      const provider = registry.get(id);
      if (!provider) return `BLOCKED: unknown environment "${id}".`;
      if (!provider.observeEconomics) {
        return `UNAVAILABLE: ${id} has no source-backed account-economic adapter for this scenario.`;
      }
      const strings = (value: unknown): string[] => Array.isArray(value)
        ? value.filter((item): item is string => typeof item === "string")
        : [];
      const cents = (value: unknown): number | null =>
        typeof value === "number" && Number.isSafeInteger(value) && value >= 0
          ? value : null;
      try {
        const observed = await provider.observeEconomics({
          includeProviderCredits: args.include_provider_credits === true,
        });
        if (!observed.accountId) {
          return `UNKNOWN: ${id} account identity is not observed; provider procurement scope cannot be reviewed.`;
        }
        // Caller-supplied model numbers never become independently observed
        // financing. Even with Budgets present, UNKNOWN is correct.
        const unit = String(args.unit ?? "").trim();
        const taskId = typeof args.task_id === "string"
          ? args.task_id.trim() : "";
        const pathReceipt = taskId && options.getReviewedTaskPath
          ? options.getReviewedTaskPath(taskId)
          : null;
        const rawAlternatives = Array.isArray(args.alternatives) ? args.alternatives : [];
        const alternatives: NonNullable<ProviderProcurementScenarioInput["alternatives"]> =
          rawAlternatives.filter((x): x is Record<string, unknown> =>
            x !== null && typeof x === "object" && !Array.isArray(x),
          ).map(x => ({
            id: typeof x.id === "string" ? x.id : "",
            projectedCostCents: cents(x.projected_cost_cents),
            unit: typeof x.unit === "string" ? x.unit : "",
            evidence: typeof x.evidence === "string" ? x.evidence : "",
          }));
        const locallyRecorded = options.getProviderAccountFinancialExposure
          ? options.getProviderAccountFinancialExposure(id, observed.accountId, unit)
          : null;
        const review = assessProviderProcurementScenario({
          provider: id,
          accountId: observed.accountId,
          unit,
          resourceNeedEvidence: [
            ...strings(args.resource_need_evidence),
            ...(pathReceipt?.evidence ?? []),
          ],
          alternatives,
          noAlternativeEvidence: strings(args.no_alternative_evidence),
          cost: {
            oneTimeCents: cents(args.one_time_cents),
            recurringCentsPerPeriod: cents(args.recurring_cents_per_period),
            periods: cents(args.periods),
            otherChargesCents: cents(args.other_charges_cents),
            billingTermsEvidence: strings(args.billing_terms_evidence),
            unpricedComponents: strings(args.unpriced_components),
          },
          financing: {
            accountId: observed.accountId,
            unit,
            observedAvailableCents: null,
            basis: "unknown",
            evidence: [],
          },
          existingCommitmentsCents: null,
          reservedCents: null,
          additionalContingencyCents: cents(args.additional_contingency_cents),
          contingencyEvidence: strings(args.contingency_evidence),
        });
        return sanitizeProviderOutput(JSON.stringify({
          observationStatus: observed.status,
          accountId: observed.accountId,
          reviewedStrategicPath: pathReceipt
            ? { goalId: pathReceipt.goalId, pathId: pathReceipt.pathId,
                taskId }
            : null,
          strategicPathCondition: !taskId
            ? "No task id supplied: this is an exploratory scenario, not reviewed path evidence."
            : !pathReceipt
              ? "P-025 reviewed binding for this exact task is unverified or stale."
              : "P-025 path provenance observed, not a purchase permit.",
          // Only local P-030 durable outstanding intents are attributed to
          // this provider/account. Not all supplier contracts/invoices.
          locallyRecordedPendingObligations: locallyRecorded,
          conditionalCreditFits: args.include_provider_credits === true
            ? (observed.providerCredits ?? []).map(credit =>
                assessConditionalProviderCreditFit(credit, {
                  serviceName: String(args.service_name ?? ""),
                  purchaseType: String(args.purchase_type ?? ""),
                  serviceStartAt: String(args.service_start_at ?? ""),
                  serviceEndAt: String(args.service_end_at ?? ""),
                }),
              )
            : null,
          conditionalCreditLimitation: "Candidate restrictions are review evidence only; no credit balance reduces quote, creates USD cash, proves account-specific eligibility or authorizes a purchase.",
          // No budget amount or local pending aggregate becomes free cash.
          scenario: review,
          purchaseAuthorized: false,
        }, null, 2));
      } catch {
        return `UNKNOWN: ${id} provider treasury scenario observation or review failed; not an acquisition authorization.`;
      }
    },
  });

  if (options.selector) {
    tools.push({
      name: "environment_select",
      description:
        "Evaluate all registered environments for capability, operation, availability, cost, reuse and policy evidence. " +
        "Returns ranked candidates and unresolved blockers without treating an unknown/unavailable route as impossible.",
      category: "environment",
      riskLevel: "safe",
      parameters: {
        type: "object",
        properties: {
          required_capabilities: {
            type: "array",
            items: { type: "string" },
            description: "Capabilities required by the objective/task.",
          },
          required_operations: {
            type: "array",
            items: { type: "string" },
            description:
              "Lifecycle/provider operations required by this path. Operation names are open-ended.",
          },
          preferred_environment: {
            type: ["string", "null"],
            description: "Optional preference; not an absolute provider lock.",
          },
          max_estimated_cost_cents: {
            type: ["number", "null"],
            description:
              "Optional explicit provider budget amount; supply max_estimated_cost_unit with it. Estimates with unknown costs or units cannot satisfy this budget.",
          },
          max_estimated_cost_unit: {
            type: ["string", "null"],
            description:
              "Exact budget unit (e.g. usd_cent). Required together with budget amount; never convert unrelated provider credits by comparing raw numbers.",
          },
          expected_duration_ms: {
            type: ["number", "null"],
            description: "Optional expected duration used by provider cost estimation.",
          },
          region: {
            type: ["string", "null"],
            description: "Optional provider region preference/requirement.",
          },
          metadata: {
            type: "object",
            description:
              "Open provider-neutral requirement metadata such as requested vCPU, memoryMb or diskGb.",
          },
        },
        required: ["required_capabilities"],
      },
      execute: async (args) => {
        const result = await options.selector!.select({
          requiredCapabilities: stringArray(args.required_capabilities),
          requiredOperations: stringArray(args.required_operations),
          preferredEnvironment: nullableString(args.preferred_environment),
          maxEstimatedCostCents: nullableNumber(args.max_estimated_cost_cents),
          maxEstimatedCostUnit: nullableString(args.max_estimated_cost_unit),
          expectedDurationMs: nullableNumber(args.expected_duration_ms),
          region: nullableString(args.region),
          metadata: objectValue(args.metadata),
        }, options.lifecycle?.resources?.findReusableCandidates
          ? (environmentId, requirements) =>
              // Read-only P-018 source. This observation ranks potential
              // existing owned spare capacity; fresh health, execution
              // suitability and purchasing authority still require proof.
              options.lifecycle!.resources.findReusableCandidates({
                provider: environmentId,
                requiredCapabilities: requirements.requiredCapabilities,
                region: requirements.region,
              }).length
          : undefined);

        return JSON.stringify({
          selected: result.selected
            ? summarizeCandidate(result.selected)
            : null,
          candidates: result.candidates.map(summarizeCandidate),
          unresolved: result.unresolved,
        }, null, 2);
      },
    });
  }

  if (options.lifecycle) {
    tools.push(
      {
        name: "environment_resources",
        description:
          "List ABOS-owned/adopted environment resources and their Goal/Path/Task ownership, cost, health and retention state.",
        category: "environment",
        riskLevel: "safe",
        parameters: {
          type: "object",
          properties: {
            provider: { type: "string" },
            status: { type: "string" },
            goal_id: { type: "string" },
            path_id: { type: "string" },
            task_id: { type: "string" },
            include_terminated: { type: "boolean" },
          },
        },
        execute: async (args) => {
          const resources = options.lifecycle!.resources.list({
            provider: optionalString(args.provider),
            status: optionalString(args.status) as any,
            goalId: optionalString(args.goal_id),
            pathId: optionalString(args.path_id),
            taskId: optionalString(args.task_id),
            includeTerminated: args.include_terminated === true,
          });
          return JSON.stringify(resources, null, 2);
        },
      },
      {
        name: "environment_health",
        description:
          "Observe and persist health for a tracked environment resource using its provider's lifecycle adapter.",
        category: "environment",
        riskLevel: "safe",
        parameters: {
          type: "object",
          properties: {
            resource_id: { type: "string" },
          },
          required: ["resource_id"],
        },
        execute: async (args) => {
          const resourceId = String(args.resource_id ?? "").trim();
          if (!resourceId) return "BLOCKED: resource_id is required.";
          const resource = await options.lifecycle!.health(resourceId);
          return JSON.stringify(resource, null, 2);
        },
      },
      {
        name: "environment_collect",
        description:
          "Collect provider-visible artifacts/evidence for a tracked environment resource. " +
          "Providers may materialize remote artifacts locally and persist collection state; unavailable collection remains explicit rather than fabricated.",
        category: "environment",
        riskLevel: "safe",
        parameters: {
          type: "object",
          properties: {
            resource_id: { type: "string" },
          },
          required: ["resource_id"],
        },
        execute: async (args) => {
          const resourceId = String(args.resource_id ?? "").trim();
          if (!resourceId) return "BLOCKED: resource_id is required.";
          const result = await options.lifecycle!.collect(resourceId);
          return JSON.stringify(result, null, 2);
        },
      },
      {
        name: "environment_reconcile",
        description:
          "Reconcile a tracked resource against provider reality after restart or uncertainty. " +
          "Unknown provider state is preserved as UNKNOWN rather than fabricated.",
        category: "environment",
        riskLevel: "safe",
        parameters: {
          type: "object",
          properties: {
            resource_id: { type: "string" },
          },
          required: ["resource_id"],
        },
        execute: async (args) => {
          const resourceId = String(args.resource_id ?? "").trim();
          if (!resourceId) return "BLOCKED: resource_id is required.";
          const resource = await options.lifecycle!.reconcile(resourceId);
          return JSON.stringify(resource, null, 2);
        },
      },
    );
  }

  if (options.getMobility) {
    tools.push(
      {
        name: "environment_migrations",
        description:
          "List provider-neutral environment mobility transactions and their source/target, attempts, condition fingerprints, evidence, and restart-safe status.",
        category: "environment",
        riskLevel: "safe",
        parameters: {
          type: "object",
          properties: {
            goal_id: { type: "string" },
            path_id: { type: "string" },
            task_id: { type: "string" },
            status: { type: "string" },
            active_only: { type: "boolean" },
          },
        },
        execute: async (args) => {
          const mobility = options.getMobility!();
          if (!mobility) {
            return "UNAVAILABLE: environment mobility coordinator is not initialized yet.";
          }
          return JSON.stringify(
            mobility.store.list({
              goalId: optionalString(args.goal_id),
              pathId: optionalString(args.path_id),
              taskId: optionalString(args.task_id),
              status: optionalString(args.status),
              activeOnly: args.active_only === true,
            }),
            null,
            2,
          );
        },
      },
      {
        name: "environment_migration_plan",
        description:
          "Plan a non-destructive move away from a tracked source resource using the same open EnvironmentSelector. " +
          "Planning records evidence and ranks alternatives but does not provision or destroy resources.",
        category: "environment",
        riskLevel: "safe",
        parameters: {
          type: "object",
          properties: {
            source_resource_id: { type: "string" },
            reason: { type: "string" },
            required_capabilities: {
              type: "array",
              items: { type: "string" },
            },
            required_operations: {
              type: "array",
              items: { type: "string" },
            },
            preferred_environment: {
              type: ["string", "null"],
            },
            max_estimated_cost_cents: {
              type: ["number", "null"],
            },
            max_estimated_cost_unit: {
              type: ["string", "null"],
              description: "Exact unit supplied with an explicit provider budget amount.",
            },
            expected_duration_ms: {
              type: ["number", "null"],
            },
            region: {
              type: ["string", "null"],
            },
            goal_id: {
              type: ["string", "null"],
            },
            path_id: {
              type: ["string", "null"],
            },
            task_id: {
              type: ["string", "null"],
            },
            metadata: {
              type: "object",
            },
          },
          required: ["source_resource_id", "reason"],
        },
        execute: async (args) => {
          const mobility = options.getMobility!();
          if (!mobility) {
            return "UNAVAILABLE: environment mobility coordinator is not initialized yet.";
          }
          const sourceResourceId = String(
            args.source_resource_id ?? "",
          ).trim();
          const reason = String(args.reason ?? "").trim();
          if (!sourceResourceId) {
            return "BLOCKED: source_resource_id is required.";
          }
          if (!reason) {
            return "BLOCKED: reason is required.";
          }

          const plan = await mobility.plan(
            sourceResourceId,
            {
              requiredCapabilities: stringArray(
                args.required_capabilities,
              ),
              requiredOperations: stringArray(
                args.required_operations,
              ),
              preferredEnvironment:
                nullableString(args.preferred_environment),
              maxEstimatedCostCents:
                nullableNumber(args.max_estimated_cost_cents),
              maxEstimatedCostUnit:
                nullableString(args.max_estimated_cost_unit),
              expectedDurationMs:
                nullableNumber(args.expected_duration_ms),
              region: nullableString(args.region),
              goalId: nullableString(args.goal_id),
              pathId: nullableString(args.path_id),
              taskId: nullableString(args.task_id),
              metadata: objectValue(args.metadata),
            },
            reason,
          );
          return JSON.stringify(plan, null, 2);
        },
      },
      {
        name: "environment_recovery_sweep",
        description:
          "Reconcile degraded/unknown environment resources and attempt provider recovery only when fresh observed conditions justify a materially new recovery attempt. " +
          "This does not provision a replacement or destroy resources.",
        category: "environment",
        riskLevel: "caution",
        parameters: {
          type: "object",
          properties: {},
        },
        execute: async () => {
          const mobility = options.getMobility!();
          if (!mobility) {
            return "UNAVAILABLE: environment mobility coordinator is not initialized yet.";
          }
          return JSON.stringify(
            await mobility.sweepRecovery(),
            null,
            2,
          );
        },
      },
    );
  }

  return tools;
}

function summarizeCandidate(candidate: {
  environmentId: string;
  score: number;
  executionEligible: boolean;
  snapshot: { availability: string };
  operations: string[];
  estimate: {
    estimatedCostCents?: number | null;
    costUnit?: string | null;
    costCoverage?: string;
    startupLatencyMs?: number | null;
    expectedExecutionMs?: number | null;
    reliability?: number | null;
    reusableResourceCount?: number | null;
  };
  missingCapabilities: string[];
  missingOperations: string[];
  blockers: string[];
  evidence: string[];
}) {
  return {
    environment: candidate.environmentId,
    score: candidate.score,
    executionEligible: candidate.executionEligible,
    availability: candidate.snapshot.availability,
    operations: candidate.operations,
    estimatedCostCents: candidate.estimate.estimatedCostCents ?? null,
    costUnit: candidate.estimate.costUnit ?? null,
    costCoverage: candidate.estimate.costCoverage ?? "unknown",
    startupLatencyMs: candidate.estimate.startupLatencyMs ?? null,
    expectedExecutionMs: candidate.estimate.expectedExecutionMs ?? null,
    reliability: candidate.estimate.reliability ?? null,
    reusableResourceCount: candidate.estimate.reusableResourceCount ?? null,
    missingCapabilities: candidate.missingCapabilities,
    missingOperations: candidate.missingOperations,
    blockers: candidate.blockers,
    evidence: candidate.evidence,
  };
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean)
    : [];
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function nullableString(value: unknown): string | null {
  return optionalString(value) ?? null;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}
