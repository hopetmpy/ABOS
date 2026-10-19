/**
 * Conway Domains host-owned SIWE account session.
 *
 * Domain service official docs:
 * https://docs.conway.tech/domains/authentication
 * POST /auth/nonce -> sign SIWE with an EXISTING controlled wallet ->
 * POST /auth/verify -> ephemeral JWT -> GET /auth/me.
 *
 * This flow NEVER signs an x402 transfer, runs supplier registration, creates
 * a wallet, persists JWT/signatures or extends P-010 purchase authority.
 * Auth domain/URI is a provider protocol hypothesis until supplier LIVE
 * handshake confirms it; return UNKNOWN if rejected.
 */
import { SiweMessage } from "siwe";
import { isAddress } from "viem";
import { isValidSolanaAddress, type ChainIdentity } from "../identity/chain.js";
import { buildSiwsMessage, verifySiwsSignature } from "../identity/siws.js";
import {
  observeConwayDomainsAuthenticatedAccount,
  type ConwayDomainsAccountProof,
} from "./domains-account-proof.js";
import {
  observeConwayDomainsOwnedResources,
  type ConwayDomainsOwnedResourceSnapshot,
} from "./domains-owned-inventory.js";
import {
  observeConwayOwnedDomainDns,
  type ConwayOwnedDnsObservation,
} from "./domains-dns-observation.js";

export interface TrustedEvmLoginSigner {
  /** Pre-existing ABOS wallet supplied by trusted host, never model args. */
  address: string;
  signMessage(input: { message: string }): Promise<string>;
}

async function postAuth(path:
  | "/auth/nonce" | "/auth/verify"
  | "/auth/solana/nonce" | "/auth/solana/verify",
  body?: Readonly<{ message: string; signature: string }>): Promise<unknown> {
  const response = await fetch(`https://api.conway.domains${path}`, {
    method: "POST",
    redirect: "error",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) return null;
  const payload: unknown = await response.json();
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload : null;
}

async function signInEvm(
  wallet: TrustedEvmLoginSigner,
  onVerifiedSession?: (token: string, account: ConwayDomainsAccountProof) => Promise<void>,
  rethrowConsumerError = false,
): Promise<ConwayDomainsAccountProof> {
  // Use the same fail-closed response contract as the read-only supplier
  // identity helper; intentionally do not create or persist a JWT.
  const unknown = () => observeConwayDomainsAuthenticatedAccount(
    async () => null, wallet?.address ?? "",
  );
  if (!wallet || !isAddress(wallet.address) ||
      typeof wallet.signMessage !== "function") return unknown();

  let consumerStarted = false;
  try {
    const nonceData = await postAuth("/auth/nonce") as Record<string, unknown> | null;
    const nonce = nonceData?.nonce;
    if (typeof nonce !== "string" || !/^[A-Za-z0-9]{8,128}$/.test(nonce)) {
      return unknown();
    }

    const message = new SiweMessage({
      domain: "api.conway.domains",
      address: wallet.address,
      statement: "Sign in to Conway Domains to verify the agent's own account.",
      uri: "https://api.conway.domains",
      version: "1",
      chainId: 8453,
      nonce,
      issuedAt: new Date().toISOString(),
    }).prepareMessage();
    const signature = await wallet.signMessage({ message });
    if (typeof signature !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(signature)) {
      return unknown();
    }
    const result = await postAuth("/auth/verify", { message, signature }) as
      Record<string, unknown> | null;
    const access = result?.access_token;
    if (typeof access !== "string" || !access.trim()) return unknown();
    const account = await observeConwayDomainsAuthenticatedAccount(
      async () => access, wallet.address,
    );
    if (account.status === "wallet_match" && onVerifiedSession) {
      consumerStarted = true;
      await onVerifiedSession(access, account);
    }
    return account;
  } catch {
    // Do not suppress an uncertain provider effect raised by the trusted
    // session consumer. The ordinary read-only callers still return UNKNOWN.
    if (rethrowConsumerError && consumerStarted) {
      throw new Error("Conway Domains verified-session external outcome UNKNOWN; do not replay.");
    }
    // Do not expose nonce/JWT, SIWE signature or supplier error payloads.
    return unknown();
  }
}

/**
 * The same provider supports SIWS on its Solana-specific nonce/verify path.
 * The existing ABOS ChainIdentity owns the Ed25519 signer; the returned JWT
 * is ephemeral and can only be used for same-wallet account observation.
 * The provider's actual SIWS message dialect is unverified until LIVE E5.
 */
async function signInSolana(
  wallet: ChainIdentity,
  onVerifiedSession?: (token: string) => Promise<void>,
): Promise<ConwayDomainsAccountProof> {
  const unknown = () => observeConwayDomainsAuthenticatedAccount(
    async () => null, wallet?.address ?? "", "solana",
  );
  if (!wallet || wallet.chainType !== "solana" ||
      !isValidSolanaAddress(wallet.address) ||
      typeof wallet.signMessage !== "function") return unknown();

  try {
    const nonceData = await postAuth("/auth/solana/nonce") as
      Record<string, unknown> | null;
    const nonce = nonceData?.nonce;
    if (typeof nonce !== "string" || !/^[A-Za-z0-9]{8,128}$/.test(nonce)) {
      return unknown();
    }

    const message = buildSiwsMessage({
      domain: "api.conway.domains",
      address: wallet.address,
      statement: "Sign in to Conway Domains to verify the agent's own account.",
      uri: "https://api.conway.domains",
      nonce,
      issuedAt: new Date().toISOString(),
      chainId: "mainnet",
    });
    const signature = await wallet.signMessage(message);
    // Do not trust a host wrapper merely because it returned a string:
    // verify that its actual signer controls this Solana public key.
    if (typeof signature !== "string" ||
        !verifySiwsSignature(message, signature, wallet.address)) {
      return unknown();
    }

    const verified = await postAuth("/auth/solana/verify", {
      message, signature,
    }) as Record<string, unknown> | null;
    const access = verified?.access_token;
    if (typeof access !== "string" || !access.trim()) return unknown();
    const account = await observeConwayDomainsAuthenticatedAccount(
      async () => access, wallet.address, "solana",
    );
    if (account.status === "wallet_match" && onVerifiedSession) {
      await onVerifiedSession(access);
    }
    return account;
  } catch {
    // Never log a SIWS message, signature, JWT, nonce or supplier error body.
    return unknown();
  }
}

/**
 * Public sign-in/proof remains the same; no token is returned or persisted.
 * The callback in the private sign-in owner allows another fixed host-only
 * read to consume a short-lived token within the same successful handshake.
 */
export async function authenticateConwayDomainsControlledEvmWallet(
  wallet: TrustedEvmLoginSigner,
): Promise<ConwayDomainsAccountProof> {
  return signInEvm(wallet);
}

export async function authenticateConwayDomainsControlledSolanaWallet(
  wallet: ChainIdentity,
): Promise<ConwayDomainsAccountProof> {
  return signInSolana(wallet);
}

async function unknownInventory(
  walletAddress: string,
  walletType: "evm" | "solana",
  account: ConwayDomainsAccountProof,
): Promise<ConwayDomainsOwnedResourceSnapshot> {
  const empty = await observeConwayDomainsOwnedResources(
    async () => null, walletAddress, walletType,
  );
  return { ...empty, account };
}

/** Read supplier-owned inventory/transactions with the existing EVM wallet. */
export async function observeConwayDomainsControlledEvmResources(
  wallet: TrustedEvmLoginSigner,
): Promise<ConwayDomainsOwnedResourceSnapshot> {
  let observation: ConwayDomainsOwnedResourceSnapshot | null = null;
  const account = await signInEvm(wallet, async token => {
    observation = await observeConwayDomainsOwnedResources(
      async () => token, wallet.address, "evm",
    );
  });
  return observation ?? unknownInventory(wallet?.address ?? "", "evm", account);
}

/** Read supplier-owned inventory/transactions with the existing Solana wallet. */
export async function observeConwayDomainsControlledSolanaResources(
  wallet: ChainIdentity,
): Promise<ConwayDomainsOwnedResourceSnapshot> {
  let observation: ConwayDomainsOwnedResourceSnapshot | null = null;
  const account = await signInSolana(wallet, async token => {
    observation = await observeConwayDomainsOwnedResources(
      async () => token, wallet.address, "solana",
    );
  });
  return observation ?? unknownInventory(wallet?.address ?? "", "solana", account);
}

/**
 * One wallet-owned session for DNS observation. No persistent JWT and no
 * independent resource-usable claim; the provider's DNS view may be cached.
 */
export async function observeConwayControlledEvmDns(
  wallet: TrustedEvmLoginSigner, domain: string,
): Promise<ConwayOwnedDnsObservation> {
  let observation: ConwayOwnedDnsObservation | null = null;
  await signInEvm(wallet, async token => {
    observation = await observeConwayOwnedDomainDns(
      async () => token, wallet.address, "evm", domain,
    );
  });
  return observation ?? observeConwayOwnedDomainDns(
    async () => null, wallet?.address ?? "", "evm", domain,
  );
}

export async function observeConwayControlledSolanaDns(
  wallet: ChainIdentity, domain: string,
): Promise<ConwayOwnedDnsObservation> {
  let observation: ConwayOwnedDnsObservation | null = null;
  await signInSolana(wallet, async token => {
    observation = await observeConwayOwnedDomainDns(
      async () => token, wallet.address, "solana", domain,
    );
  });
  return observation ?? observeConwayOwnedDomainDns(
    async () => null, wallet?.address ?? "", "solana", domain,
  );
}

/**
 * Trusted host-only transport hook: borrow one already verified EVM login
 * session without persisting or exporting a JWT to the model. Crucially,
 * errors AFTER callback entry propagate as UNKNOWN rather than being
 * mislabeled "no provider dispatch".
 */
export async function withVerifiedConwayDomainsEvmSession<T>(
  wallet: TrustedEvmLoginSigner,
  consumer: (token: string, account: ConwayDomainsAccountProof) => Promise<T>,
): Promise<{ account: ConwayDomainsAccountProof; value: T } | null> {
  let value: T | undefined;
  let consumed = false;
  const account = await signInEvm(wallet, async (token, proof) => {
    value = await consumer(token, proof);
    consumed = true;
  }, true);
  return account.status === "wallet_match" && consumed
    ? { account, value: value as T }
    : null;
}
