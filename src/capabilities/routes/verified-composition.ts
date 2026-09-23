import { createHash } from "node:crypto";
import { currentProtectedToolInvoker } from "../../agent/protected-tool-invoker.js";
import type { CapabilityRegistry } from "../registry.js";
import type { CapabilityDescriptor } from "../model.js";
import { capabilityProvides } from "../model.js";
import type {
  CapabilityAcquisitionCandidate,
  CapabilityAcquisitionRoute,
  CapabilityAcquisitionRouteContext,
  CapabilityRouteResult,
} from "../acquisition.js";

export const VERIFIED_COMPOSITION_ROUTE_ID = "verified-capability-composition";
export const COMPOSITION_PROVIDER = "p017-composition";

export interface CapabilityCompositionStep {
  toolName: string;
  /**
   * Map target argument -> runtime source. Sources are references only, never
   * secret/static values: `input.foo.bar` or `step.0.result`.
   */
  argumentBindings?: Record<string, string>;
}

export interface CapabilityCompositionContract {
  description?: string;
  permissions?: string[];
  inputs?: string[];
  outputs?: string[];
  effects?: string[];
  compatibility?: string[];
}

export interface CapabilityCompositionPlan {
  description: string;
  componentIds: string[];
  steps: CapabilityCompositionStep[];
  contract?: CapabilityCompositionContract;
}

interface PersistedCompositionPlan {
  description: string;
  componentIds: string[];
  steps: Array<{
    toolName: string;
    argumentBindings: Record<string, string>;
  }>;
  contract: {
    description: string;
    permissions: string[];
    inputs: string[];
    outputs: string[];
    effects: string[];
    compatibility: string[];
  };
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(
    value
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean),
  )];
}

function bindingSourceValid(source: string): boolean {
  return /^input\.[A-Za-z0-9_.-]+$/.test(source) || /^step\.\d+\.result$/.test(source);
}

export function normalizeCompositionPlan(
  raw: CapabilityCompositionPlan | undefined,
): PersistedCompositionPlan | null {
  if (!raw || typeof raw !== "object") return null;
  const description = typeof raw.description === "string" ? raw.description.trim() : "";
  const componentIds = strings(raw.componentIds);
  if (!description || componentIds.length < 2 || !Array.isArray(raw.steps) || raw.steps.length === 0) {
    return null;
  }

  const steps: PersistedCompositionPlan["steps"] = [];
  for (const rawStep of raw.steps) {
    if (!rawStep || typeof rawStep !== "object") return null;
    const toolName = typeof rawStep.toolName === "string" ? rawStep.toolName.trim() : "";
    if (!toolName) return null;
    const bindings: Record<string, string> = {};
    for (const [argument, source] of Object.entries(rawStep.argumentBindings ?? {})) {
      const arg = argument.trim();
      const ref = typeof source === "string" ? source.trim() : "";
      if (!arg || !bindingSourceValid(ref)) return null;
      const priorStep = ref.match(/^step\.(\d+)\.result$/);
      if (priorStep && Number(priorStep[1]) >= steps.length) return null;
      bindings[arg] = ref;
    }
    steps.push({ toolName, argumentBindings: bindings });
  }

  const contract = raw.contract ?? {};
  return {
    description,
    componentIds,
    steps,
    contract: {
      description: typeof contract.description === "string"
        ? contract.description.trim()
        : "",
      permissions: strings(contract.permissions),
      inputs: strings(contract.inputs),
      outputs: strings(contract.outputs),
      effects: strings(contract.effects),
      compatibility: strings(contract.compatibility),
    },
  };
}

export function compositionPlanHash(plan: PersistedCompositionPlan): string {
  return createHash("sha256").update(JSON.stringify(plan)).digest("hex");
}

function compositionId(plan: PersistedCompositionPlan): string {
  return `composition:${compositionPlanHash(plan).slice(0, 24)}`;
}

function componentsReady(
  registry: CapabilityRegistry,
  plan: PersistedCompositionPlan,
): { ready: boolean; evidence: string[]; reason: string } {
  const components = plan.componentIds.map((id) => registry.get(id));
  const missing = plan.componentIds.filter((id, index) =>
    !components[index] || !registry.isExecutionReady(id)
  );
  if (missing.length > 0) {
    return {
      ready: false,
      evidence: missing.map((id) => `component ${id} is not execution-ready`),
      reason: "Every composition dependency must be VERIFIED_AVAILABLE before composition probing.",
    };
  }

  const uncoveredTools = plan.steps
    .map((step) => step.toolName)
    .filter((toolName) => !components.some((component) =>
      component && capabilityProvides(component, toolName)
    ));
  if (uncoveredTools.length > 0) {
    return {
      ready: false,
      evidence: uncoveredTools.map((toolName) =>
        `no declared component provides tool ${toolName}`
      ),
      reason:
        "Composition steps may only invoke tools explicitly provided by the verified component set.",
    };
  }

  return {
    ready: true,
    evidence: plan.componentIds.map((id) => `verified component: ${id}`),
    reason: "All declared composition dependencies are execution-ready and cover every step tool.",
  };
}

function acquiredDescriptor(
  request: CapabilityAcquisitionRouteContext["request"],
  plan: PersistedCompositionPlan,
): CapabilityDescriptor {
  const digest = compositionPlanHash(plan);
  return {
    id: compositionId(plan),
    type: "custom",
    provider: COMPOSITION_PROVIDER,
    description: plan.contract.description || plan.description,
    requirements: [],
    provides: [request.requirement],
    permissions: plan.contract.permissions,
    inputs: plan.contract.inputs,
    outputs: plan.contract.outputs,
    effects: plan.contract.effects,
    dependencies: plan.componentIds,
    compatibility: plan.contract.compatibility,
    version: `sha256:${digest}`,
    available: false,
    state: "acquired",
    observedAt: new Date().toISOString(),
    authority: "p017-composition-plan",
    evidence: [
      "Declarative composition plan references only execution-ready P-014 dependencies.",
      "Composition behavior is not VERIFIED_AVAILABLE until the generic executor completes a real protected probe.",
    ],
    metadata: {
      compositionPlan: plan,
      compositionPlanHash: digest,
    },
  };
}

function classifyProbeError(error: string): CapabilityRouteResult {
  const normalized = error.toLowerCase();
  if (normalized.includes("authorization")) {
    return {
      state: "unauthorized",
      evidence: ["Composition probe requires additional Policy authorization."],
      reason: error,
    };
  }
  if (normalized.includes("prohibited") || normalized.includes("policy denied")) {
    return {
      state: "prohibited",
      evidence: ["Composition probe was denied by a protected Policy boundary."],
      reason: error,
    };
  }
  if (normalized.includes("unknown")) {
    return {
      state: "unknown",
      evidence: ["Composition probe produced an uncertain nested outcome and is not retried blindly."],
      reason: error,
    };
  }
  return {
    state: "degraded",
    evidence: ["Composition probe failed before canonical verification."],
    reason: error,
  };
}

export function createVerifiedCompositionRoute(
  registry: CapabilityRegistry,
  rawPlan?: CapabilityCompositionPlan,
  probeInput?: Record<string, unknown>,
): CapabilityAcquisitionRoute {
  const plan = normalizeCompositionPlan(rawPlan);

  return {
    id: VERIFIED_COMPOSITION_ROUTE_ID,

    async discover(
      context: CapabilityAcquisitionRouteContext,
    ): Promise<CapabilityAcquisitionCandidate[]> {
      if (context.initialResolution.kind !== "compose" || !rawPlan) return [];
      const observedAt = new Date().toISOString();
      if (!plan) {
        return [{
          id: "composition:invalid",
          routeId: VERIFIED_COMPOSITION_ROUTE_ID,
          mode: "compose",
          description: "Composition plan failed structural validation.",
          provenance: {
            source: "p017-composition-request",
            reference: "invalid-plan",
            observedAt,
          },
          assessment: {
            disposition: "unknown",
            authority: "p017-composition-validation",
            evidence: ["Composition plan must declare >=2 components, >=1 step, and only safe argument bindings."],
            reason: "Invalid declarative composition plan; no execution attempted.",
            estimatedCostCents: null,
          },
        }];
      }

      const readiness = componentsReady(registry, plan);
      const digest = compositionPlanHash(plan);
      return [{
        id: compositionId(plan),
        routeId: VERIFIED_COMPOSITION_ROUTE_ID,
        mode: "compose",
        description: plan.description,
        provenance: {
          source: "p014-verified-components",
          reference: `composition:${digest}`,
          integrity: digest,
          observedAt,
        },
        assessment: {
          disposition: readiness.ready ? "allow" : "unknown",
          authority: "p014-capability-registry",
          evidence: readiness.evidence.length > 0
            ? readiness.evidence
            : ["No dependency evidence was available."],
          reason: readiness.reason,
          estimatedCostCents: null,
        },
        metadata: { compositionPlanHash: digest },
      }];
    },

    async execute(
      _candidate: CapabilityAcquisitionCandidate,
      context: CapabilityAcquisitionRouteContext,
    ): Promise<CapabilityRouteResult> {
      if (!plan) {
        return {
          state: "rejected",
          evidence: ["Composition plan is invalid."],
          reason: "No composition was materialized.",
        };
      }

      const readiness = componentsReady(registry, plan);
      if (!readiness.ready) {
        return {
          state: "rejected",
          evidence: readiness.evidence,
          reason: readiness.reason,
        };
      }

      const acquired = acquiredDescriptor(context.request, plan);
      // The generic executor needs the persisted declarative plan. ACQUIRED is
      // safe to materialize before probing because it remains non-executable in
      // CapabilityResolver until verification succeeds.
      registry.register(acquired);

      if (!probeInput) {
        return {
          state: "acquired",
          capabilities: [acquired],
          evidence: ["Composition plan materialized as ACQUIRED without inventing probe inputs."],
          reason:
            "Composition dependencies are ready, but the composition itself still requires a real protected functional probe.",
        };
      }

      const invokeProtected = currentProtectedToolInvoker();
      if (!invokeProtected) {
        return {
          state: "unavailable",
          capabilities: [acquired],
          evidence: ["No protected nested-tool invoker is available for composition probing."],
          reason: "P-017 refused to execute composition steps outside the canonical Policy boundary.",
        };
      }

      const result = await invokeProtected("execute_composed_capability", {
        capabilityId: acquired.id,
        input: probeInput,
        probe: true,
      });
      if (result.error) return classifyProbeError(result.error);

      let parsed: Record<string, unknown> | null = null;
      try {
        const candidate = JSON.parse(result.result);
        if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
          parsed = candidate as Record<string, unknown>;
        }
      } catch {
        parsed = null;
      }
      if (parsed?.status !== "verified") {
        return classifyProbeError(
          typeof parsed?.reason === "string"
            ? parsed.reason
            : "Composition executor did not return a verified outcome.",
        );
      }

      return {
        state: "verified_available",
        evidence: [
          "The generic composition executor completed every declared step through protected nested tool execution and promoted the persisted composite through P-014.",
        ],
        reason:
          "Composition functional probe completed. P-017 still relies on canonical re-resolution for the final VERIFIED outcome.",
      };
    },
  };
}
