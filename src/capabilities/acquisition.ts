import type {
  CapabilityDescriptor,
  CapabilityRequest,
  CapabilityResolution,
} from "./model.js";
import { CapabilityResolver } from "./resolver.js";
import type { CapabilityRegistry } from "./registry.js";
import type { EnvironmentSnapshot } from "../environments/types.js";

export type CapabilityAcquisitionMode =
  | "probe"
  | "acquire"
  | "compose"
  | "construct";

export type CapabilityCandidateDisposition =
  | "allow"
  | "deny"
  | "unknown";

export interface CapabilityCandidateAssessment {
  disposition: CapabilityCandidateDisposition;
  authority: string;
  evidence: string[];
  reason: string;
  /** Optional economic estimate. Unknown cost must remain null/omitted. */
  estimatedCostCents?: number | null;
}

export interface CapabilityCandidateProvenance {
  source: string;
  reference: string;
  /** Optional integrity/version identity supplied by the route authority. */
  integrity?: string | null;
  observedAt: string;
}

export interface CapabilityAcquisitionCandidate {
  id: string;
  routeId: string;
  mode: CapabilityAcquisitionMode;
  description: string;
  provenance: CapabilityCandidateProvenance;
  assessment: CapabilityCandidateAssessment;
  metadata?: Record<string, unknown>;
}

export type CapabilityRouteResultState =
  | "acquired"
  | "probed"
  | "verified_available"
  | "degraded"
  | "unavailable"
  | "unauthorized"
  | "prohibited"
  | "unknown"
  | "rejected";

export interface CapabilityRouteResult {
  state: CapabilityRouteResultState;
  evidence: string[];
  /**
   * Descriptors are observations produced by the route authority. The
   * coordinator never trusts this return value as success by itself: every
   * descriptor is normalized by CapabilityRegistry and the original request is
   * re-resolved afterwards.
   */
  capabilities?: CapabilityDescriptor[];
  reason: string;
}

export interface CapabilityAcquisitionRouteContext {
  request: CapabilityRequest;
  initialResolution: CapabilityResolution;
  environments: EnvironmentSnapshot[];
  signal?: AbortSignal;
}

export interface CapabilityAcquisitionRoute {
  id: string;
  discover(
    context: CapabilityAcquisitionRouteContext,
  ): Promise<CapabilityAcquisitionCandidate[]>;
  execute(
    candidate: CapabilityAcquisitionCandidate,
    context: CapabilityAcquisitionRouteContext,
  ): Promise<CapabilityRouteResult>;
}

export type CapabilityAcquisitionEventStage =
  | "started"
  | "discovery_failed"
  | "candidate_discovered"
  | "candidate_rejected"
  | "route_completed"
  | "route_failed"
  | "completed";

export interface CapabilityAcquisitionEvent {
  stage: CapabilityAcquisitionEventStage;
  requirement: string;
  routeId?: string;
  candidateId?: string;
  status?: CapabilityAcquisitionStatus | CapabilityRouteResultState;
  reason: string;
  evidence?: string[];
}

export interface CapabilityAcquisitionEvidenceSink {
  record(event: CapabilityAcquisitionEvent): void | Promise<void>;
}

export interface CapabilityAcquisitionAttempt {
  routeId: string;
  candidateId?: string;
  outcome:
    | CapabilityRouteResultState
    | "discovery_failed"
    | "candidate_rejected";
  reason: string;
  evidence: string[];
}

export type CapabilityAcquisitionStatus =
  | "use_existing"
  | "change_environment"
  | "verified"
  | "degraded"
  | "unavailable"
  | "unauthorized"
  | "prohibited"
  | "no_discovered"
  | "unknown";

export interface CapabilityAcquisitionOutcome {
  status: CapabilityAcquisitionStatus;
  request: CapabilityRequest;
  initialResolution: CapabilityResolution;
  finalResolution: CapabilityResolution;
  attempts: CapabilityAcquisitionAttempt[];
  reason: string;
}

function nonEmpty(values: readonly string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
}

function validTimestamp(value: string): boolean {
  return value.trim().length > 0 && Number.isFinite(Date.parse(value));
}

function candidateAssessmentFailure(
  candidate: CapabilityAcquisitionCandidate,
  request: CapabilityRequest,
): { status: CapabilityAcquisitionStatus; reason: string } | null {
  const assessment = candidate.assessment;
  const evidence = nonEmpty(assessment.evidence);
  const authority = assessment.authority.trim();
  const reason = assessment.reason.trim();
  const provenanceSource = candidate.provenance.source.trim();
  const provenanceReference = candidate.provenance.reference.trim();

  if (
    !candidate.id.trim() ||
    !candidate.routeId.trim() ||
    !candidate.description.trim() ||
    !authority ||
    !reason ||
    evidence.length === 0 ||
    !provenanceSource ||
    !provenanceReference ||
    !validTimestamp(candidate.provenance.observedAt)
  ) {
    return {
      status: "unknown",
      reason:
        "Candidate provenance/assessment is incomplete; acquisition is fail-closed.",
    };
  }

  if (assessment.disposition === "deny") {
    return {
      status: "prohibited",
      reason,
    };
  }
  if (assessment.disposition === "unknown") {
    return {
      status: "unknown",
      reason,
    };
  }

  if (request.maxCostCents != null) {
    if (
      typeof assessment.estimatedCostCents !== "number" ||
      !Number.isFinite(assessment.estimatedCostCents)
    ) {
      return {
        status: "unknown",
        reason:
          "Candidate cost is unknown, so the requested cost ceiling cannot be proven.",
      };
    }
    if (assessment.estimatedCostCents > request.maxCostCents) {
      return {
        status: "prohibited",
        reason:
          `Candidate estimated cost ${assessment.estimatedCostCents} exceeds request ceiling ${request.maxCostCents}.`,
      };
    }
  }

  return null;
}

function routeStateToStatus(
  state: CapabilityRouteResultState,
): CapabilityAcquisitionStatus {
  switch (state) {
    case "verified_available":
      // A route claim is not enough to return VERIFIED. The caller must re-resolve.
      return "unknown";
    case "degraded":
      return "degraded";
    case "unavailable":
    case "rejected":
      return "unavailable";
    case "unauthorized":
      return "unauthorized";
    case "prohibited":
      return "prohibited";
    case "acquired":
    case "probed":
    case "unknown":
      return "unknown";
  }
}

function aggregateTerminalStatus(
  attempts: readonly CapabilityAcquisitionAttempt[],
): CapabilityAcquisitionStatus {
  const routeStates = attempts
    .map((attempt) => attempt.outcome)
    .filter((outcome): outcome is CapabilityRouteResultState =>
      outcome !== "discovery_failed" && outcome !== "candidate_rejected"
    );

  if (routeStates.length === 0) {
    const rejected = attempts.filter((attempt) => attempt.outcome === "candidate_rejected");
    if (rejected.length === 0) return "no_discovered";
    return rejected.every((attempt) => attempt.reason.startsWith("PROHIBITED:"))
      ? "prohibited"
      : "unknown";
  }

  if (routeStates.every((state) => state === "prohibited")) return "prohibited";
  if (routeStates.every((state) => state === "unauthorized")) return "unauthorized";
  if (routeStates.some((state) => state === "unknown")) return "unknown";
  if (routeStates.some((state) => state === "degraded")) return "degraded";
  if (routeStates.every((state) => state === "unavailable" || state === "rejected")) {
    return "unavailable";
  }
  return "unknown";
}

export class CapabilityAcquisitionCoordinator {
  private readonly routes = new Map<string, CapabilityAcquisitionRoute>();

  constructor(
    private readonly registry: CapabilityRegistry,
    routes: readonly CapabilityAcquisitionRoute[] = [],
    private readonly evidenceSink?: CapabilityAcquisitionEvidenceSink,
  ) {
    for (const route of routes) this.registerRoute(route);
  }

  registerRoute(route: CapabilityAcquisitionRoute): void {
    const id = route.id.trim();
    if (!id) throw new Error("Capability acquisition route id cannot be empty");
    if (this.routes.has(id)) {
      throw new Error(`Capability acquisition route already registered: ${id}`);
    }
    this.routes.set(id, route);
  }

  listRouteIds(): string[] {
    return [...this.routes.keys()];
  }

  private async emit(event: CapabilityAcquisitionEvent): Promise<void> {
    await this.evidenceSink?.record(event);
  }

  private resolve(
    request: CapabilityRequest,
    environments: EnvironmentSnapshot[],
  ): CapabilityResolution {
    return new CapabilityResolver(this.registry).resolve(request, environments);
  }

  async remediate(
    request: CapabilityRequest,
    environments: EnvironmentSnapshot[] = [],
    options: { signal?: AbortSignal } = {},
  ): Promise<CapabilityAcquisitionOutcome> {
    const normalizedRequest: CapabilityRequest = {
      ...request,
      requirement: request.requirement.trim(),
    };
    if (!normalizedRequest.requirement) {
      throw new Error("Capability acquisition requirement cannot be empty");
    }

    const initialResolution = this.resolve(normalizedRequest, environments);
    const attempts: CapabilityAcquisitionAttempt[] = [];

    await this.emit({
      stage: "started",
      requirement: normalizedRequest.requirement,
      reason: `Initial resolution: ${initialResolution.kind}`,
    });

    if (initialResolution.kind === "use_existing") {
      const outcome: CapabilityAcquisitionOutcome = {
        status: "use_existing",
        request: normalizedRequest,
        initialResolution,
        finalResolution: initialResolution,
        attempts,
        reason: "A current VERIFIED_AVAILABLE capability already satisfies the request.",
      };
      await this.emit({
        stage: "completed",
        requirement: normalizedRequest.requirement,
        status: outcome.status,
        reason: outcome.reason,
      });
      return outcome;
    }

    if (initialResolution.kind === "change_environment") {
      const outcome: CapabilityAcquisitionOutcome = {
        status: "change_environment",
        request: normalizedRequest,
        initialResolution,
        finalResolution: initialResolution,
        attempts,
        reason:
          "A verified capability exists in another environment; acquisition must not silently switch environment.",
      };
      await this.emit({
        stage: "completed",
        requirement: normalizedRequest.requirement,
        status: outcome.status,
        reason: outcome.reason,
      });
      return outcome;
    }

    const routeContext: CapabilityAcquisitionRouteContext = {
      request: normalizedRequest,
      initialResolution,
      environments,
      ...(options.signal ? { signal: options.signal } : {}),
    };

    const discovered: CapabilityAcquisitionCandidate[] = [];
    for (const route of this.routes.values()) {
      if (options.signal?.aborted) break;
      try {
        const candidates = await route.discover(routeContext);
        for (const candidate of candidates) {
          if (candidate.routeId !== route.id) {
            attempts.push({
              routeId: route.id,
              candidateId: candidate.id,
              outcome: "candidate_rejected",
              reason: "UNKNOWN: route returned a candidate owned by a different route id.",
              evidence: [],
            });
            continue;
          }
          discovered.push(candidate);
          await this.emit({
            stage: "candidate_discovered",
            requirement: normalizedRequest.requirement,
            routeId: route.id,
            candidateId: candidate.id,
            reason: candidate.description,
            evidence: candidate.assessment.evidence,
          });
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        attempts.push({
          routeId: route.id,
          outcome: "discovery_failed",
          reason,
          evidence: [],
        });
        await this.emit({
          stage: "discovery_failed",
          requirement: normalizedRequest.requirement,
          routeId: route.id,
          reason,
        });
      }
    }

    if (discovered.length === 0) {
      const finalResolution = this.resolve(normalizedRequest, environments);
      const status = attempts.length === 0 ? "no_discovered" : "unknown";
      const reason = attempts.length === 0
        ? "No registered acquisition route discovered a candidate. This is NO_DISCOVERED, not IMPOSSIBLE."
        : "No candidate was discovered and at least one discovery route failed; outcome remains UNKNOWN.";
      const outcome: CapabilityAcquisitionOutcome = {
        status,
        request: normalizedRequest,
        initialResolution,
        finalResolution,
        attempts,
        reason,
      };
      await this.emit({
        stage: "completed",
        requirement: normalizedRequest.requirement,
        status,
        reason,
      });
      return outcome;
    }

    const seen = new Set<string>();
    for (const candidate of discovered) {
      if (options.signal?.aborted) break;
      const route = this.routes.get(candidate.routeId);
      if (!route) continue;
      const identity = `${candidate.routeId}:${candidate.id}`;
      if (seen.has(identity)) continue;
      seen.add(identity);

      const assessmentFailure = candidateAssessmentFailure(candidate, normalizedRequest);
      if (assessmentFailure) {
        const prefix = assessmentFailure.status === "prohibited" ? "PROHIBITED: " : "UNKNOWN: ";
        attempts.push({
          routeId: candidate.routeId,
          candidateId: candidate.id,
          outcome: "candidate_rejected",
          reason: `${prefix}${assessmentFailure.reason}`,
          evidence: nonEmpty(candidate.assessment.evidence),
        });
        await this.emit({
          stage: "candidate_rejected",
          requirement: normalizedRequest.requirement,
          routeId: candidate.routeId,
          candidateId: candidate.id,
          status: assessmentFailure.status,
          reason: assessmentFailure.reason,
          evidence: candidate.assessment.evidence,
        });
        continue;
      }

      try {
        const result = await route.execute(candidate, routeContext);
        const evidence = nonEmpty(result.evidence);
        attempts.push({
          routeId: candidate.routeId,
          candidateId: candidate.id,
          outcome: result.state,
          reason: result.reason,
          evidence,
        });

        for (const capability of result.capabilities ?? []) {
          this.registry.register(capability);
        }

        await this.emit({
          stage: "route_completed",
          requirement: normalizedRequest.requirement,
          routeId: candidate.routeId,
          candidateId: candidate.id,
          status: result.state,
          reason: result.reason,
          evidence,
        });

        const reResolved = this.resolve(normalizedRequest, environments);
        if (reResolved.kind === "use_existing") {
          const outcome: CapabilityAcquisitionOutcome = {
            status: "verified",
            request: normalizedRequest,
            initialResolution,
            finalResolution: reResolved,
            attempts,
            reason:
              "The original request now resolves through the canonical CapabilityRegistry after the route completed.",
          };
          await this.emit({
            stage: "completed",
            requirement: normalizedRequest.requirement,
            routeId: candidate.routeId,
            candidateId: candidate.id,
            status: outcome.status,
            reason: outcome.reason,
          });
          return outcome;
        }
        if (reResolved.kind === "change_environment") {
          const outcome: CapabilityAcquisitionOutcome = {
            status: "change_environment",
            request: normalizedRequest,
            initialResolution,
            finalResolution: reResolved,
            attempts,
            reason:
              "The route produced a verified capability in another environment; explicit environment selection is still required.",
          };
          await this.emit({
            stage: "completed",
            requirement: normalizedRequest.requirement,
            routeId: candidate.routeId,
            candidateId: candidate.id,
            status: outcome.status,
            reason: outcome.reason,
          });
          return outcome;
        }

        // Route success labels never override canonical resolution. Continue only
        // to materially different candidates; the same candidate is never retried.
        void routeStateToStatus(result.state);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        attempts.push({
          routeId: candidate.routeId,
          candidateId: candidate.id,
          outcome: "unknown",
          reason,
          evidence: [],
        });
        await this.emit({
          stage: "route_failed",
          requirement: normalizedRequest.requirement,
          routeId: candidate.routeId,
          candidateId: candidate.id,
          status: "unknown",
          reason,
        });
      }
    }

    const finalResolution = this.resolve(normalizedRequest, environments);
    const status = aggregateTerminalStatus(attempts);
    const reason = options.signal?.aborted
      ? "Capability remediation was aborted; side-effect state may be incomplete and remains UNKNOWN unless canonical evidence proves otherwise."
      : "No attempted route made the original request execution-ready in the canonical CapabilityRegistry.";
    const outcome: CapabilityAcquisitionOutcome = {
      status,
      request: normalizedRequest,
      initialResolution,
      finalResolution,
      attempts,
      reason,
    };
    await this.emit({
      stage: "completed",
      requirement: normalizedRequest.requirement,
      status,
      reason,
    });
    return outcome;
  }
}
