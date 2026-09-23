import type { AbosTool } from "../types.js";
import { currentProtectedToolInvoker } from "../agent/protected-tool-invoker.js";
import type { CapabilityRegistry } from "./registry.js";
import { capabilityStateOf } from "./model.js";
import {
  COMPOSITION_PROVIDER,
  compositionPlanHash,
  normalizeCompositionPlan,
  type CapabilityCompositionPlan,
} from "./routes/verified-composition.js";

export const EXECUTE_COMPOSED_CAPABILITY_TOOL = "execute_composed_capability";

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function inputValue(input: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".").filter(Boolean);
  let current: unknown = input;
  for (const part of parts) {
    const record = objectValue(current);
    if (!record || !(part in record)) return undefined;
    current = record[part];
  }
  return current;
}

function classifyNestedError(error: string): "unauthorized" | "prohibited" | "unknown" | "degraded" {
  const normalized = error.toLowerCase();
  if (normalized.includes("policy authorization required") || normalized.includes("authorization pending")) {
    return "unauthorized";
  }
  if (normalized.includes("policy denied") || normalized.includes("prohibited")) {
    return "prohibited";
  }
  if (
    normalized.includes("external effect may already have occurred") ||
    normalized.includes("outcome unknown") ||
    normalized.includes("settlement is unknown")
  ) {
    return "unknown";
  }
  return "degraded";
}

function persistedPlanOf(capability: ReturnType<CapabilityRegistry["get"]>) {
  if (!capability || capability.provider !== COMPOSITION_PROVIDER) return null;
  const raw = capability.metadata?.compositionPlan;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const plan = normalizeCompositionPlan(raw as CapabilityCompositionPlan);
  if (!plan) return null;
  const digest = compositionPlanHash(plan);
  if (capability.version !== `sha256:${digest}`) return null;
  if (capability.metadata?.compositionPlanHash !== digest) return null;
  return plan;
}

function degrade(
  registry: CapabilityRegistry,
  capability: NonNullable<ReturnType<CapabilityRegistry["get"]>>,
  state: "degraded" | "unknown",
  reason: string,
): void {
  registry.register({
    ...capability,
    available: false,
    state,
    observedAt: new Date().toISOString(),
    authority: "p017-composition-executor",
    evidence: [
      ...(capability.evidence ?? []),
      reason,
    ],
  });
}

export function createExecuteComposedCapabilityTool(
  registry: CapabilityRegistry,
): AbosTool {
  return {
    name: EXECUTE_COMPOSED_CAPABILITY_TOOL,
    description:
      "Execute a persisted P-017 declarative composition. Normal use requires VERIFIED_AVAILABLE; probe=true is allowed for an ACQUIRED/PROBED/DEGRADED composition and re-enters Policy for every declared component tool. Runtime input values are never stored in the composition plan.",
    category: "capability",
    riskLevel: "caution",
    parameters: {
      type: "object",
      properties: {
        capabilityId: {
          type: "string",
          description: "Persisted P-017 composition capability ID.",
        },
        input: {
          type: "object",
          additionalProperties: true,
          description: "Runtime values referenced by input.* bindings. Values are redacted from durable outer tool records.",
        },
        probe: {
          type: "boolean",
          description: "Set true only to perform an explicit functional probe before VERIFIED_AVAILABLE.",
        },
      },
      required: ["capabilityId", "input"],
    },
    execute: async (args) => {
      const capabilityId = typeof args.capabilityId === "string"
        ? args.capabilityId.trim()
        : "";
      const input = objectValue(args.input);
      const probe = args.probe === true;
      if (!capabilityId || !input) {
        return JSON.stringify({
          status: "rejected",
          reason: "capabilityId and object input are required.",
        });
      }

      const capability = registry.get(capabilityId);
      if (!capability || capability.provider !== COMPOSITION_PROVIDER) {
        return JSON.stringify({
          status: "unavailable",
          reason: "The requested persisted P-017 composition does not exist.",
        });
      }

      const state = capabilityStateOf(capability);
      if (!probe && !registry.isExecutionReady(capabilityId)) {
        return JSON.stringify({
          status: "unavailable",
          reason: `Composition ${capabilityId} is ${state}, not VERIFIED_AVAILABLE.`,
        });
      }
      if (probe && !["acquired", "probed", "degraded", "unknown", "verified_available"].includes(state)) {
        return JSON.stringify({
          status: "unavailable",
          reason: `Composition ${capabilityId} cannot be probed from state ${state}.`,
        });
      }

      const plan = persistedPlanOf(capability);
      if (!plan) {
        degrade(
          registry,
          capability,
          "degraded",
          "Persisted composition plan/hash no longer matches the verified descriptor definition.",
        );
        return JSON.stringify({
          status: "degraded",
          reason: "Persisted composition plan integrity check failed.",
        });
      }

      for (const componentId of plan.componentIds) {
        if (!registry.isExecutionReady(componentId)) {
          degrade(
            registry,
            capability,
            "degraded",
            `Composition dependency ${componentId} is no longer execution-ready.`,
          );
          return JSON.stringify({
            status: "degraded",
            reason: `Dependency ${componentId} is no longer execution-ready.`,
          });
        }
      }

      const invokeProtected = currentProtectedToolInvoker();
      if (!invokeProtected) {
        return JSON.stringify({
          status: "unavailable",
          reason: "No protected nested-tool invoker is available; direct component execution is refused.",
        });
      }

      const stepResults: string[] = [];
      for (const [index, step] of plan.steps.entries()) {
        const stepArgs: Record<string, unknown> = {};
        for (const [argument, source] of Object.entries(step.argumentBindings)) {
          if (source.startsWith("input.")) {
            const value = inputValue(input, source.slice("input.".length));
            if (value === undefined) {
              return JSON.stringify({
                status: "rejected",
                reason: `Missing runtime input for binding ${source} at step ${index}.`,
              });
            }
            stepArgs[argument] = value;
            continue;
          }
          const match = source.match(/^step\.(\d+)\.result$/);
          if (!match) {
            return JSON.stringify({
              status: "rejected",
              reason: `Invalid persisted binding ${source} at step ${index}.`,
            });
          }
          const prior = Number(match[1]);
          if (!Number.isInteger(prior) || prior >= index || stepResults[prior] === undefined) {
            return JSON.stringify({
              status: "rejected",
              reason: `Binding ${source} does not reference a completed prior step.`,
            });
          }
          stepArgs[argument] = stepResults[prior];
        }

        const result = await invokeProtected(step.toolName, stepArgs);
        if (result.error) {
          const status = classifyNestedError(result.error);
          if (status === "unknown") {
            degrade(
              registry,
              capability,
              "unknown",
              `Composition step ${index} (${step.toolName}) has uncertain external-effect outcome.`,
            );
          } else if (status === "degraded") {
            degrade(
              registry,
              capability,
              "degraded",
              `Composition step ${index} (${step.toolName}) failed current runtime execution.`,
            );
          }
          return JSON.stringify({
            status,
            reason: result.error,
            failedStep: index,
            toolName: step.toolName,
          });
        }
        stepResults.push(result.result);
      }

      const verified = {
        ...capability,
        available: true,
        state: "verified_available" as const,
        observedAt: new Date().toISOString(),
        authority: "p017-composition-executor",
        evidence: [
          ...(capability.evidence ?? []),
          `Protected functional ${probe ? "probe" : "execution"} completed all ${plan.steps.length} composition steps with current verified dependencies.`,
        ],
      };
      registry.register(verified);

      return JSON.stringify({
        status: "verified",
        capabilityId,
        result: stepResults.at(-1) ?? "",
        stepsCompleted: stepResults.length,
      });
    },
  };
}
