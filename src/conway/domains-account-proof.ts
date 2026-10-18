/**
 * Read-only Conway Domains account identity corroboration.
 *
 * Official service https://docs.conway.tech/domains/authentication exposes
 * GET /auth/me under a wallet-signed SIWE/SIWS session JWT.
 * The host, never agent tool arguments, owns token acquisition and storage.
 * A provider wallet/account match does not establish current liquidity,
 * exact domain order price, signed x402 authorization or purchasing rights.
 */
import { isAddress } from "viem";
import { isValidSolanaAddress } from "../identity/chain.js";

export interface ConwayDomainsAccountProof {
  provider: "conway-domains";
  status: "wallet_match" | "wallet_mismatch" | "unavailable";
  providerAccountId: string | null;
  walletAddress: string | null;
  walletType: "evm" | "solana" | null;
  purchaseAuthority: "not_established";
  financingUnit: null;
  evidence: string[];
}

export async function observeConwayDomainsAuthenticatedAccount(
  getTrustedSessionToken: () => Promise<string | null>,
  expectedControlledWalletAddress: string,
  expectedWalletType: "evm" | "solana" = "evm",
): Promise<ConwayDomainsAccountProof> {
  const unknown: ConwayDomainsAccountProof = {
    provider: "conway-domains", status: "unavailable",
    providerAccountId: null, walletAddress: null, walletType: null,
    purchaseAuthority: "not_established", financingUnit: null,
    evidence: [
      "No authenticated Conway Domains /auth/me account-to-controlled-wallet match was observed.",
      "This does not determine supplier pricing, x402 wallet balances, liquidity, funding reservation, policy rights or a final contract.",
    ],
  };
  const validWallet = expectedWalletType === "evm"
    ? isAddress(expectedControlledWalletAddress)
    : isValidSolanaAddress(expectedControlledWalletAddress);
  if (typeof getTrustedSessionToken !== "function" || !validWallet) return unknown;

  try {
    const token = await getTrustedSessionToken();
    if (typeof token !== "string" || token.length < 8 ||
        token.length > 4096 || !/^[A-Za-z0-9._-]+$/.test(token)) {
      return unknown;
    }
    const response = await fetch("https://api.conway.domains/auth/me", {
      method: "GET",
      redirect: "error",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Cache-Control": "no-store",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return unknown;
    const raw: unknown = await response.json();
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return unknown;
    const account = raw as Record<string, unknown>;
    if (account.wallet_type !== expectedWalletType ||
        typeof account.id !== "string" || !account.id.trim() ||
        typeof account.wallet_address !== "string" ||
        !(expectedWalletType === "evm"
          ? isAddress(account.wallet_address)
          : isValidSolanaAddress(account.wallet_address))) return unknown;
    const addressMatches = expectedWalletType === "evm"
      ? account.wallet_address.toLowerCase() === expectedControlledWalletAddress.toLowerCase()
      : account.wallet_address === expectedControlledWalletAddress;
    if (!addressMatches) {
      // Never return a different wallet ID or the raw remote account ID.
      return {
        ...unknown, status: "wallet_mismatch",
        evidence: [
          "Authenticated Conway Domains account wallet differs from host-controlled wallet; the account cannot be attributed to ABOS.",
          ...unknown.evidence,
        ],
      };
    }
    return {
      provider: "conway-domains", status: "wallet_match",
      providerAccountId: account.id,
      walletAddress: expectedWalletType === "evm"
        ? account.wallet_address.toLowerCase() : account.wallet_address,
      walletType: expectedWalletType, purchaseAuthority: "not_established",
      financingUnit: null,
      evidence: [
        "The supplier's authenticated GET /auth/me returned a wallet matching the host's pre-existing controlled EVM wallet address.",
        "Identity match is not funding, payment authorization, wallet-signature approval, purchase amount, an invoice or a validated x402 order quote.",
      ],
    };
  } catch {
    // Do not persist or disclose raw JWT or provider/network exception text.
    return unknown;
  }
}
