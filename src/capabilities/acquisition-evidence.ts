import type Database from "better-sqlite3";
import { ulid } from "ulid";
import {
  appendEvidenceEvent,
  correlationIdFor,
  currentEvidenceContext,
} from "../observability/evidence.js";
import type {
  CapabilityAcquisitionEvent,
  CapabilityAcquisitionEvidenceSink,
} from "./acquisition.js";

class AcquisitionEvidenceAfterEffectUnknownError extends Error {
  readonly externalEffectOutcomeUnknown = true;

  constructor(message: string) {
    super(message);
    this.name = "AcquisitionEvidenceAfterEffectUnknownError";
  }
}

function stageMayFollowEffect(stage: CapabilityAcquisitionEvent["stage"]): boolean {
  return stage === "route_completed" || stage === "route_failed" || stage === "completed";
}

/**
 * P-013 adapter for P-017. Evidence remains correlation/audit fabric only; it
 * never decides capability readiness. The CapabilityRegistry remains the
 * authority for that claim.
 *
 * A persistence failure before any route effect fails closed normally. A
 * persistence failure after a route may have executed is tagged as external
 * outcome uncertainty so the canonical protected tool executor will not invite
 * a blind retry.
 */
export function createCapabilityAcquisitionEvidenceSink(
  db: Database.Database,
  attemptId = ulid(),
): CapabilityAcquisitionEvidenceSink {
  const inherited = currentEvidenceContext();
  const correlationId =
    inherited?.correlationId ?? correlationIdFor("capability_acquisition", attemptId);
  let previousEventId: string | null = null;

  return {
    record(event: CapabilityAcquisitionEvent): void {
      try {
        const persisted = appendEvidenceEvent(db, {
          correlationId,
          causationId: previousEventId,
          eventType: `capability.acquisition.${event.stage}`,
          domain: "capability",
          authorityType: "capability_acquisition_attempt",
          authorityId: attemptId,
          goalId: inherited?.goalId ?? null,
          taskId: inherited?.taskId ?? null,
          turnId: inherited?.turnId ?? null,
          toolCallId: inherited?.toolCallId ?? null,
          epistemicStatus: "observation",
          payload: {
            requirement: event.requirement,
            routeId: event.routeId ?? null,
            candidateId: event.candidateId ?? null,
            status: event.status ?? null,
            reason: event.reason,
            evidence: event.evidence ?? [],
          },
          provenance: {
            source: "p017-capability-acquisition",
          },
        });
        previousEventId = persisted.id;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (stageMayFollowEffect(event.stage)) {
          throw new AcquisitionEvidenceAfterEffectUnknownError(
            `Capability acquisition evidence persistence failed after a route may have produced effects: ${message}`,
          );
        }
        throw error;
      }
    },
  };
}
