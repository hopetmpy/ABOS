import path from "node:path";
import fs from "node:fs";
import { createDatabase } from "../state/database.js";
import { RestrictedLiveAudit } from "./audit.js";
import { initializeLiveRoot, LIVE_DRY_RUN, LIVE_PATHS, RESTRICTED_LIVE_MODE, RestrictedLiveViolation } from "./mode.js";
import { X402SCAN_WALLET } from "./x402scan-once.js";
import { RestrictedBaseRpcTransport, RestrictedChainReader } from "./chain-reader.js";
import { createLiveProposalDependencies, createPaymentProposal } from "./payment-proposals.js";

export interface RestrictedRunnerOptions { maxTurns: number; maxRuntimeSeconds: number; requestedTools?: string[]; chainRead?: boolean; proposalRationale?: string }
export interface RestrictedRunnerResult { turns: number; elapsedMs: number; dryRun: boolean; statePath: string; walletAddress?: string; chainId?: number; usdcBalance?: string; ethBalance?: string; proposalId?: string }
const ALLOWED_TOOLS = new Set(["conway_inference", "check_credits", "check_own_usdc_balance", "propose_x402_payment"]);

export async function runRestrictedLive(options: RestrictedRunnerOptions): Promise<RestrictedRunnerResult> {
  if (!RESTRICTED_LIVE_MODE) throw new RestrictedLiveViolation("MODE_REQUIRED", "--restricted-live requires AUTOMATON_RESTRICTED_LIVE=true");
  if (!Number.isInteger(options.maxTurns) || options.maxTurns < 0 || options.maxTurns > 100) throw new RestrictedLiveViolation("BOUND_INVALID", "max-turns must be 0..100");
  if (!Number.isFinite(options.maxRuntimeSeconds) || options.maxRuntimeSeconds < 1 || options.maxRuntimeSeconds > 3600) throw new RestrictedLiveViolation("BOUND_INVALID", "max-runtime-seconds must be 1..3600");
  initializeLiveRoot();
  const audit = new RestrictedLiveAudit();
  const dbPath = path.join(LIVE_PATHS.state, "state.db");
  const db = createDatabase(dbPath);
  fs.chmodSync(dbPath, 0o600);
  const started = Date.now();
  let turns = 0;
  let killed: RestrictedLiveViolation | undefined;
  const deadline = setTimeout(() => { killed = new RestrictedLiveViolation("MAX_RUNTIME", "Maximum runtime reached"); }, options.maxRuntimeSeconds * 1000);
  try {
    const walletAddress: string = X402SCAN_WALLET;
    audit.record("mode_startup", { dryRun: LIVE_DRY_RUN, maxTurns: options.maxTurns, maxRuntimeSeconds: options.maxRuntimeSeconds, walletAddress });
    let chainId: number | undefined; let usdcBalance: string | undefined; let ethBalance: string | undefined;
    if (options.chainRead) {
      const transport = new RestrictedBaseRpcTransport("https://mainnet.base.org", audit);
      const reader = new RestrictedChainReader("https://mainnet.base.org", walletAddress, transport);
      chainId = await reader.getChainId();
      usdcBalance = await reader.getOwnUsdcBalance();
      ethBalance = await reader.getOwnEthBalance();
      audit.record("balances_observed", { walletAddress, chainId, usdcContract: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", usdcBalance, ethBalance });
    }
    for (const tool of options.requestedTools ?? []) if (!ALLOWED_TOOLS.has(tool)) throw new RestrictedLiveViolation("UNKNOWN_TOOL", `Unknown or prohibited tool requested: ${tool}`);
    let proposalId: string | undefined;
    if (options.requestedTools?.includes("propose_x402_payment")) {
      if (!options.proposalRationale) throw new RestrictedLiveViolation("PROPOSAL_INVALID", "Proposal rationale is required");
      proposalId = await createPaymentProposal(options.proposalRationale, createLiveProposalDependencies());
      audit.record("payment_proposal_created", { proposalId, route: "pinned-x402scan", dryRun: LIVE_DRY_RUN });
    }
    while (turns < options.maxTurns && !killed) { turns++; db.setKV("restricted_live_last_turn", String(turns)); await Promise.resolve(); }
    if (killed) throw killed;
    audit.record("shutdown", { reason: "bounded_complete", turns });
    return { turns, elapsedMs: Date.now() - started, dryRun: LIVE_DRY_RUN, statePath: dbPath, walletAddress, chainId, usdcBalance, ethBalance, proposalId };
  } catch (error) {
    audit.record("kill_condition", { reason: error instanceof Error ? error.message : "unknown" });
    throw error;
  } finally { clearTimeout(deadline); db.close(); }
}

export function parseRestrictedRunnerArgs(args: string[]): RestrictedRunnerOptions {
  const value = (flag: string, fallback: string) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : fallback; };
  const proposalIndex = args.indexOf("--propose-x402");
  const result: RestrictedRunnerOptions = { maxTurns: Number(value("--max-turns", "3")), maxRuntimeSeconds: Number(value("--max-runtime-seconds", "120")), chainRead: args.includes("--chain-read") };
  if (proposalIndex >= 0) { result.requestedTools = ["propose_x402_payment"]; result.proposalRationale = args[proposalIndex + 1]; }
  return result;
}
