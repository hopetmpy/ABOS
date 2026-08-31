import fs from "fs";
import path from "path";
import type { AbosConfig, GenesisConfig } from "../types.js";
import { createConfig, loadConfig, saveConfig } from "../config.js";
import { getAbosDir, getWallet } from "../identity/wallet.js";
import { provision } from "../identity/provision.js";
import { writeDefaultHeartbeatConfig } from "../heartbeat/config.js";
import { detectEnvironment } from "./environment.js";
import { generateSoulMd, installDefaultSkills } from "./defaults.js";

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

/**
 * Complete non-interactive setup for a replicated child.
 *
 * A child receives genesis.json from its parent. It must never fall through to
 * the interactive first-run wizard because start_child launches it under nohup
 * without a TTY. This bootstrap intentionally reuses the same canonical config,
 * wallet, heartbeat, soul, and skill helpers as the interactive wizard.
 *
 * Returns:
 * - the existing config if setup already completed;
 * - null when this is not a parent-provisioned child;
 * - a newly persisted config after successful non-interactive bootstrap.
 *
 * Provisioning failure is fatal here. Persisting a config without a usable
 * Conway API key would only defer the failure until --run and leave a child
 * recorded as initialized when it cannot actually operate.
 */
export async function bootstrapFromGenesisIfPresent(): Promise<AbosConfig | null> {
  const existing = loadConfig();
  if (existing) return existing;

  const genesis = readGenesis();
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
