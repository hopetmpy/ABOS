import type { AbosTool } from "../types.js";
import type { EnvironmentLifecycleManager } from "./lifecycle.js";
import type { EnvironmentRegistry } from "./registry.js";
import type { EnvironmentSelector } from "./selector.js";
import type { EnvironmentMobilityCoordinator } from "./mobility.js";

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
        "The operation set is discoverable and open-ended; absence means not currently exposed, not impossible.",
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
              description: capability.description,
              available: capability.available,
              requirements: capability.requirements,
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
              "Optional explicit budget. When supplied, unknown provider cost fails closed for immediate execution.",
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
          expectedDurationMs: nullableNumber(args.expected_duration_ms),
          region: nullableString(args.region),
          metadata: objectValue(args.metadata),
        });

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
