import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import type { AbosConfig, GenesisConfig } from "../types.js";
import { createConfig, loadConfig, resolvePath, saveConfig } from "../config.js";
import { getAbosDir, getWallet } from "../identity/wallet.js";
import { provision } from "../identity/provision.js";
import { writeDefaultHeartbeatConfig } from "../heartbeat/config.js";
import { detectEnvironment } from "./environment.js";
import { generateSoulMd, installDefaultSkills } from "./defaults.js";
import { createDatabase } from "../state/database.js";
import {
  FAMILY_KNOWLEDGE_HASH_PATH,
  FAMILY_KNOWLEDGE_PATH,
  FAMILY_KNOWLEDGE_RECEIPT_PATH,
  importFamilyKnowledgeBundle,
} from "../replication/family-knowledge.js";

function readGenesis(): GenesisConfig | null {
  const genesisPath = path.join(getAbosDir(), "genesis.json");
  if (!fs.existsSync(genesisPath)) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(genesisPath, "utf-8"));
  } catch (error: any) {
    throw new Error(
      `Invalid ABOS genesis.json: ${error?.message || String(error)}`,
    );
  }

  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid ABOS genesis.json: expected an object");
  }

  const genesis = raw as Partial<GenesisConfig>;
  if (
    typeof genesis.name !== "string" ||
    !genesis.name.trim() ||
    typeof genesis.genesisPrompt !== "string" ||
    !genesis.genesisPrompt.trim() ||
    typeof genesis.creatorAddress !== "string" ||
    !genesis.creatorAddress.trim() ||
    typeof genesis.parentAddress !== "string" ||
    !genesis.parentAddress.trim()
  ) {
    throw new Error(
      "Invalid ABOS genesis.json: name, genesisPrompt, creatorAddress, and parentAddress are required",
    );
  }

  if (
    genesis.chainType !== undefined &&
    genesis.chainType !== "evm" &&
    genesis.chainType !== "solana"
  ) {
    throw new Error(
      `Invalid ABOS genesis.json chainType: ${String(genesis.chainType)}`,
    );
  }

  return genesis as GenesisConfig;
}

function localAbosPath(remotePath: string): string {
  const prefix = "/root/.abos/";
  if (!remotePath.startsWith(prefix)) {
    throw new Error(`Unsupported child bootstrap path: ${remotePath}`);
  }
  return path.join(getAbosDir(), remotePath.slice(prefix.length));
}

function assertExistingConfigMatchesGenesis(
  existing: AbosConfig,
  genesis: GenesisConfig,
): void {
  const chainType = genesis.chainType || "evm";
  if (
    existing.name !== genesis.name ||
    existing.creatorAddress !== genesis.creatorAddress ||
    existing.parentAddress !== genesis.parentAddress ||
    (existing.chainType || "evm") !== chainType
  ) {
    throw new Error(
      "Existing child config does not match current genesis lineage; refusing stale sandbox bootstrap reuse",
    );
  }
}

function writeProtectedReceipt(receiptPath: string, content: string): void {
  // A previous successful bootstrap may have left the receipt read-only. The
  // file is owned by this child runtime, so make it writable only for the
  // duration of the idempotent refresh, then restore defense-in-depth mode.
  if (fs.existsSync(receiptPath)) {
    try {
      fs.chmodSync(receiptPath, 0o600);
    } catch {
      // Windows/filesystems without POSIX modes can still overwrite normally.
    }
  }

  fs.writeFileSync(receiptPath, content, { mode: 0o600 });
  try {
    fs.chmodSync(receiptPath, 0o444);
  } catch {
    // Receipt immutability is defense-in-depth; parent-side hash/lineage
    // verification remains the causal gate.
  }
}

function applyFamilyKnowledgeBootstrap(
  config: AbosConfig,
  genesis: GenesisConfig,
): void {
  const bundlePath = localAbosPath(FAMILY_KNOWLEDGE_PATH);
  const hashPath = localAbosPath(FAMILY_KNOWLEDGE_HASH_PATH);
  const receiptPath = localAbosPath(FAMILY_KNOWLEDGE_RECEIPT_PATH);

  if (!fs.existsSync(bundlePath) || !fs.existsSync(hashPath)) {
    throw new Error(
      "Replicated child bootstrap is missing family knowledge bundle/hash",
    );
  }

  const raw = fs.readFileSync(bundlePath, "utf-8");
  const expectedHash = fs.readFileSync(hashPath, "utf-8").trim();
  const actualHash = createHash("sha256").update(raw, "utf-8").digest("hex");
  if (!expectedHash || actualHash !== expectedHash) {
    throw new Error(
      `Family knowledge bootstrap hash mismatch: expected ${expectedHash || "<missing>"}, got ${actualHash}`,
    );
  }

  const db = createDatabase(resolvePath(config.dbPath));
  try {
    const receipt = importFamilyKnowledgeBundle(
      db,
      raw,
      genesis.parentAddress,
      config.walletAddress,
    );
    if (receipt.bundleHash !== expectedHash) {
      throw new Error(
        `Family knowledge imported hash ${receipt.bundleHash} does not match materialized hash ${expectedHash}`,
      );
    }

    writeProtectedReceipt(receiptPath, JSON.stringify(receipt, null, 2));
  } finally {
    db.close();
  }
}

/**
 * Complete non-interactive setup for a replicated child.
 *
 * A child receives genesis.json from its parent. It must never fall through to
 * the interactive first-run wizard because start_child launches it under nohup
 * without a TTY. This bootstrap intentionally reuses the same canonical config,
 * wallet, heartbeat, soul, skill, and KnowledgeStore helpers as the interactive
 * runtime rather than creating parallel authorities.
 *
 * Returns:
 * - the existing config if setup already completed and matches current genesis;
 * - null when this is not a parent-provisioned child;
 * - a newly persisted config after successful non-interactive bootstrap.
 *
 * Provisioning or Family Knowledge import failure is fatal. The new config is
 * persisted only after required family context has imported successfully, so a
 * failed gate cannot leave a runnable-looking abos.json behind.
 */
export async function bootstrapFromGenesisIfPresent(): Promise<AbosConfig | null> {
  const genesis = readGenesis();
  const existing = loadConfig();

  if (existing) {
    if (!genesis) return existing;
    assertExistingConfigMatchesGenesis(existing, genesis);
    applyFamilyKnowledgeBootstrap(existing, genesis);
    return existing;
  }

  if (!genesis) return null;

  const requestedChain = genesis.chainType || "evm";
  const {
    chainIdentity,
    chainType,
  } = await getWallet(requestedChain);
  const walletAddress = chainIdentity.address;

  const provisioned = await provision(
    undefined,
    chainType === "solana" ? chainIdentity : undefined,
  );

  if (!provisioned.apiKey) {
    throw new Error("ABOS child provisioning returned an empty API key");
  }

  const env = detectEnvironment();
  const config = createConfig({
    name: genesis.name,
    genesisPrompt: genesis.genesisPrompt,
    creatorMessage: genesis.creatorMessage,
    creatorAddress: genesis.creatorAddress,
    registeredWithConway: true,
    sandboxId: env.sandboxId,
    walletAddress,
    apiKey: provisioned.apiKey,
    parentAddress: genesis.parentAddress,
    chainType,
  });

  // Required inherited context is imported before publishing a runnable config.
  // A failed import may leave an inert DB file, but never abos.json.
  applyFamilyKnowledgeBootstrap(config, genesis);
  saveConfig(config);
  writeDefaultHeartbeatConfig();

  const abosDir = getAbosDir();
  const soulPath = path.join(abosDir, "SOUL.md");
  if (!fs.existsSync(soulPath)) {
    fs.writeFileSync(
      soulPath,
      generateSoulMd(
        config.name,
        walletAddress,
        config.creatorAddress,
        config.genesisPrompt,
      ),
      { mode: 0o600 },
    );
  }

  installDefaultSkills(config.skillsDir || "~/.abos/skills");

  return config;
}
