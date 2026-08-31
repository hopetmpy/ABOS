/**
 * ABOS Wallet Management
 *
 * Creates and manages wallets for the abos's identity and payments.
 * Supports both EVM (secp256k1/viem) and Solana (Ed25519/tweetnacl) wallets.
 * The private key is the abos's sovereign identity.
 * Chain type is chosen at genesis and never changes.
 */

import type { PrivateKeyAccount } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import nacl from "tweetnacl";
import bs58 from "bs58";
import fs from "fs";
import path from "path";
import type { WalletData } from "../types.js";
import type { ChainType } from "./chain.js";
import { EvmChainIdentity, SolanaChainIdentity } from "./chain.js";
import type { ChainIdentity } from "./chain.js";

/**
 * Create a stub PrivateKeyAccount for Solana wallets.
 * The stub has the Solana address but throws on any EVM signing attempt,
 * preventing accidental use of a random key.
 */
function createSolanaStubAccount(solanaAddress: string): PrivateKeyAccount {
  const throwSigning = () => {
    throw new Error(
      "Cannot use EVM signing methods on a Solana wallet. Use chainIdentity instead.",
    );
  };
  return {
    address: solanaAddress as any,
    publicKey: "0x" as any,
    source: "custom",
    type: "local",
    signMessage: throwSigning as any,
    signTypedData: throwSigning as any,
    signTransaction: throwSigning as any,
    sign: throwSigning as any,
  } as unknown as PrivateKeyAccount;
}

const HOME_DIR = process.env.HOME || "/root";
const ABOS_DIR = path.join(HOME_DIR, ".abos");
const LEGACY_AUTOMATON_DIR = path.join(HOME_DIR, ".automaton");
const WALLET_FILE = path.join(ABOS_DIR, "wallet.json");
const LEGACY_WALLET_FILE = path.join(LEGACY_AUTOMATON_DIR, "wallet.json");
const LEGACY_CONFIG_FILE = path.join(LEGACY_AUTOMATON_DIR, "automaton.json");
const ABOS_CONFIG_FILE = path.join(ABOS_DIR, "abos.json");

let legacyMigrationChecked = false;

function rewriteLegacyConfigPaths(): void {
  if (!fs.existsSync(ABOS_CONFIG_FILE)) return;

  try {
    const raw = JSON.parse(fs.readFileSync(ABOS_CONFIG_FILE, "utf-8")) as Record<string, unknown>;
    let changed = false;

    for (const key of ["heartbeatConfigPath", "dbPath", "skillsDir"] as const) {
      const value = raw[key];
      if (typeof value !== "string") continue;

      let migrated = value;
      if (migrated === "~/.automaton" || migrated.startsWith("~/.automaton/")) {
        migrated = "~/.abos" + migrated.slice("~/.automaton".length);
      }
      if (
        migrated === LEGACY_AUTOMATON_DIR
        || migrated.startsWith(LEGACY_AUTOMATON_DIR + path.sep)
      ) {
        migrated = ABOS_DIR + migrated.slice(LEGACY_AUTOMATON_DIR.length);
      }

      if (migrated !== value) {
        raw[key] = migrated;
        changed = true;
      }
    }

    if (changed) {
      fs.writeFileSync(ABOS_CONFIG_FILE, JSON.stringify(raw, null, 2), {
        mode: 0o600,
      });
    }
  } catch (error: any) {
    throw new Error(
      `Legacy Automaton state moved to ~/.abos but its configuration could not be migrated safely: ${error?.message || String(error)}`,
    );
  }
}

/**
 * Preserve an existing Automaton identity during the ABOS rename.
 *
 * If only ~/.automaton exists, move the complete state directory atomically,
 * rename automaton.json -> abos.json, and rewrite known persisted paths.
 * If both directories exist and the legacy directory still owns a wallet while
 * ~/.abos does not, fail closed instead of generating or overwriting identity.
 */
export function migrateLegacyAutomatonStateIfNeeded(): boolean {
  if (legacyMigrationChecked) return false;
  legacyMigrationChecked = true;

  if (!fs.existsSync(LEGACY_AUTOMATON_DIR)) return false;

  if (fs.existsSync(ABOS_DIR)) {
    const abosWalletExists = fs.existsSync(WALLET_FILE);
    const legacyWalletExists = fs.existsSync(LEGACY_WALLET_FILE);
    const entries = fs.readdirSync(ABOS_DIR);

    if (entries.length === 0) {
      fs.rmdirSync(ABOS_DIR);
    } else {
      if (legacyWalletExists && !abosWalletExists) {
        throw new Error(
          "Refusing ABOS startup: legacy ~/.automaton contains an identity wallet while ~/.abos already exists without one. Resolve the state directories manually so ABOS cannot create or overwrite the wrong identity.",
        );
      }
      return false;
    }
  }

  const futureLegacyConfig = path.join(LEGACY_AUTOMATON_DIR, "abos.json");
  if (fs.existsSync(LEGACY_CONFIG_FILE) && fs.existsSync(futureLegacyConfig)) {
    throw new Error(
      "Refusing ABOS state migration: both automaton.json and abos.json exist in ~/.automaton.",
    );
  }

  fs.renameSync(LEGACY_AUTOMATON_DIR, ABOS_DIR);

  const movedLegacyConfig = path.join(ABOS_DIR, "automaton.json");
  if (fs.existsSync(movedLegacyConfig) && !fs.existsSync(ABOS_CONFIG_FILE)) {
    fs.renameSync(movedLegacyConfig, ABOS_CONFIG_FILE);
  }

  rewriteLegacyConfigPaths();
  return true;
}

export function getAbosDir(): string {
  migrateLegacyAutomatonStateIfNeeded();
  return ABOS_DIR;
}

export function getWalletPath(): string {
  migrateLegacyAutomatonStateIfNeeded();
  return WALLET_FILE;
}

/**
 * Generate a Solana Ed25519 keypair.
 * Returns the 64-byte secret key (first 32 = private, last 32 = public).
 */
export function generateSolanaKeypair(): { secretKey: Uint8Array; publicKey: Uint8Array; address: string } {
  const keypair = nacl.sign.keyPair();
  return {
    secretKey: keypair.secretKey,
    publicKey: keypair.publicKey,
    address: bs58.encode(keypair.publicKey),
  };
}

/**
 * Get or create the abos's wallet.
 * The private key IS the abos's identity -- protect it.
 *
 * @param chainType - If creating a new wallet, which chain to use. Defaults to "evm".
 */
export async function getWallet(chainType?: ChainType): Promise<{
  account: PrivateKeyAccount;
  chainIdentity: ChainIdentity;
  chainType: ChainType;
  isNew: boolean;
}> {
  migrateLegacyAutomatonStateIfNeeded();

  if (!fs.existsSync(ABOS_DIR)) {
    fs.mkdirSync(ABOS_DIR, { recursive: true, mode: 0o700 });
  }

  if (fs.existsSync(WALLET_FILE)) {
    const walletData: WalletData = JSON.parse(
      fs.readFileSync(WALLET_FILE, "utf-8"),
    );
    const resolvedChainType = walletData.chainType || "evm";

    if (resolvedChainType === "solana" && walletData.secretKey) {
      const secretKey = bs58.decode(walletData.secretKey);
      const solanaIdentity = new SolanaChainIdentity(secretKey);
      const account = createSolanaStubAccount(solanaIdentity.address);
      return { account, chainIdentity: solanaIdentity, chainType: "solana", isNew: false };
    }

    // EVM path (default)
    const account = privateKeyToAccount(walletData.privateKey!);
    return { account, chainIdentity: new EvmChainIdentity(account), chainType: "evm", isNew: false };
  }

  // Create new wallet
  const resolvedChain = chainType || "evm";

  if (resolvedChain === "solana") {
    const { secretKey, address } = generateSolanaKeypair();
    const solanaIdentity = new SolanaChainIdentity(secretKey);

    const walletData: WalletData = {
      chainType: "solana",
      secretKey: bs58.encode(secretKey),
      createdAt: new Date().toISOString(),
    };

    fs.writeFileSync(WALLET_FILE, JSON.stringify(walletData, null, 2), {
      mode: 0o600,
    });

    const account = createSolanaStubAccount(address);
    return { account, chainIdentity: solanaIdentity, chainType: "solana", isNew: true };
  }

  // EVM wallet
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);

  const walletData: WalletData = {
    chainType: "evm",
    privateKey,
    createdAt: new Date().toISOString(),
  };

  fs.writeFileSync(WALLET_FILE, JSON.stringify(walletData, null, 2), {
    mode: 0o600,
  });

  return { account, chainIdentity: new EvmChainIdentity(account), chainType: "evm", isNew: true };
}

/**
 * Get the wallet address without loading the full account.
 */
export function getWalletAddress(): string | null {\n  migrateLegacyAutomatonStateIfNeeded();
  if (!fs.existsSync(WALLET_FILE)) {
    return null;
  }

  const walletData: WalletData = JSON.parse(
    fs.readFileSync(WALLET_FILE, "utf-8"),
  );

  if (walletData.chainType === "solana" && walletData.secretKey) {
    const secretKey = bs58.decode(walletData.secretKey);
    const keypair = nacl.sign.keyPair.fromSecretKey(secretKey);
    return bs58.encode(keypair.publicKey);
  }

  const account = privateKeyToAccount(walletData.privateKey!);
  return account.address;
}

/**
 * Load the full wallet account (needed for signing).
 * For Solana wallets, returns a proxy account.
 */
export function loadWalletAccount(): PrivateKeyAccount | null {\n  migrateLegacyAutomatonStateIfNeeded();
  if (!fs.existsSync(WALLET_FILE)) {
    return null;
  }

  const walletData: WalletData = JSON.parse(
    fs.readFileSync(WALLET_FILE, "utf-8"),
  );

  if (walletData.chainType === "solana") {
    // Solana wallets don't have a PrivateKeyAccount; callers should use getWallet() instead
    return null;
  }

  return privateKeyToAccount(walletData.privateKey!);
}

/**
 * Get the chain type from the wallet file.
 */
export function getWalletChainType(): ChainType {\n  migrateLegacyAutomatonStateIfNeeded();
  if (!fs.existsSync(WALLET_FILE)) {
    return "evm";
  }
  try {
    const walletData: WalletData = JSON.parse(
      fs.readFileSync(WALLET_FILE, "utf-8"),
    );
    return walletData.chainType || "evm";
  } catch {
    return "evm";
  }
}

export function walletExists(): boolean {\n  migrateLegacyAutomatonStateIfNeeded();
  return fs.existsSync(WALLET_FILE);
}
