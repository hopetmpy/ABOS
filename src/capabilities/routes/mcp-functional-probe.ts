import { currentProtectedToolInvoker } from "../../agent/protected-tool-invoker.js";
import { capabilityStateOf } from "../model.js";
import type {
  CapabilityAcquisitionCandidate,
  CapabilityAcquisitionRoute,
  CapabilityAcquisitionRouteContext,
  CapabilityRouteResult,
} from "../acquisition.js";

export const MCP_FUNCTIONAL_PROBE_ROUTE_ID = "mcp-functional-probe";

export interface McpFunctionalProbeRouteOptions {
  /**
   * Arguments for the real MCP operation that is expected to satisfy the
   * capability request. There is deliberately no synthetic no-op probe:
   * arbitrary MCP tools may have side effects, so the exact inner tool call is
   * re-evaluated by Policy before execution.
   */
  probeArguments?: Record<string, unknown>;
}

function projectedToolName(candidate: CapabilityAcquisitionCandidate): string | null {
  const raw = candidate.metadata?.toolName;
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

function classifyProtectedFailure(error: string): CapabilityRouteResult {
  const normalized = error.toLowerCase();
  if (normalized.includes("policy authorization required")) {
    return {
      state: "unauthorized",
      evidence: ["The canonical protected executor required explicit Policy authorization for the MCP operation."],
      reason: error,
    };
  }
  if (normalized.includes("policy denied")) {
    return {
      state: "prohibited",
      evidence: ["The canonical protected executor denied the MCP operation before execution."],
      reason: error,
    };
  }
  if (
    normalized.includes("external effect may already have occurred") ||
    normalized.includes("outcome unknown") ||
    normalized.includes("settlement is unknown")
  ) {
    return {
      state: "unknown",
      evidence: ["The protected executor reported an uncertain external effect; P-017 will not retry this candidate blindly."],
      reason: error,
    };
  }
  if (normalized.includes("unknown tool")) {
    return {
      state: "unavailable",
      evidence: ["The P-015 projected MCP tool is not present in the current protected runtime tool surface."],
      reason: error,
    };
  }
  return {
    state: "degraded",
    evidence: ["The protected MCP operation failed; P-015 remains responsible for recording current runtime truth."],
    reason: error,
  };
}

/**
 * Reuse a P-015-discovered MCP tool as a real functional probe/use route.
 *
 * This route is intentionally narrow:
 * - it only considers provider=mcp tool capabilities already in P-014;
 * - only `probed` candidates are eligible, avoiding blind retry of a degraded
 *   prior call whose side effects may be uncertain;
 * - it never invokes AbosTool.execute directly;
 * - the current protected invoker re-enters the specific MCP tool's Policy;
 * - P-015 owns the call and readiness evidence; P-014 owns final readiness.
 */
export function createMcpFunctionalProbeRoute(
  options: McpFunctionalProbeRouteOptions = {},
): CapabilityAcquisitionRoute {
  return {
    id: MCP_FUNCTIONAL_PROBE_ROUTE_ID,

    async discover(
      context: CapabilityAcquisitionRouteContext,
    ): Promise<CapabilityAcquisitionCandidate[]> {
      const observedAt = new Date().toISOString();
      return context.initialResolution.candidates
        .filter((capability) =>
          capability.type === "tool" &&
          capability.provider === "mcp" &&
          capabilityStateOf(capability) === "probed"
        )
        .map((capability) => {
          const toolName = (capability.provides ?? capability.requirements)
            .map((value) => value.trim())
            .find(Boolean) ?? "";
          const evidence = (capability.evidence ?? [])
            .map((value) => value.trim())
            .filter(Boolean);
          const authority = capability.authority?.trim() ?? "";
          const inventoryId = typeof capability.metadata?.inventoryId === "string"
            ? capability.metadata.inventoryId
            : null;
          const contractHash = typeof capability.metadata?.remoteToolContractHash === "string"
            ? capability.metadata.remoteToolContractHash
            : null;
          const assessmentReady =
            Boolean(toolName) &&
            Boolean(authority) &&
            evidence.length > 0 &&
            Boolean(inventoryId) &&
            Boolean(contractHash);

          return {
            id: capability.id,
            routeId: MCP_FUNCTIONAL_PROBE_ROUTE_ID,
            mode: "probe" as const,
            description: assessmentReady
              ? `Use the P-015 MCP projection ${toolName} as the real functional probe for ${context.request.requirement}.`
              : `P-015 MCP candidate ${capability.id} lacks evidence needed for a protected functional probe.`,
            provenance: {
              source: "p015-mcp-runtime",
              reference: inventoryId
                ? `mcp-inventory:${inventoryId}`
                : `capability:${capability.id}`,
              integrity: contractHash,
              observedAt,
            },
            assessment: {
              disposition: assessmentReady ? "allow" as const : "unknown" as const,
              authority: authority || "p015-mcp-runtime:missing-authority",
              evidence: evidence.length > 0
                ? evidence
                : ["P-014 candidate has no supporting P-015 runtime evidence; functional probing is fail-closed."],
              reason: assessmentReady
                ? "P-015 already completed protocol discovery for this configured MCP tool; the exact operation must still pass its own protected Policy execution."
                : "Candidate is missing tool projection, inventory provenance, contract fingerprint, authority, or runtime evidence.",
              estimatedCostCents: capability.estimatedCostCents ?? null,
            },
            metadata: {
              capabilityId: capability.id,
              toolName,
              sourceObservedAt: capability.observedAt ?? null,
            },
          };
        });
    },

    async execute(
      candidate: CapabilityAcquisitionCandidate,
    ): Promise<CapabilityRouteResult> {
      const toolName = projectedToolName(candidate);
      if (!toolName) {
        return {
          state: "rejected",
          evidence: ["The candidate did not identify a P-015 projected tool name."],
          reason: "P-015 MCP candidate cannot be executed without its projected tool identity.",
        };
      }

      if (!options.probeArguments) {
        return {
          state: "unknown",
          evidence: ["No operation arguments were supplied, so P-017 refused to invent a potentially side-effecting MCP probe."],
          reason:
            `Functional probe/use is required for ${toolName}. Supply explicit probeArguments for the real intended operation; P-017 will route it through the tool's own Policy boundary.`,
        };
      }

      const invokeProtected = currentProtectedToolInvoker();
      if (!invokeProtected) {
        return {
          state: "unavailable",
          evidence: ["No request-scoped protected nested-tool invoker is available in this executor."],
          reason:
            "P-017 refused to call the MCP tool directly because that would bypass the candidate tool's Policy boundary.",
        };
      }

      const result = await invokeProtected(toolName, options.probeArguments);
      if (result.error) return classifyProtectedFailure(result.error);

      return {
        state: "verified_available",
        evidence: [
          `Protected execution of ${toolName} completed without an executor error; P-015 must still have persisted runtime verification and P-014 re-resolution remains the final gate.`,
        ],
        reason:
          "The real MCP operation completed through the canonical protected executor. P-017 does not promote from this label; the coordinator will re-resolve against P-014.",
      };
    },
  };
}
