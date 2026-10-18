import { createHash } from "node:crypto";
import type { Database } from "better-sqlite3";
import type { EnvironmentRegistry } from "./registry.js";
import type { EnvironmentLifecycleManager } from "./lifecycle.js";
import type { EnvironmentResource } from "./types.js";
import { isExplicitInstant } from "./time-evidence.js";
import {
  getFinancialEffectByOperationKey,
  listFinancialEffectsByStates,
  listUnresolvedFinancialEffects,
} from "../economics/financial-effects.js";

/** Only a trusted host can supply this read-only, provider-authenticated receipt. */
export interface TrustedSupplierContractScope {
  provider: string;
  providerAccountId: string;
  resourceId: string;
  externalResourceId: string;
  operationKey: string;
  /** Exact P-030-bound contract for renew/cancel; legacy provision may be unknown. */
  contractId?: string | null;
}
export interface TrustedSupplierContractReceipt extends TrustedSupplierContractScope {
  source: string;
  observedAt: string;
  validUntil: string;
  evidence: string[];
  cancellation: "cancelled" | "active" | "unknown";
  autoRenewal: "disabled" | "enabled" | "unknown";
  finalInvoice: "finalized" | "outstanding" | "unknown";
}
export type TrustedSupplierContractObserver = (
  scope: Readonly<TrustedSupplierContractScope>,
) => Promise<TrustedSupplierContractReceipt | null>;

export interface EnvironmentRetentionSweepResult {
  evaluated: number;
  releaseEligible: number;
  destroyAttempts: number;
  released: number;
  pendingObservation: number;
  unavailable: number;
  artifactHolds: number;
  supplierObservations: number;
  evidence: string[];
}

interface RetentionDecision {
  release: boolean;
  reason: string;
}

/**
 * Provider-neutral automatic retention coordinator.
 *
 * Retention policy is data. This coordinator never branches on provider names.
 * It only releases resources when persisted Task/Goal state proves that the
 * resource's declared retention boundary has been reached.
 *
 * Destructive retries are observation-gated: after an uncertain destroy, ABOS
 * reconciles provider state first and will not repeat the same destructive path
 * against the same observed condition.
 */
export class EnvironmentRetentionCoordinator {
  constructor(
    private readonly db: Database,
    private readonly registry: EnvironmentRegistry,
    private readonly lifecycle: EnvironmentLifecycleManager,
    private readonly trustedSupplierObserver?: (provider: string) => TrustedSupplierContractObserver | null,
  ) {}

  /**
   * An explicit child-cleanup request can release exactly one manually
   * retained resource. Normal sweeps still respect every retention policy;
   * this is not a global/manual-retention auto-delete toggle.
   */
  async sweep(options: { explicitManualResourceId?: string } = {}): Promise<EnvironmentRetentionSweepResult> {
    if (options.explicitManualResourceId !== undefined &&
        (typeof options.explicitManualResourceId !== "string" ||
          !options.explicitManualResourceId.trim())) {
      throw new Error("Explicit manual retention release requires an exact P-018 resource ID.");
    }
    const result: EnvironmentRetentionSweepResult = {
      evaluated: 0,
      releaseEligible: 0,
      destroyAttempts: 0,
      released: 0,
      pendingObservation: 0,
      unavailable: 0,
      artifactHolds: 0,
      supplierObservations: 0,
      evidence: [],
    };

    const eligibleScope = this.lifecycle.resources.list().filter(resource =>
      options.explicitManualResourceId === undefined ||
      resource.id === options.explicitManualResourceId);
    for (const initial of eligibleScope) {
      result.evaluated += 1;
      const decision: RetentionDecision =
        initial.id === options.explicitManualResourceId &&
        initial.retentionPolicy === "manual_retention"
          ? { release: true, reason: "explicit child cleanup of one owned P-018 manual-retention resource" }
          : this.retentionDecision(initial);
      if (!decision.release) continue;
      result.releaseEligible += 1;

      // A paid resize/resume/recover can still be in flight, or its callback
      // may have been lost. Do not overlap a destructive release with this
      // unresolved provider mutation. This is a per-resource observation hold,
      // not a global ban on cleanup or an invented cancellation/refund.
      if (initial.metadata.mutationNeedsReconciliation === true) {
        result.pendingObservation += 1;
        result.evidence.push(
          `Resource ${initial.id} has an unresolved provider mutation; retention cannot assume its current size/state or dispatch concurrent destroy.`,
        );
        continue;
      }

      // P-018 recorded positive evidence that provider preflight rejected
      // provisioning BEFORE any external operation. The local resource has
      // nothing to destroy, and dispatching provider.destroy without an
      // external identity may be unsafe. This is not a generic rule for
      // failed/UNKNOWN resources: only this explicit durable proof qualifies.
      if (initial.status === "failed" &&
          initial.externalId === null &&
          initial.metadata.provisionExternalEffectNotDispatched === true &&
          initial.metadata.provisionNeedsReconciliation === false) {
        const released = this.lifecycle.resources.applyMutation(
          initial.id,
          {
            status: "terminated",
            metadata: {
              retentionReleaseState: "released",
              retentionReleaseReason: decision.reason,
              retentionReleasedAt: new Date().toISOString(),
            },
            evidence: [
              "Provider preflight confirmed no provisioning dispatched and no external resource identity exists; local failed resource retired without provider destroy.",
              "This local release is NOT supplier invoice settlement or proof of an account refund.",
            ],
          },
          "retention",
          "Resource rejected before any external provider dispatch; local retention completed.",
        );
        this.markLegacyExecutorReleased(released);
        result.released += 1;
        continue;
      }

      let resource = initial;
      // An uncertain provision may already have created a billable resource.
      // Observe its external identity before issuing destructive cleanup.
      if (resource.metadata.provisionNeedsReconciliation === true) {
        if (!this.registry.supportsOperation(resource.provider, "reconcile")) {
          result.pendingObservation += 1;
          result.evidence.push(
            `Resource ${resource.id} has UNKNOWN provision outcome and no provider reconciliation capability; cleanup must not guess.`,
          );
          continue;
        }
        resource = await this.lifecycle.reconcile(resource.id);
        if (resource.metadata.actualExists !== true || !resource.externalId ||
            resource.metadata.provisionNeedsReconciliation === true) {
          result.pendingObservation += 1;
          result.evidence.push(
            `Resource ${resource.id} provision outcome lacks verified external identity; no blind destroy was dispatched.`,
          );
          continue;
        }
      }

      if (hasPendingLocalArtifacts(resource)) {
        resource = await this.holdForArtifactCollection(
          resource,
          decision.reason,
          result,
        );
        result.artifactHolds += 1;
        continue;
      }
      // A process may crash after persisting destroy_requested but before
      // recording the provider callback or pending_observation. Both states
      // describe a possibly dispatched destructive action: reconcile first
      // and never blindly issue another destroy on startup.
      if (resource.metadata.retentionReleaseState === "pending_observation" ||
          resource.metadata.retentionReleaseState === "destroy_requested") {
        resource = await this.observeAfterUncertainDestroy(resource, result);
        if (resource.status === "terminated") {
          result.released += 1;
          continue;
        }

        const actualExists = resource.metadata.actualExists;
        if (actualExists !== true) {
          result.pendingObservation += 1;
          continue;
        }

        const currentFingerprint = resourceFingerprint(resource);
        const previousFingerprint =
          typeof resource.metadata.retentionDestroyFingerprint === "string"
            ? resource.metadata.retentionDestroyFingerprint
            : null;

        if (!previousFingerprint || currentFingerprint === previousFingerprint) {
          result.pendingObservation += 1;
          result.evidence.push(
            `Retention release for resource ${resource.id} remains pending: the prior destroy fingerprint is ${previousFingerprint ? "unchanged" : "missing"} after provider observation. ABOS will not blindly repeat a possibly dispatched destructive attempt.`,
          );
          continue;
        }
      }

      if (!this.registry.supportsOperation(resource.provider, "destroy")) {
        result.unavailable += 1;
        if (resource.metadata.retentionReleaseState !== "destroy_unavailable") {
          this.lifecycle.resources.applyMutation(
            resource.id,
            {
              evidence: [
                `Retention boundary reached (${decision.reason}), but provider "${resource.provider}" does not currently expose destroy. This is unavailable lifecycle capability, not proof of objective impossibility.`,
              ],
              metadata: {
                retentionReleaseState: "destroy_unavailable",
                retentionReleaseReason: decision.reason,
              },
            },
            "retention",
            "Automatic retention release cannot currently invoke provider destruction.",
          );
        }
        continue;
      }

      const fingerprint = resourceFingerprint(resource);
      this.lifecycle.resources.applyMutation(
        resource.id,
        {
          metadata: {
            retentionReleaseState: "destroy_requested",
            retentionReleaseReason: decision.reason,
            retentionDestroyFingerprint: fingerprint,
            retentionDestroyRequestedAt: new Date().toISOString(),
            retentionDestroyAttempts:
              numberValue(resource.metadata.retentionDestroyAttempts) + 1,
          },
          evidence: [
            `Retention boundary reached: ${decision.reason}. Provider-neutral destroy requested.`,
          ],
        },
        "retention",
        "Automatic retention boundary reached.",
      );

      result.destroyAttempts += 1;
      const after = await this.lifecycle.destroy(resource.id);

      if (after.status === "terminated") {
        const released = this.lifecycle.resources.applyMutation(
          after.id,
          {
            metadata: {
              retentionReleaseState: "released",
              retentionReleasedAt: new Date().toISOString(),
            },
            evidence: [
              "Automatic retention release completed and provider resource is terminated.",
            ],
          },
          "retention",
          "Automatic retention release completed.",
        );
        this.markLegacyExecutorReleased(released);
        result.released += 1;
        continue;
      }

      this.lifecycle.resources.applyMutation(
        after.id,
        {
          metadata: {
            retentionReleaseState: "pending_observation",
            retentionDestroyFingerprint: fingerprint,
          },
          evidence: [
            "Destroy did not produce verified termination. Future retention sweeps must observe/reconcile provider state before any new destructive attempt.",
          ],
        },
        "retention",
        "Automatic retention release requires provider observation.",
      );
      result.pendingObservation += 1;
    }

    // Physical resources are excluded from normal destruction once terminated.
    // Their supplier obligations are independent: observe those separately.
    await this.observeRetiredSupplierContracts(result);
    return result;
  }

  private async observeRetiredSupplierContracts(result: EnvironmentRetentionSweepResult): Promise<void> {
    if (!this.trustedSupplierObserver) return;
    const now = Date.now();
    for (const resource of this.lifecycle.resources.list({ includeTerminated: true })) {
      if (resource.status !== "terminated" ||
          resource.metadata.retentionReleaseState !== "released" ||
          !resource.externalId) continue;
      // Financial contract actions may be authorized AFTER a resource was
      // physically retired (by a successor Task). The earlier retention
      // snapshot cannot know about such later P-030 claims. Merge only
      // canonical, actually dispatched contract intents; never synthesize a
      // provider cancellation or mark an invoice paid.
      const savedQuotes = Array.isArray(resource.metadata.retentionBillingLifecycleQuotes)
        ? resource.metadata.retentionBillingLifecycleQuotes : [];
      const recordedKeys = new Set(savedQuotes
        .filter(item => item && typeof item === "object" && typeof item.operationKey === "string")
        .map(item => item.operationKey));
      const contractActions = listFinancialEffectsByStates(this.db, [
        "dispatching", "pending", "unknown", "reconciliation_required", "completed",
      ]).filter(effect =>
        effect.effectKind === "provider_resource_procurement" &&
        effect.provider === resource.provider &&
        effect.request.resourceId === resource.id &&
        effect.request.externalId === resource.externalId &&
        (effect.request.operation === "renew" || effect.request.operation === "cancel") &&
        typeof effect.request.contractId === "string" &&
        effect.request.contractId.trim() &&
        !recordedKeys.has(effect.operationKey),
      ).map(effect => ({
        operationKey: effect.operationKey,
        contractId: effect.request.contractId as string,
        financialEffectState: effect.state,
        renewalQuoted: "unknown",
        additionalCommittedRenewalCents: null,
        additionalExitChargeCents: null,
        cancellationRouteDocumented: false,
        supplierCancellationStatus: "UNKNOWN",
      }));
      let quotes = savedQuotes;
      if (contractActions.length > 0) {
        const registered = this.lifecycle.resources.applyMutation(resource.id, {
          metadata: {
            retentionBillingLifecycleQuotes: [...savedQuotes, ...contractActions],
            retentionBillingReconciliation: "unverified_after_resource_release",
          },
          evidence: [
            "P-031 appended source-authenticated P-030 contract operation intent(s) after physical release. Supplier execution and billing settlement remain independently UNKNOWN.",
          ],
        }, "retention_supplier_contract_intent",
        "New canonical P-030 contract operations require post-retirement supplier observation.");
        quotes = registered.metadata.retentionBillingLifecycleQuotes as typeof savedQuotes;
      }
      if (quotes.length === 0) continue;
      let observer: TrustedSupplierContractObserver | null;
      try { observer = this.trustedSupplierObserver(resource.provider); }
      catch {
        result.evidence.push("Trusted supplier observer factory unavailable; physical cleanup remains independent.");
        continue;
      }
      if (!observer) continue;
      for (const item of quotes) {
        if (!item || typeof item !== "object" || Array.isArray(item) ||
            typeof item.operationKey !== "string") continue;
        const until = isExplicitInstant(item.supplierStatusValidUntil)
          ? Date.parse(item.supplierStatusValidUntil) : NaN;
        if (Number.isFinite(until) && until > now) continue;
        const effect = getFinancialEffectByOperationKey(this.db, item.operationKey);
        if (!effect || effect.effectKind !== "provider_resource_procurement" ||
            effect.provider !== resource.provider ||
            effect.request.resourceId !== resource.id ||
            !["dispatching", "pending", "unknown", "reconciliation_required", "completed"]
              .includes(effect.state)) continue;
        const account = effect.request.providerAccountId;
        if (typeof account !== "string" || !account.trim()) continue;
        const scope: TrustedSupplierContractScope = {
          provider: resource.provider,
          providerAccountId: account,
          resourceId: resource.id,
          externalResourceId: resource.externalId,
          operationKey: effect.operationKey,
          ...(typeof item.contractId === "string" && item.contractId.trim()
            ? { contractId: item.contractId } : {}),
        };
        let receipt: TrustedSupplierContractReceipt | null;
        try { receipt = await observer(scope); }
        catch {
          result.evidence.push("Trusted supplier contract read unavailable; prior evidence preserved.");
          continue;
        }
        if (!receipt) continue;
        const observedAt = isExplicitInstant(receipt.observedAt)
          ? Date.parse(receipt.observedAt) : NaN;
        const validUntil = isExplicitInstant(receipt.validUntil)
          ? Date.parse(receipt.validUntil) : NaN;
        const receivedAt = Date.now();
        const match = receipt.provider === scope.provider &&
          receipt.providerAccountId === scope.providerAccountId &&
          receipt.resourceId === scope.resourceId &&
          receipt.externalResourceId === scope.externalResourceId &&
          receipt.operationKey === scope.operationKey &&
          (scope.contractId == null || receipt.contractId === scope.contractId);
        const states = ["cancelled", "active", "unknown"].includes(receipt.cancellation) &&
          ["disabled", "enabled", "unknown"].includes(receipt.autoRenewal) &&
          ["finalized", "outstanding", "unknown"].includes(receipt.finalInvoice);
        if (!match || !states || typeof receipt.source !== "string" ||
            !receipt.source.trim() || !Array.isArray(receipt.evidence) ||
            !receipt.evidence.some(e => typeof e === "string" && e.trim()) ||
            !isExplicitInstant(receipt.observedAt) || !isExplicitInstant(receipt.validUntil) ||
            !Number.isFinite(observedAt) || !Number.isFinite(validUntil) ||
            observedAt > receivedAt || validUntil <= receivedAt || validUntil <= observedAt) {
          result.evidence.push("Supplier receipt scope, status or provenance invalid; no financial change.");
          continue;
        }
        // Async provider reads never overwrite a newer observation or changed owner.
        const current = this.lifecycle.resources.get(resource.id);
        const oldQuotes = current?.metadata.retentionBillingLifecycleQuotes;
        if (!current || current.status !== "terminated" ||
            current.metadata.retentionReleaseState !== "released" ||
            current.externalId !== scope.externalResourceId ||
            !Array.isArray(oldQuotes)) continue;
        const prior = oldQuotes.find(x => x && typeof x === "object" &&
          x.operationKey === scope.operationKey);
        if (!prior) continue;
        const previousAt = isExplicitInstant(prior.supplierStatusObservedAt)
          ? Date.parse(prior.supplierStatusObservedAt) : NaN;
        if (Number.isFinite(previousAt) && previousAt >= observedAt) continue;
        const updated = oldQuotes.map(x => x && typeof x === "object" &&
          x.operationKey === scope.operationKey
          ? {
              ...x,
              supplierCancellationStatus: receipt.cancellation,
              supplierAutoRenewalStatus: receipt.autoRenewal,
              supplierFinalInvoiceStatus: receipt.finalInvoice,
              supplierStatusSource: receipt.source,
              supplierStatusObservedAt: receipt.observedAt,
              supplierStatusValidUntil: receipt.validUntil,
            } : x);
        this.lifecycle.resources.applyMutation(current.id, {
          metadata: {
            retentionBillingLifecycleQuotes: updated,
            retentionBillingReconciliation: "unverified_after_resource_release",
          },
          evidence: [
            "Independent supplier observation of cancellation=" + receipt.cancellation +
              ", autoRenewal=" + receipt.autoRenewal + ", finalInvoice=" + receipt.finalInvoice +
              ", source=" + receipt.source + ", observedAt=" + receipt.observedAt + ".",
            ...receipt.evidence,
            "Supplier contract status does not settle P-030 financial effects, prove payment/refund or guarantee zero future bills.",
          ],
        }, "retention_supplier_contract_observation",
        "Provider contract state independently observed; monetary settlement remains separate.");
        result.supplierObservations += 1;
      }
    }
  }

  private async holdForArtifactCollection(
    resource: EnvironmentResource,
    releaseReason: string,
    result: EnvironmentRetentionSweepResult,
  ): Promise<EnvironmentResource> {
    const alreadyHeld =
      resource.metadata.retentionReleaseState === "artifact_hold";
    let current = resource;

    if (
      !alreadyHeld &&
      !["suspended", "terminated"].includes(current.status) &&
      this.registry.supportsOperation(current.provider, "suspend")
    ) {
      current = await this.lifecycle.suspend(current.id);
    }

    if (!alreadyHeld) {
      current = this.lifecycle.resources.applyMutation(
        current.id,
        {
          evidence: [
            `Retention boundary reached (${releaseReason}), but local executor artifacts remain uncollected. Resource destruction is held to preserve deliverables.`,
            current.status === "suspended"
              ? "Provider resource was suspended to reduce compute cost while preserving artifact state."
              : "Provider does not currently provide a verified suspended state; resource is retained until artifact collection evidence exists.",
          ],
          metadata: {
            retentionReleaseState: "artifact_hold",
            retentionReleaseReason: releaseReason,
            artifactHoldSince: new Date().toISOString(),
          },
        },
        "retention",
        "Automatic release deferred until remote artifact collection completes.",
      );
    }

    result.evidence.push(
      `Resource ${current.id} retained for ${pendingArtifactCount(current)} uncollected local artifact(s).`,
    );
    return current;
  }

  private retentionDecision(resource: EnvironmentResource): RetentionDecision {
    switch (resource.retentionPolicy) {
      case "ephemeral": {
        if (resource.status === "failed") {
          return {
            release: true,
            reason: "ephemeral resource itself failed before or during execution",
          };
        }

        if (!resource.taskId) {
          return {
            release: false,
            reason: "ephemeral resource has no Task ownership evidence",
          };
        }
        const row = this.db.prepare(
          "SELECT status FROM task_graph WHERE id = ?",
        ).get(resource.taskId) as { status: string } | undefined;
        const terminal = !!row &&
          ["completed", "failed", "cancelled"].includes(row.status);
        return {
          release: terminal,
          reason: terminal
            ? `ephemeral Task ${resource.taskId} settled with status=${row!.status}`
            : "owning Task is not terminal",
        };
      }

      case "until_goal_complete": {
        if (!resource.goalId) {
          return {
            release: false,
            reason: "resource has no Goal ownership evidence",
          };
        }
        const row = this.db.prepare(
          "SELECT status FROM goals WHERE id = ?",
        ).get(resource.goalId) as { status: string } | undefined;
        const terminal = !!row &&
          ["completed", "failed"].includes(row.status);
        return {
          release: terminal,
          reason: terminal
            ? `Goal ${resource.goalId} settled with status=${row!.status}`
            : "owning Goal is not terminal",
        };
      }

      case "persistent":
      case "manual_retention":
        return {
          release: false,
          reason: `retention policy=${resource.retentionPolicy} requires no automatic release`,
        };

      default:
        return {
          release: false,
          reason: `unknown/open retention policy=${resource.retentionPolicy}; ABOS will not invent destructive semantics`,
        };
    }
  }

  private async observeAfterUncertainDestroy(
    resource: EnvironmentResource,
    result: EnvironmentRetentionSweepResult,
  ): Promise<EnvironmentResource> {
    if (!this.registry.supportsOperation(resource.provider, "reconcile")) {
      result.evidence.push(
        `Retention release for resource ${resource.id} is pending observation, but provider "${resource.provider}" does not currently expose reconcile. No blind destroy retry will occur.`,
      );
      return resource;
    }

    const reconciled = await this.lifecycle.reconcile(resource.id);
    if (reconciled.status === "terminated") {
      const released = this.lifecycle.resources.applyMutation(
        reconciled.id,
        {
          metadata: {
            retentionReleaseState: "released",
            retentionReleasedAt: new Date().toISOString(),
          },
          evidence: [
            "Provider reconciliation verified termination after an earlier uncertain destroy.",
          ],
        },
        "retention",
        "Retention release verified by reconciliation.",
      );
      this.markLegacyExecutorReleased(released);
      return released;
    }

    if (reconciled.metadata.actualExists === false) {
      const absent = this.lifecycle.resources.applyMutation(
        reconciled.id,
        {
          status: "terminated",
          metadata: {
            retentionReleaseState: "released",
            retentionReleasedAt: new Date().toISOString(),
          },
          evidence: [
            "Provider reconciliation verified actualExists=false. For retention purposes the resource is released; ABOS does not fabricate a provider-side destruction event.",
          ],
        },
        "retention",
        "Retention boundary satisfied by provider-verified resource absence.",
      );
      this.markLegacyExecutorReleased(absent);
      return absent;
    }

    return reconciled;
  }

  private markLegacyExecutorReleased(resource: EnvironmentResource): void {
    // P-031/P-030: provider resource termination and economic closure are
    // independent truths. Attach a *read-only* view of canonical unsettled
    // financial intents to the already-terminated resource. Never mutate a
    // financial effect, manufacture a refund or claim future bills have ceased.
    const unresolved = listUnresolvedFinancialEffects(this.db)
      .filter(effect => effect.effectKind === "provider_resource_procurement" &&
        effect.provider === resource.provider &&
        effect.request.resourceId === resource.id);
    // A first supplier invoice may be settled while an automatic renewal or
    // cancellation obligation remains. Retention must not inspect only
    // unresolved intents: approved lifecycle terms of COMPLETED acquisitions
    // also matter for follow-up contract review. The canonical financial
    // journal is read-only here; rejected-before-dispatch intents are excluded.
    const lifecycleQuotes = listFinancialEffectsByStates(this.db, [
      "prepared", "dispatching", "pending", "unknown",
      "reconciliation_required", "completed",
    ]).filter(effect =>
      effect.effectKind === "provider_resource_procurement" &&
      effect.provider === resource.provider &&
      effect.request.resourceId === resource.id,
    ).map(effect => {
      const raw = effect.request.supplierLifecycleQuote;
      const quote = raw && typeof raw === "object" && !Array.isArray(raw)
        ? raw as Record<string, unknown> : {};
      const renewal = ["none", "manual", "automatic"].includes(String(quote.renewal))
        ? String(quote.renewal) : "unknown";
      const amount = (value: unknown) =>
        typeof value === "number" && Number.isSafeInteger(value) && value >= 0
          ? value : null;
      return {
        operationKey: effect.operationKey,
        ...((effect.request.operation === "renew" || effect.request.operation === "cancel") &&
          typeof effect.request.contractId === "string" && effect.request.contractId.trim()
          ? { contractId: effect.request.contractId } : {}),
        financialEffectState: effect.state,
        renewalQuoted: renewal,
        additionalCommittedRenewalCents:
          amount(quote.additionalCommittedRenewalCents),
        additionalExitChargeCents: amount(quote.additionalExitChargeCents),
        cancellationRouteDocumented: quote.cancellationRouteDocumented === true,
        // Quote terms never establish the current contract/cancellation
        // status, zero further supplier bills, credit or reimbursement.
        supplierCancellationStatus: "UNKNOWN",
      };
    });
    this.lifecycle.resources.applyMutation(resource.id, {
      metadata: {
        retentionBillingReconciliation: "unverified_after_resource_release",
        retentionBillingObservedAt: new Date().toISOString(),
        retentionBillingUnresolvedOperationKeys: unresolved.map(effect => effect.operationKey),
        retentionBillingUnresolvedCount: unresolved.length,
        retentionBillingLifecycleQuotes: lifecycleQuotes,
      },
      evidence: [
        `P-031 resource release identified ${unresolved.length} locally unresolved provider-procurement financial intent(s) for this exact provider/resource; canonical P-030 financial effects remain unchanged.`,
        "Provider resource termination is not evidence of contract cancellation, disabled auto-renewal, final invoice, settled payment or refund. Supplier billing reconciliation remains UNKNOWN even when no local intent is recorded.",
        `P-031 retained ${lifecycleQuotes.length} canonical source-quoted lifecycle term record(s), including completed purchase intents. Renewal and exit quotations are not evidence of executed cancellation or absent future billing.`,
      ],
    }, "retention_billing_reconciliation",
    "Resource retired; supplier billing outcome separately unverified.");

    // P-018 owns physical resource release, not ChildLifecycle state.
    // The former direct UPDATE children.status=cleaned_up here fabricated a
    // terminal child state without child_lifecycle_events, even for healthy
    // executors with no durable ChildLifecycle provenance. After restart the
    // row disagreed with the event owner. SandboxCleanup (P-029/replication)
    // observes canonical P-018 release before emitting stopped/failed ->
    // cleaned_up through ChildLifecycle.transition, preserving its history.
  }
}

function hasPendingLocalArtifacts(
  resource: EnvironmentResource,
): boolean {
  if (resource.metadata.artifactCollectionState !== "pending") {
    return false;
  }

  const artifacts = Array.isArray(resource.metadata.remoteArtifacts)
    ? resource.metadata.remoteArtifacts.filter(
        (value): value is string =>
          typeof value === "string" && value.trim().length > 0,
      )
    : [];

  return artifacts.some((artifact) => !hasDurableExternalScheme(artifact));
}

function pendingArtifactCount(resource: EnvironmentResource): number {
  return Array.isArray(resource.metadata.remoteArtifacts)
    ? resource.metadata.remoteArtifacts.filter(
        (value): value is string =>
          typeof value === "string" &&
          value.trim().length > 0 &&
          !hasDurableExternalScheme(value),
      ).length
    : 0;
}

function hasDurableExternalScheme(value: string): boolean {
  return /^(?:https?|s3|gs|ipfs|ar):\/\//i.test(value.trim());
}

function resourceFingerprint(resource: EnvironmentResource): string {
  return createHash("sha256")
    .update(JSON.stringify({
      provider: resource.provider,
      externalId: resource.externalId,
      status: resource.status,
      providerState: resource.providerState,
      actualExists: resource.metadata.actualExists ?? null,
    }))
    .digest("hex");
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : 0;
}
