export interface AgentTracker {
  getIdle(): { address: string; name: string; role: string; status: string }[];
  getBestForTask(role: string): { address: string; name: string } | null;
  updateStatus(address: string, status: string): void;
  register(agent: { address: string; name: string; role: string; sandboxId: string }): void;
}

export interface FundingProtocol {
  fundChild(childAddress: string, amountCents: number): Promise<{ success: boolean }>;
  recallCredits(childAddress: string): Promise<{
    success: boolean;
    amountCents: number;
    /** Present when the recall could not be executed by an authorized child route. */
    reason?: string;
  }>;
  /**
   * Directly observed child credit balance when the funding provider has
   * authority to observe it. Parent-local funding bookkeeping is not a balance.
   * UNKNOWN must remain null rather than being coerced to zero.
   */
  getBalance(childAddress: string): Promise<number | null>;
}

export interface OrchestratorTickResult {
  phase: string;
  tasksAssigned: number;
  tasksCompleted: number;
  tasksFailed: number;
  goalsActive: number;
  agentsActive: number;
}

export interface AgentAssignment {
  agentAddress: string;
  agentName: string;
  spawned: boolean;
}
