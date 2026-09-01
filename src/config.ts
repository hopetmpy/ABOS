/**
 * ABOS Configuration
 *
 * Loads and saves the abos's configuration from ~/.abos/abos.json
 */

import fs from "fs";
import path from "path";
import type { AbosConfig, TreasuryPolicy, ModelStrategyConfig, SoulConfig, AiConnectionConfig, CodexProviderConfig } from "./types.js";
import { DEFAULT_CONFIG, DEFAULT_TREASURY_POLICY, DEFAULT_MODEL_STRATEGY_CONFIG, DEFAULT_SOUL_CONFIG, DEFAULT_AI_CONNECTION_CONFIG, DEFAULT_CODEX_PROVIDER_CONFIG } from "./types.js";
import { getAbosDir } from "./identity/wallet.js";
import { loadApiKeyFromConfig } from "./identity/provision.js";
import { createLogger } from "./observability/logger.js";
import type { ChainType } from "./identity/chain.js";
import { expandHomePath } from "./platform/home.js";

const logger = createLogger("config");
const CONFIG_FILENAME = "abos.json";

export function getConfigPath(): string {
  return path.join(getAbosDir(), CONFIG_FILENAME);
}

/**
 * Load the abos config from disk.
 * Merges with defaults for any missing fields.
 */
export function loadConfig(): AbosConfig | null {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) {
    return null;
  }

  try {
    const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    const apiKey = raw.conwayApiKey || loadApiKeyFromConfig();

    // Deep-merge treasury policy with defaults
    const treasuryPolicy: TreasuryPolicy = {
      ...DEFAULT_TREASURY_POLICY,
      ...(raw.treasuryPolicy ?? {}),
    };

    // Validate all treasury values are positive numbers
    for (const [key, value] of Object.entries(treasuryPolicy)) {
      if (key === "x402AllowedDomains") continue; // array, not number
      if (typeof value === "number" && (value < 0 || !Number.isFinite(value))) {
        logger.warn(`Invalid treasury value for ${key}: ${value}, using default`);
        (treasuryPolicy as any)[key] = (DEFAULT_TREASURY_POLICY as any)[key];
      }
    }

    // Deep-merge model strategy config with defaults
    const modelStrategy: ModelStrategyConfig = {
      ...DEFAULT_MODEL_STRATEGY_CONFIG,
      ...(raw.modelStrategy ?? {}),
    };

    // Deep-merge soul config with defaults
    const soulConfig: SoulConfig = {
      ...DEFAULT_SOUL_CONFIG,
      ...(raw.soulConfig ?? {}),
    };

    // AI connection metadata is config state only; credentials remain with their
    // provider authority (for example Codex owns ChatGPT OAuth tokens).
    const codex: CodexProviderConfig = {
      ...DEFAULT_CODEX_PROVIDER_CONFIG,
      ...(raw.codex ?? {}),
    };
    const aiConnection: AiConnectionConfig = {
      ...DEFAULT_AI_CONNECTION_CONFIG,
      ...(raw.aiConnection ?? {}),
      connections:
        raw.aiConnection?.connections && typeof raw.aiConnection.connections === "object"
          ? { ...raw.aiConnection.connections }
          : undefined,
      active:
        raw.aiConnection?.active && typeof raw.aiConnection.active === "object"
          ? { ...raw.aiConnection.active }
          : undefined,
    };

    return {
      ...DEFAULT_CONFIG,
      ...raw,
      sandboxId:
        typeof raw.sandboxId === "string"
          ? raw.sandboxId.trim()
          : DEFAULT_CONFIG.sandboxId,
      conwayApiKey: apiKey,
      treasuryPolicy,
      modelStrategy,
      soulConfig,
      codex,
      aiConnection,
      chainType: raw.chainType || "evm",
    } as AbosConfig;
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to load existing ABOS config at ${configPath}: ${detail}`,
    );
  }
}

/**
 * Save the abos config to disk.
 * Includes treasuryPolicy in the persisted config.
 */
export function saveConfig(config: AbosConfig): void {
  const dir = getAbosDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  const configPath = getConfigPath();
  const toSave = {
    ...config,
    treasuryPolicy: config.treasuryPolicy ?? DEFAULT_TREASURY_POLICY,
    modelStrategy: config.modelStrategy ?? DEFAULT_MODEL_STRATEGY_CONFIG,
    soulConfig: config.soulConfig ?? DEFAULT_SOUL_CONFIG,
    codex: config.codex ?? DEFAULT_CODEX_PROVIDER_CONFIG,
    aiConnection: config.aiConnection ?? DEFAULT_AI_CONNECTION_CONFIG,
  };
  fs.writeFileSync(configPath, JSON.stringify(toSave, null, 2), {
    mode: 0o600,
  });
}

/**
 * Resolve ~ paths to absolute paths.
 */
export function resolvePath(p: string): string {
  const portable = p.replace(/\\/g, "/");

  if (portable === "~/.abos") {
    return getAbosDir();
  }
  if (portable.startsWith("~/.abos/")) {
    const relative = portable.slice("~/.abos/".length);
    return path.join(getAbosDir(), ...relative.split("/").filter(Boolean));
  }

  return expandHomePath(p);
}

/**
 * Create a fresh config from setup wizard inputs.
 */
export function createConfig(params: {
  name: string;
  genesisPrompt: string;
  creatorMessage?: string;
  creatorAddress: string;
  registeredWithConway: boolean;
  sandboxId: string;
  walletAddress: string;
  apiKey: string;
  openaiApiKey?: string;
  anthropicApiKey?: string;
  ollamaBaseUrl?: string;
  parentAddress?: string;
  treasuryPolicy?: TreasuryPolicy;
  chainType?: ChainType;
}): AbosConfig {
  const normalizedSandboxId = (params.sandboxId || "").trim();
  return {
    name: params.name,
    genesisPrompt: params.genesisPrompt,
    creatorMessage: params.creatorMessage,
    creatorAddress: params.creatorAddress,
    registeredWithConway: params.registeredWithConway,
    sandboxId: normalizedSandboxId,
    conwayApiUrl:
      DEFAULT_CONFIG.conwayApiUrl || "https://api.conway.tech",
    conwayApiKey: params.apiKey,
    openaiApiKey: params.openaiApiKey,
    anthropicApiKey: params.anthropicApiKey,
    ollamaBaseUrl: params.ollamaBaseUrl,
    codex: DEFAULT_CODEX_PROVIDER_CONFIG,
    aiConnection: DEFAULT_AI_CONNECTION_CONFIG,
    inferenceModel: DEFAULT_CONFIG.inferenceModel || "gpt-5.2",
    maxTokensPerTurn: DEFAULT_CONFIG.maxTokensPerTurn || 4096,
    heartbeatConfigPath:
      DEFAULT_CONFIG.heartbeatConfigPath || "~/.abos/heartbeat.yml",
    dbPath: DEFAULT_CONFIG.dbPath || "~/.abos/state.db",
    logLevel: (DEFAULT_CONFIG.logLevel as AbosConfig["logLevel"]) || "info",
    walletAddress: params.walletAddress,
    version: DEFAULT_CONFIG.version || "0.3.0",
    skillsDir: DEFAULT_CONFIG.skillsDir || "~/.abos/skills",
    maxChildren: DEFAULT_CONFIG.maxChildren || 3,
    parentAddress: params.parentAddress,
    treasuryPolicy: params.treasuryPolicy ?? DEFAULT_TREASURY_POLICY,
    chainType: params.chainType || "evm",
  };
}
