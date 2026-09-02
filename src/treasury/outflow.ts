import { ulid } from "ulid";
import type {
  AbosDatabase,
  ConwayClient,
  CreditTransferResult,
  TreasuryPolicy,
} from "../types.js";
import { SpendTracker } from "../agent/spend-tracker.js";

export type TreasuryOutflowStatus =
  | "reserved"
  | "submitted"
  | "blocked"
  | "confirmation_required"
  | "failed"
  | "unknown"
  | "unavailable";

export interface TreasuryOutflowRequest {
  source: string;
  recipient: string;
  amountCents: number;
  note?: string;
  /**
   * Reserved for the explicit confirmation lifecycle. Callers must not set
   * this true unless a real authorization path has confirmed the operation.
   */
  confirmed?: boolean;
}

export interface TreasuryOutflowResult {
  id: string;
  success: boolean;
  status: TreasuryOutflowStatus;
  amountCents: number;
  reason?: string;
  transfer?: CreditTransferResult;
}

interface PendingTotals {
  total: number;
  hourly: number;
  daily: number;
}

export class TreasuryOutflowAuthority {
  private readonly spendTracker: SpendTracker;

  constructor(
    private readonly conway: ConwayClient,
    private readonly db: AbosDatabase,
    private readonly policy: TreasuryPolicy,
  ) {
    this.spendTracker = new SpendTracker(db.raw);
  }

  async execute(
    request: TreasuryOutflowRequest,
  ): Promise<TreasuryOutflowResult> {
    const id = ulid();
    const amountCents = Math.floor(request.amountCents);

    if (!Number.isFinite(request.amountCents) || amountCents <= 0) {
      return {
        id,
        success: false,
        status: "blocked",
        amountCents,
        reason: "amountCents must resolve to a positive whole number of cents",
      };
    }

    let balanceCents: number;
    try {
      balanceCents = await this.conway.getCreditsBalance();
    } catch (error) {
      const reason =
        `Unable to verify current Conway credit balance: ${formatError(error)}`;
      this.insertAttempt({
        id,
        request,
        amountCents,
        status: "unavailable",
        reason,
        balanceCents: 0,
      });
      return {
        id,
        success: false,
        status: "unavailable",
        amountCents,
        reason,
      };
    }

    const preflight = this.reserveIfAllowed(
      id,
      request,
      amountCents,
      balanceCents,
    );
    if (preflight.status !== "reserved") {
      return preflight;
    }

    try {
      const transfer = await this.conway.transferCredits(
        request.recipient,
        amountCents,
        request.note,
        { idempotencyKey: id },
      );

      if (!isCreditTransferSuccessful(transfer.status)) {
        const reason =
          `Conway reported transfer status "${transfer.status || "unknown"}"`;
        this.settleNonSuccess(
          id,
          "failed",
          reason,
          transfer,
        );
        return {
          id,
          success: false,
          status: "failed",
          amountCents,
          reason,
          transfer,
        };
      }

      this.settleSuccess(id, request, amountCents, balanceCents, transfer);
      return {
        id,
        success: true,
        status: "submitted",
        amountCents,
        transfer,
      };
    } catch (error) {
      // A thrown network/provider error does not prove the provider did not
      // accept the transfer. Keep the reservation active as unknown.
      const reason =
        `Transfer outcome is unknown after provider error: ${formatError(error)}`;
      this.settleNonSuccess(id, "unknown", reason);
      return {
        id,
        success: false,
        status: "unknown",
        amountCents,
        reason,
      };
    }
  }

  private reserveIfAllowed(
    id: string,
    request: TreasuryOutflowRequest,
    amountCents: number,
    balanceCents: number,
  ): TreasuryOutflowResult {
    const reserve = this.db.raw.transaction(() => {
      const pending = this.getPendingTotals();

      const blocked = this.evaluatePolicy(
        request,
        amountCents,
        balanceCents,
        pending,
      );

      if (blocked) {
        this.insertAttempt({
          id,
          request,
          amountCents,
          status: blocked.status,
          reason: blocked.reason,
          balanceCents,
        });
        return {
          id,
          success: false,
          status: blocked.status,
          amountCents,
          reason: blocked.reason,
        } satisfies TreasuryOutflowResult;
      }

      this.insertAttempt({
        id,
        request,
        amountCents,
        status: "reserved",
        reason: "",
        balanceCents,
      });

      return {
        id,
        success: false,
        status: "reserved",
        amountCents,
      } satisfies TreasuryOutflowResult;
    });

    return reserve.immediate();
  }

  private evaluatePolicy(
    request: TreasuryOutflowRequest,
    amountCents: number,
    balanceCents: number,
    pending: PendingTotals,
  ): { status: "blocked" | "confirmation_required"; reason: string } | null {
    if (amountCents > this.policy.maxSingleTransferCents) {
      return {
        status: "blocked",
        reason:
          `Outflow of ${amountCents} cents exceeds max single transfer ` +
          `of ${this.policy.maxSingleTransferCents} cents`,
      };
    }

    const hourlySpend = this.spendTracker.getHourlySpend("transfer");
    if (
      hourlySpend + pending.hourly + amountCents >
      this.policy.maxHourlyTransferCents
    ) {
      return {
        status: "blocked",
        reason:
          `Hourly transfer cap exceeded: completed ${hourlySpend} + pending ` +
          `${pending.hourly} + requested ${amountCents} > ` +
          `${this.policy.maxHourlyTransferCents}`,
      };
    }

    const dailySpend = this.spendTracker.getDailySpend("transfer");
    if (
      dailySpend + pending.daily + amountCents >
      this.policy.maxDailyTransferCents
    ) {
      return {
        status: "blocked",
        reason:
          `Daily transfer cap exceeded: completed ${dailySpend} + pending ` +
          `${pending.daily} + requested ${amountCents} > ` +
          `${this.policy.maxDailyTransferCents}`,
      };
    }

    const effectiveBalance = Math.max(0, balanceCents - pending.total);
    if (
      effectiveBalance - amountCents <
      this.policy.minimumReserveCents
    ) {
      return {
        status: "blocked",
        reason:
          `Minimum reserve would be violated: effective balance ` +
          `${effectiveBalance} - requested ${amountCents} < reserve ` +
          `${this.policy.minimumReserveCents}`,
      };
    }

    if (
      !request.confirmed &&
      amountCents > this.policy.requireConfirmationAboveCents
    ) {
      return {
        status: "confirmation_required",
        reason:
          `Outflow of ${amountCents} cents exceeds confirmation threshold ` +
          `of ${this.policy.requireConfirmationAboveCents} cents`,
      };
    }

    return null;
  }

  private getPendingTotals(): PendingTotals {
    const now = new Date();
    const hourStart =
      now.toISOString().slice(0, 13) + ":00:00.000Z";
    const dayStart =
      now.toISOString().slice(0, 10) + "T00:00:00.000Z";

    const query = (since?: string): number => {
      const clause = since ? " AND created_at >= ?" : "";
      const row = this.db.raw.prepare(
        `SELECT COALESCE(SUM(amount_cents), 0) AS total
         FROM treasury_outflows
         WHERE status IN ('reserved', 'unknown')${clause}`,
      ).get(...(since ? [since] : [])) as { total: number };
      return Number(row?.total ?? 0);
    };

    return {
      total: query(),
      hourly: query(hourStart),
      daily: query(dayStart),
    };
  }

  private insertAttempt(params: {
    id: string;
    request: TreasuryOutflowRequest;
    amountCents: number;
    status: TreasuryOutflowStatus;
    reason: string;
    balanceCents: number;
  }): void {
    const now = new Date().toISOString();
    this.db.raw.prepare(
      `INSERT INTO treasury_outflows (
         id, source, recipient, amount_cents, status, reason,
         balance_snapshot_cents, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      params.id,
      params.request.source,
      params.request.recipient,
      params.amountCents,
      params.status,
      params.reason,
      params.balanceCents,
      now,
      now,
    );
  }

  private settleSuccess(
    id: string,
    request: TreasuryOutflowRequest,
    amountCents: number,
    balanceSnapshotCents: number,
    transfer: CreditTransferResult,
  ): void {
    const settle = this.db.raw.transaction(() => {
      const now = new Date().toISOString();
      this.db.raw.prepare(
        `UPDATE treasury_outflows
         SET status = 'submitted',
             reason = '',
             provider_transfer_id = ?,
             provider_status = ?,
             updated_at = ?,
             settled_at = ?
         WHERE id = ?`,
      ).run(
        transfer.transferId || null,
        transfer.status || null,
        now,
        now,
        id,
      );

      this.spendTracker.recordSpend({
        toolName: request.source,
        amountCents,
        recipient: request.recipient,
        category: "transfer",
      });

      this.db.insertTransaction({
        id: ulid(),
        type: "transfer_out",
        amountCents,
        balanceAfterCents:
          transfer.balanceAfterCents ??
          Math.max(balanceSnapshotCents - amountCents, 0),
        description:
          `Treasury outflow via ${request.source} to ${request.recipient}` +
          (request.note ? `: ${request.note}` : ""),
        timestamp: now,
      });
    });
    settle.immediate();
  }

  private settleNonSuccess(
    id: string,
    status: "failed" | "unknown",
    reason: string,
    transfer?: CreditTransferResult,
  ): void {
    const now = new Date().toISOString();
    this.db.raw.prepare(
      `UPDATE treasury_outflows
       SET status = ?,
           reason = ?,
           provider_transfer_id = ?,
           provider_status = ?,
           updated_at = ?,
           settled_at = CASE WHEN ? = 'failed' THEN ? ELSE settled_at END
       WHERE id = ?`,
    ).run(
      status,
      reason,
      transfer?.transferId || null,
      transfer?.status || null,
      now,
      status,
      now,
      id,
    );
  }
}

export function isCreditTransferSuccessful(status: string): boolean {
  const normalized = status.trim().toLowerCase();
  return (
    normalized.length > 0 &&
    !normalized.includes("fail") &&
    !normalized.includes("error") &&
    !normalized.includes("reject")
  );
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
