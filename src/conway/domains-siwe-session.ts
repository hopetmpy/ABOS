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
import {
  observeConwayDomainsAuthenticatedAccount,
  type ConwayDomainsAccountProof,
} from "./domains-account-proof.js";

export interface TrustedEvmLoginSigner {
  /** Pre-existing ABOS wallet supplied by trusted host, never model args. */
  address: string;
  signMessage(input: { message: string }): Promise<string>;
}

async function postAuth(path: "/auth/nonce" | "/auth/verify",
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

export async function authenticateConwayDomainsControlledEvmWallet(
  wallet: TrustedEvmLoginSigner,
): Promise<ConwayDomainsAccountProof> {
  // Use the same fail-closed response contract as the read-only supplier
  // identity helper; intentionally do not create or persist a JWT.
  const unknown = () => observeConwayDomainsAuthenticatedAccount(
    async () => null, wallet?.address ?? "",
  );
  if (!wallet || !isAddress(wallet.address) ||
      typeof wallet.signMessage !== "function") return unknown();

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
    return await observeConwayDomainsAuthenticatedAccount(
      async () => access, wallet.address,
    );
  } catch {
    // Do not expose nonce/JWT, SIWE signature, supplier error payloads or
    // token-bearing network exception text to any agent/log.
    return unknown();
  }
}
