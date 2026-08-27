import { BASE_CHAIN_ID, BASE_USDC_ADDRESS, LIVE_DRY_RUN, RESTRICTED_LIVE_ALLOWLIST, RESTRICTED_LIVE_LIMITS, RestrictedLiveViolation, assertAllowedUrl } from "./mode.js";

export interface PaymentProposal {
  url: string; chainId: number; tokenAddress: string; recipient: string;
  amountUsdc: number; walletBalanceUsdc: number; idempotencyKey: string;
}
export interface SpendRecord { amountUsdc: number; timestamp: number; idempotencyKey: string }
export interface PaymentStore { records(): SpendRecord[]; append(record: SpendRecord): void }
export interface RestrictedSigner { submitX402(proposal: PaymentProposal): Promise<{ transactionHash: string }> }
export interface PaymentAudit { record(event: string, metadata?: Record<string, unknown>): void }

export class RestrictedX402PaymentAdapter {
  private readonly inFlight = new Set<string>();
  constructor(private readonly store: PaymentStore, private readonly audit: PaymentAudit, private readonly signer?: RestrictedSigner, private readonly dryRun = LIVE_DRY_RUN, private readonly approvedRecipients: readonly string[] = RESTRICTED_LIVE_ALLOWLIST.x402Recipients, private readonly approvedUrls: readonly string[] = RESTRICTED_LIVE_ALLOWLIST.x402Urls) {}

  async pay(proposal: PaymentProposal): Promise<{ dryRun: boolean; transactionHash?: string }> {
    this.audit.record("payment_proposed", { url: proposal.url, chainId: proposal.chainId, tokenAddress: proposal.tokenAddress, recipient: proposal.recipient, amountUsdc: proposal.amountUsdc, idempotencyKey: proposal.idempotencyKey });
    try { this.validate(proposal); } catch (error) {
      this.audit.record("payment_denied", { reason: error instanceof Error ? error.message : "unknown" });
      throw error;
    }
    if (this.dryRun) { this.audit.record("payment_approved_dry_run", { amountUsdc: proposal.amountUsdc }); return { dryRun: true }; }
    if (!this.signer) throw new RestrictedLiveViolation("SIGNER_UNAVAILABLE", "Restricted payment signer unavailable");
    this.inFlight.add(proposal.idempotencyKey);
    try {
      const result = await this.signer.submitX402(proposal);
      this.store.append({ amountUsdc: proposal.amountUsdc, timestamp: Date.now(), idempotencyKey: proposal.idempotencyKey });
      this.audit.record("payment_approved", { amountUsdc: proposal.amountUsdc, transactionHash: result.transactionHash, cumulativeSpendUsdc: this.totalSince(24 * 60 * 60 * 1000) });
      return { dryRun: false, transactionHash: result.transactionHash };
    } finally { this.inFlight.delete(proposal.idempotencyKey); }
  }

  private validate(p: PaymentProposal): void {
    const url = assertAllowedUrl(p.url, "x402Origins");
    const canonicalUrl = `${url.origin}${url.pathname}`;
    if (!this.approvedUrls.includes(canonicalUrl)) throw new RestrictedLiveViolation("DESTINATION_DENIED", "Exact x402 URL is not allowlisted");
    if (p.chainId !== BASE_CHAIN_ID) throw new RestrictedLiveViolation("CHAIN_DENIED", "Only Base mainnet is allowed");
    if (p.tokenAddress.toLowerCase() !== BASE_USDC_ADDRESS.toLowerCase()) throw new RestrictedLiveViolation("TOKEN_DENIED", "Only native Base USDC is allowed");
    if (!/^0x[0-9a-fA-F]{40}$/.test(p.recipient)) throw new RestrictedLiveViolation("RECIPIENT_DENIED", "Invalid payment recipient");
    if (!this.approvedRecipients.some((recipient) => recipient.toLowerCase() === p.recipient.toLowerCase())) throw new RestrictedLiveViolation("RECIPIENT_DENIED", "Payment recipient is not allowlisted");
    if (!Number.isFinite(p.amountUsdc) || p.amountUsdc <= 0 || p.amountUsdc > RESTRICTED_LIVE_LIMITS.maxSingleX402PaymentUsdc) throw new RestrictedLiveViolation("SINGLE_SPEND_LIMIT", "Single payment limit exceeded");
    if (!p.idempotencyKey || this.inFlight.has(p.idempotencyKey) || this.store.records().some((r) => r.idempotencyKey === p.idempotencyKey)) throw new RestrictedLiveViolation("REPLAY_DENIED", "Missing or replayed idempotency key");
    if (this.totalSince(60 * 60 * 1000) + p.amountUsdc > RESTRICTED_LIVE_LIMITS.maxHourlySpendUsdc) throw new RestrictedLiveViolation("HOURLY_SPEND_LIMIT", "Hourly payment limit exceeded");
    if (this.totalSince(24 * 60 * 60 * 1000) + p.amountUsdc > RESTRICTED_LIVE_LIMITS.maxDailySpendUsdc) throw new RestrictedLiveViolation("DAILY_SPEND_LIMIT", "Daily payment limit exceeded");
    if (p.walletBalanceUsdc - p.amountUsdc < RESTRICTED_LIVE_LIMITS.minimumWalletReserveUsdc) throw new RestrictedLiveViolation("RESERVE_LIMIT", "Minimum wallet reserve would be breached");
    if (p.walletBalanceUsdc > RESTRICTED_LIVE_LIMITS.maxWalletFundingExpectedUsdc) throw new RestrictedLiveViolation("UNEXPECTED_BALANCE", "Wallet balance exceeds configured expected funding");
  }
  private totalSince(windowMs: number): number { const cutoff = Date.now() - windowMs; return this.store.records().filter((r) => r.timestamp >= cutoff).reduce((sum, r) => sum + r.amountUsdc, 0); }
}

export function denyThirdPartyTransfer(): never { throw new RestrictedLiveViolation("TRANSFER_DENIED", "Third-party token transfers are disabled"); }
export function denyContractWrite(): never { throw new RestrictedLiveViolation("CHAIN_WRITE_DENIED", "Arbitrary blockchain writes and approvals are disabled"); }
