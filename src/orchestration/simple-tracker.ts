import { ulid } from "ulid";
import type {
  AbosDatabase,
  AbosIdentity,
  ChildStatus,
  ConwayClient,
} from "../types.js";
import { createLogger } from "../observability/logger.js";
import type { AgentTracker, FundingProtocol } from "./types.js";

const logger = createLogger("orchestration.simple-tracker");
const IDLE_STATUSES = new Set<ChildStatus>(["running", "healthy"]);

export class SimpleAgentTracker implements AgentTracker {
  constructor(private readonly db: AbosDatabase) {}

  getIdle(): { address: string; name: string; role: string; status: string }[] {
    const assignedRows = this.db.raw.prepare(
      `SELECT DISTINCT assigned_to AS address
       FROM task_graph
       WHERE assigned_to IS NOT NULL
         AND status IN ('assigned', 'running')`,
    ).all() as { address: string }[];

    const assignedAddresses = new Set(
      assignedRows
        .map((row) => row.address)
        .filter((value): value is string => typeof value === "string" && value.length > 0),
    );

    const children = this.db.raw.prepare(
      `SELECT id, name, address, status, COALESCE(role, 'generalist') AS role
       FROM children
       WHERE status IN ('running', 'healthy')`,
    ).all() as { id: string; name: string; address: string; status: string; role: string }[];

    return children
      .filter((child) => IDLE_STATUSES.has(child.status as ChildStatus) && !assignedAddresses.has(child.address))
      .map((child) => ({
        address: child.address,
        name: child.name,
        role: child.role,
        status: child.status,
      }));
  }

  getBestForTask(_role: string): { address: string; name: string } | null {
    const idle = this.getIdle();
    if (idle.length === 0) {
      return null;
    }

    return {
      address: idle[0].address,
      name: idle[0].name,
    };
  }

  updateStatus(address: string, status: string): void {
    const child = this.db.getChildren().find((entry) => entry.address === address);
    if (!child) {
      return;
    }

    // Lifecycle-managed children use ChildLifecycle as the authority for
    // requested -> ... -> healthy. TaskGraph.assigned_to already represents
    // busy/idle state, so legacy tracker writes must not collapse that state
    // machine back to "running"/"healthy".
    const lifecycle = this.db.raw.prepare(
      `SELECT to_state AS state
       FROM child_lifecycle_events
       WHERE child_id = ?
       ORDER BY created_at DESC, rowid DESC
       LIMIT 1`,
    ).get(child.id) as { state: string } | undefined;

    if (
      lifecycle &&
      (status === "running" || status === "healthy")
    ) {
      return;
    }

    this.db.updateChildStatus(child.id, status as ChildStatus);
  }

  register(agent: { address: string; name: string; role: string; sandboxId: string }): void {
    const existing = this.db.raw.prepare(
      `SELECT id
       FROM children
       WHERE address = ? OR sandbox_id = ?
       ORDER BY created_at ASC
       LIMIT 1`,
    ).get(agent.address, agent.sandboxId) as { id: string } | undefined;

    if (existing) {
      // Keep spawn/lifecycle identity canonical. Only enrich the planner role
      // if that column exists; never insert a second child row.
      try {
        this.db.raw.prepare(
          "UPDATE children SET role = COALESCE(NULLIF(role, ''), ?) WHERE id = ?",
        ).run(agent.role, existing.id);
      } catch {
        // Older schemas may not yet expose role; identity reuse still holds.
      }
      return;
    }

    this.db.insertChild({
      id: ulid(),
      name: agent.name,
      address: agent.address as `0x${string}`,
      sandboxId: agent.sandboxId,
      genesisPrompt: `Role: ${agent.role}`,
      creatorMessage: "registered by orchestrator",
      fundedAmountCents: 0,
      status: "running",
      createdAt: new Date().toISOString(),
    });
  }
}

export class SimpleFundingProtocol implements FundingProtocol {
  constructor(
    private readonly conway: ConwayClient,
    private readonly identity: AbosIdentity,
    private readonly db: AbosDatabase,
  ) {}

  async fundChild(childAddress: string, amountCents: number): Promise<{ success: boolean }> {
    const transferAmount = Math.max(0, Math.floor(amountCents));
    if (transferAmount === 0) {
      return { success: true };
    }

    let result;
    try {
      result = await this.conway.transferCredits(
        childAddress,
        transferAmount,
        "Task funding from orchestrator",
      );
    } catch {
      return { success: false };
    }

    const success = isTransferSuccessful(result.status);
    if (!success) {
      return { success: false };
    }

    try {
      const persistAllocation = this.db.raw.transaction(() => {
        this.db.raw.prepare(
          "UPDATE children SET funded_amount_cents = funded_amount_cents + ? WHERE address = ?",
        ).run(transferAmount, childAddress);

        this.db.raw.prepare(
          `INSERT INTO transactions
           (id, type, amount_cents, balance_after_cents, description)
           VALUES (?, 'capital_allocation', ?, ?, ?)`,
        ).run(
          ulid(),
          transferAmount,
          result.balanceAfterCents ?? null,
          `Allocate task working capital to child ${childAddress}`,
        );
      });
      persistAllocation();
    } catch (error) {
      // The external transfer has already succeeded. Returning false here could
      // make an orchestrator retry the irreversible transfer and double-fund the
      // child. Preserve the external success and surface the local evidence gap.
      logger.error(
        "Child funding transferred but local capital ledger persistence failed",
        error instanceof Error ? error : undefined,
        {
          childAddress,
          transferAmount,
          transferId: result.transferId,
        },
      );
    }

    return { success: true };
  }

  async recallCredits(childAddress: string): Promise<{
    success: boolean;
    amountCents: number;
    reason?: string;
  }> {
    const row = this.db.raw
      .prepare("SELECT funded_amount_cents FROM children WHERE address = ?")
      .get(childAddress) as { funded_amount_cents: number } | undefined;
    const trackedAllocation = Math.max(
      0,
      Math.floor(row?.funded_amount_cents ?? 0),
    );

    if (trackedAllocation === 0) {
      return { success: true, amountCents: 0 };
    }

    // The ConwayClient attached to this protocol is authenticated as the
    // parent ABOS. Calling transferCredits(parentAddress, ...) from it would
    // debit the parent, not the child. Until a child-authorized transfer route
    // (child RPC/message execution or provider-native debit) is available,
    // recall is unavailable and the local allocation must remain unchanged.
    return {
      success: false,
      amountCents: 0,
      reason:
        `Credit recall from ${childAddress} is currently unavailable: ` +
        `the parent runtime cannot authorize a debit from the child wallet. ` +
        `${trackedAllocation} cents remain tracked as previously funded.`,
    };
  }

  /**
   * The parent Conway client cannot query a child wallet's credit balance by
   * address. children.funded_amount_cents is historical parent bookkeeping,
   * not an observed child balance, so UNKNOWN must remain null.
   *
   * A future FundingProtocol with a child-authorized/provider-native balance
   * observation may return a number without changing the orchestration contract.
   */
  async getBalance(_childAddress: string): Promise<number | null> {
    return null;
  }
}

function isTransferSuccessful(status: string): boolean {
  const normalized = status.trim().toLowerCase();
  return normalized.length > 0
    && !normalized.includes("fail")
    && !normalized.includes("error")
    && !normalized.includes("reject");
}
