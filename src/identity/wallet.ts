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
import { getHomeDir } from "../platform/home.js";

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

const HOME_DIR = getHomeDir();
const ABOS_DIR = path.join(HOME_DIR, ".abos");
const LEGACY_AUTOMATON_DIR = path.join(HOME_DIR, ".automaton");
const WALLET_FILE = path.join(ABOS_DIR, "wallet.json");
const LEGACY_WALLET_FILE = path.join(LEGACY_AUTOMATON_DIR, "wallet.json");
const LEGACY_CONFIG_FILE = path.join(LEGACY_AUTOMATON_DIR, "automaton.json");
const ABOS_CONFIG_FILE = path.join(ABOS_DIR, "abos.json");

let legacyMigrationChecked = false;
let brokenRootFallbackMigrationChecked = false;
const LEGACY_RUNTIME_DIRNAME = "runtime";

/**
 * Early Windows runs inherited the historical "/root" fallback when HOME was
 * unset, which resolves to C:\\root on Windows. Preserve that identity by
 * moving the complete state directory to the platform-correct user home when
 * there is no competing ABOS state.
 */
function migrateBrokenRootFallbackStateIfNeeded(): boolean {
  if (brokenRootFallbackMigrationChecked) return false;

  // This migration is only relevant when HOME was absent and Windows-style
  // USERPROFILE resolution is what corrected the state root.
  if (process.env.HOME || !process.env.USERPROFILE) {
    brokenRootFallbackMigrationChecked = true;
    return false;
  }

  const brokenDir = path.resolve("/root/.abos");
  if (
    path.resolve(brokenDir) === path.resolve(ABOS_DIR)
    || !fs.existsSync(brokenDir)
  ) {
    brokenRootFallbackMigrationChecked = true;
    return false;
  }

  const brokenEntries = fs.readdirSync(brokenDir);
  if (brokenEntries.length === 0) {
    try {
      fs.rmdirSync(brokenDir);
    } catch {}
    brokenRootFallbackMigrationChecked = true;
    return false;
  }

  if (!fs.existsSync(ABOS_DIR)) {
    fs.mkdirSync(path.dirname(ABOS_DIR), { recursive: true });
    fs.renameSync(brokenDir, ABOS_DIR);
    try {
      fs.chmodSync(ABOS_DIR, 0o700);
    } catch {}
    brokenRootFallbackMigrationChecked = true;
    return true;
  }

  const targetEntries = fs.readdirSync(ABOS_DIR);
  if (targetEntries.length === 0) {
    fs.rmdirSync(ABOS_DIR);
    fs.renameSync(brokenDir, ABOS_DIR);
    try {
      fs.chmodSync(ABOS_DIR, 0o700);
    } catch {}
    brokenRootFallbackMigrationChecked = true;
    return true;
  }

  // A current wallet wins. Leave the historical fallback untouched so no
  // identity is silently overwritten.
  if (fs.existsSync(WALLET_FILE)) {
    brokenRootFallbackMigrationChecked = true;
    return false;
  }

  throw new Error(
    "Refusing ABOS startup: state exists in both the corrected user home and the historical /root fallback. Resolve the directories manually so ABOS cannot merge or overwrite identities.",
  );
}

function migratePersistedPath(value: string): string {
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
  return migrated;
}

function prepareMigratedLegacyConfig(sourcePath: string): string {
  try {
    const raw = JSON.parse(fs.readFileSync(sourcePath, "utf-8")) as Record<string, unknown>;

    for (const key of ["heartbeatConfigPath", "dbPath", "skillsDir"] as const) {
      const value = raw[key];
      if (typeof value === "string") {
        raw[key] = migratePersistedPath(value);
      }
    }

    return JSON.stringify(raw, null, 2);
  } catch (error: any) {
    throw new Error(
      `Refusing ABOS state migration: legacy Automaton configuration is invalid or cannot be migrated safely: ${error?.message || String(error)}`,
    );
  }
}

/**
 * Preserve an existing Automaton identity during the ABOS rename.
 *
 * State and runtime are deliberately separated. Historical installers placed
 * executable source in ~/.automaton/runtime, while an early ABOS installer
 * could place source in ~/.abos/runtime. Neither runtime directory is identity
 * state and neither is moved/overwritten here.
 *
 * Migration is fail-closed:
 * - an existing ABOS wallet always wins and legacy state is left untouched;
 * - a non-runtime ABOS state directory is never merged with legacy state;
 * - legacy config is parsed and rewritten before any state is moved;
 * - source/target collisions are rejected before mutation;
 * - moved entries are rolled back if a filesystem move fails.
 */
export function migrateLegacyAutomatonStateIfNeeded(): boolean {
  migrateBrokenRootFallbackStateIfNeeded();
  if (legacyMigrationChecked) return false;

  if (!fs.existsSync(LEGACY_AUTOMATON_DIR)) {
    legacyMigrationChecked = true;
    return false;
  }

  const abosWalletExists = fs.existsSync(WALLET_FILE);
  if (abosWalletExists) {
    legacyMigrationChecked = true;
    return false;
  }

  const futureLegacyConfig = path.join(LEGACY_AUTOMATON_DIR, "abos.json");
  if (fs.existsSync(LEGACY_CONFIG_FILE) && fs.existsSync(futureLegacyConfig)) {
    throw new Error(
      "Refusing ABOS state migration: both automaton.json and abos.json exist in ~/.automaton.",
    );
  }

  const legacyConfigPath = fs.existsSync(LEGACY_CONFIG_FILE)
    ? LEGACY_CONFIG_FILE
    : fs.existsSync(futureLegacyConfig)
      ? futureLegacyConfig
      : null;
  const migratedConfigContent = legacyConfigPath
    ? prepareMigratedLegacyConfig(legacyConfigPath)
    : null;

  const legacyEntries = fs
    .readdirSync(LEGACY_AUTOMATON_DIR)
    .filter((entry) => entry !== LEGACY_RUNTIME_DIRNAME)
    .filter((entry) => !legacyConfigPath || path.join(LEGACY_AUTOMATON_DIR, entry) !== legacyConfigPath);

  const hasLegacyState = legacyEntries.length > 0 || migratedConfigContent !== null;
  if (!hasLegacyState) {
    legacyMigrationChecked = true;
    return false;
  }

  if (fs.existsSync(ABOS_DIR)) {
    const existingStateEntries = fs
      .readdirSync(ABOS_DIR)
      .filter((entry) => entry !== LEGACY_RUNTIME_DIRNAME);

    if (existingStateEntries.length > 0) {
      throw new Error(
        "Refusing ABOS startup: legacy ~/.automaton state exists while ~/.abos already contains non-runtime state. Resolve the state directories manually so ABOS cannot merge or overwrite identities.",
      );
    }
  }

  // Preflight every target before moving anything.
  for (const entry of legacyEntries) {
    const target = path.join(ABOS_DIR, entry);
    if (fs.existsSync(target)) {
      throw new Error(
        `Refusing ABOS state migration: target already exists: ${target}`,
      );
    }
  }
  if (migratedConfigContent !== null && fs.existsSync(ABOS_CONFIG_FILE)) {
    throw new Error(
      "Refusing ABOS state migration: ~/.abos/abos.json already exists.",
    );
  }

  if (!fs.existsSync(ABOS_DIR)) {
    fs.mkdirSync(ABOS_DIR, { recursive: true, mode: 0o700 });
  }
  // Early installers may have created ~/.abos as a parent for runtime source.
  // Once identity/state is stored here, enforce private directory permissions.
  try {
    fs.chmodSync(ABOS_DIR, 0o700);
  } catch {}

  const moved: Array<{ source: string; target: string }> = [];
  let wroteConfig = false;

  try {
    for (const entry of legacyEntries) {
      const source = path.join(LEGACY_AUTOMATON_DIR, entry);
      const target = path.join(ABOS_DIR, entry);
      fs.renameSync(source, target);
      moved.push({ source, target });
    }

    if (legacyConfigPath && migratedConfigContent !== null) {
      fs.writeFileSync(ABOS_CONFIG_FILE, migratedConfigContent, { mode: 0o600 });
      wroteConfig = true;
      fs.rmSync(legacyConfigPath);
    }
  } catch (error: any) {
    if (wroteConfig) {
      try {
        fs.rmSync(ABOS_CONFIG_FILE, { force: true });
      } catch {}
    }

    for (const entry of moved.reverse()) {
      try {
        if (fs.existsSync(entry.target) && !fs.existsSync(entry.source)) {
          fs.renameSync(entry.target, entry.source);
        }
      } catch {}
    }

    throw new Error(
      `ABOS state migration failed and was rolled back where possible: ${error?.message || String(error)}`,
    );
  }

  // Remove the legacy directory only when no historical runtime remains.
  try {
    if (fs.readdirSync(LEGACY_AUTOMATON_DIR).length === 0) {
      fs.rmdirSync(LEGACY_AUTOMATON_DIR);
    }
  } catch {}

  legacyMigrationChecked = true;
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
export function getWalletAddress(): string | null {
  migrateLegacyAutomatonStateIfNeeded();
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
export function loadWalletAccount(): PrivateKeyAccount | null {
  migrateLegacyAutomatonStateIfNeeded();
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
export function getWalletChainType(): ChainType {
  migrateLegacyAutomatonStateIfNeeded();
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

export function walletExists(): boolean {
  migrateLegacyAutomatonStateIfNeeded();
  return fs.existsSync(WALLET_FILE);
}
