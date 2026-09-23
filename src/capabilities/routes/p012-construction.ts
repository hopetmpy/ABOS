import { createHash } from "node:crypto";
import { currentProtectedToolInvoker } from "../../agent/protected-tool-invoker.js";
import type { CapabilityDescriptor } from "../model.js";
import type {
  CapabilityAcquisitionCandidate,
  CapabilityAcquisitionRoute,
  CapabilityAcquisitionRouteContext,
  CapabilityRouteResult,
} from "../acquisition.js";

export const P012_CONSTRUCTION_ROUTE_ID = "p012-transactional-construction";

export interface P012ConstructionEdit {
  path: string;
  content: string;
}

export interface P012ConstructionContract {
  description?: string;
  permissions?: string[];
  inputs?: string[];
  outputs?: string[];
  effects?: string[];
  dependencies?: string[];
  compatibility?: string[];
}

export interface P012ConstructionPlan {
  description: string;
  edits: P012ConstructionEdit[];
  contract?: P012ConstructionContract;
}

function normalizedStrings(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(
    values
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean),
  )];
}

function normalizePlan(plan: P012ConstructionPlan | undefined): P012ConstructionPlan | null {
  if (!plan || typeof plan !== "object") return null;
  const description = typeof plan.description === "string" ? plan.description.trim() : "";
  if (!description || !Array.isArray(plan.edits) || plan.edits.length === 0) return null;

  const edits: P012ConstructionEdit[] = [];
  for (const edit of plan.edits) {
    if (!edit || typeof edit !== "object") return null;
    const path = typeof edit.path === "string" ? edit.path.trim() : "";
    if (!path || typeof edit.content !== "string") return null;
    edits.push({ path, content: edit.content });
  }

  const contract = plan.contract && typeof plan.contract === "object"
    ? {
        description: typeof plan.contract.description === "string"
          ? plan.contract.description.trim()
          : undefined,
        permissions: normalizedStrings(plan.contract.permissions),
        inputs: normalizedStrings(plan.contract.inputs),
        outputs: normalizedStrings(plan.contract.outputs),
        effects: normalizedStrings(plan.contract.effects),
        dependencies: normalizedStrings(plan.contract.dependencies),
        compatibility: normalizedStrings(plan.contract.compatibility),
      }
    : undefined;

  return {
    description,
    edits,
    ...(contract ? { contract } : {}),
  };
}

function planHash(plan: P012ConstructionPlan): string {
  return createHash("sha256")
    .update(JSON.stringify(plan))
    .digest("hex");
}

function capabilityId(requirement: string): string {
  const digest = createHash("sha256")
    .update(requirement.trim().toLowerCase())
    .digest("hex")
    .slice(0, 20);
  return `constructed:${digest}`;
}

function resultFailure(error: string): CapabilityRouteResult {
  const normalized = error.toLowerCase();
  if (normalized.includes("policy authorization required")) {
    return {
      state: "unauthorized",
      evidence: ["P-012 construction requires explicit creator authorization under the canonical Policy boundary."],
      reason: error,
    };
  }
  if (normalized.includes("policy denied")) {
    return {
      state: "prohibited",
      evidence: ["Canonical Policy denied the P-012 source construction before execution."],
      reason: error,
    };
  }
  if (
    normalized.includes("external effect may already have occurred") ||
    normalized.includes("outcome unknown") ||
    normalized.includes("recovery_required")
  ) {
    return {
      state: "unknown",
      evidence: ["Construction activation/recovery state is uncertain; P-017 will not retry the same plan blindly."],
      reason: error,
    };
  }
  return {
    state: "degraded",
    evidence: ["P-012 construction did not complete successfully."],
    reason: error,
  };
}

export function createP012ConstructionRoute(
  rawPlan?: P012ConstructionPlan,
): CapabilityAcquisitionRoute {
  const plan = normalizePlan(rawPlan);

  return {
    id: P012_CONSTRUCTION_ROUTE_ID,

    async discover(
      context: CapabilityAcquisitionRouteContext,
    ): Promise<CapabilityAcquisitionCandidate[]> {
      if (context.initialResolution.kind !== "construct" || !rawPlan) return [];

      const observedAt = new Date().toISOString();
      if (!plan) {
        return [{
          id: `construction:invalid:${capabilityId(context.request.requirement)}`,
          routeId: P012_CONSTRUCTION_ROUTE_ID,
          mode: "construct",
          description: "A construction plan was supplied but failed structural validation.",
          provenance: {
            source: "p017-construction-request",
            reference: "invalid-plan",
            observedAt,
          },
          assessment: {
            disposition: "unknown",
            authority: "p017-structural-validation",
            evidence: ["Construction plan is not structurally valid; no source mutation was attempted."],
            reason: "Construction requires a non-empty description and at least one {path, content} edit.",
            estimatedCostCents: null,
          },
        }];
      }

      const digest = planHash(plan);
      return [{
        id: `construction:${digest}`,
        routeId: P012_CONSTRUCTION_ROUTE_ID,
        mode: "construct",
        description:
          `Construct ${context.request.requirement} through P-012 transactional self-modification, then require reload/runtime probe before readiness.`,
        provenance: {
          source: "p017-agent-construction-plan",
          reference: `sha256:${digest}`,
          integrity: digest,
          observedAt,
        },
        assessment: {
          disposition: "allow",
          authority: "p012-transactional-self-mod",
          evidence: [
            "Construction is delegated to the existing protected edit_own_file tool; P-017 does not write active source directly.",
            "P-012 verification proves transaction/build gates only; runtime capability readiness remains unverified afterwards.",
          ],
          reason:
            "The candidate is locally constructed source, not an externally acquired package. Its actual mutation still requires the inner dangerous tool's Policy/P-012 gates.",
          // Self-mod can consume compute and an exact monetary estimate is not
          // asserted here. A caller-supplied maxCostCents therefore fails closed.
          estimatedCostCents: null,
        },
        metadata: {
          planHash: digest,
        },
      }];
    },

    async execute(
      candidate: CapabilityAcquisitionCandidate,
      context: CapabilityAcquisitionRouteContext,
    ): Promise<CapabilityRouteResult> {
      if (!plan) {
        return {
          state: "rejected",
          evidence: ["Construction plan failed structural validation."],
          reason: "P-012 construction was not executed.",
        };
      }

      const invokeProtected = currentProtectedToolInvoker();
      if (!invokeProtected) {
        return {
          state: "unavailable",
          evidence: ["No protected nested-tool invoker is available in this executor."],
          reason:
            "P-017 refused to call source mutation directly because construction must pass the P-012/Policy authority boundary.",
        };
      }

      const result = await invokeProtected("edit_own_file", {
        edits: plan.edits,
        description: plan.description,
      });
      if (result.error) return resultFailure(result.error);

      const normalizedResult = result.result.toLowerCase();
      if (normalizedResult.includes("recovery_required")) {
        return resultFailure(result.result);
      }
      if (
        normalizedResult.startsWith("blocked:") ||
        normalizedResult.includes("transactional source edit failed") ||
        normalizedResult.includes(" failed:")
      ) {
        return {
          state: "rejected",
          evidence: ["P-012 returned a non-success construction outcome."],
          reason: result.result,
        };
      }

      const contract = plan.contract ?? {};
      const acquired: CapabilityDescriptor = {
        id: capabilityId(context.request.requirement),
        type: "custom",
        provider: "p012-self-mod",
        description:
          contract.description || `Constructed source candidate for ${context.request.requirement}`,
        requirements: [],
        provides: [context.request.requirement],
        permissions: normalizedStrings(contract.permissions),
        inputs: normalizedStrings(contract.inputs),
        outputs: normalizedStrings(contract.outputs),
        effects: normalizedStrings(contract.effects),
        dependencies: normalizedStrings(contract.dependencies),
        compatibility: normalizedStrings(contract.compatibility),
        available: false,
        state: "acquired",
        observedAt: new Date().toISOString(),
        authority: "p012-transactional-self-mod",
        evidence: [
          "P-012 transactional source construction completed without executor error.",
          "Current process/runtime functionality has not yet been reloaded and functionally probed.",
        ],
        metadata: {
          constructionPlanHash: candidate.provenance.integrity ?? planHash(plan),
          reloadRequired: true,
        },
      };

      return {
        state: "acquired",
        capabilities: [acquired],
        evidence: [
          "P-012 accepted/activated the construction transaction.",
          "The resulting capability is registered only as ACQUIRED; reload plus functional probe are still required for VERIFIED_AVAILABLE.",
        ],
        reason:
          "Construction completed through P-012. P-017 intentionally stops short of VERIFIED until the new runtime is loaded and the requested contract is probed.",
      };
    },
  };
}
