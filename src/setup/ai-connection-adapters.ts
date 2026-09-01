import chalk from "chalk";
import { saveConfig } from "../config.js";
import {
  AiConnectionAdapterRegistry,
  type AiConnectionAdapter,
} from "../ai-connections/registry.js";
import type { AbosConfig, ModelEntry } from "../types.js";
import { promptOptional } from "./prompts.js";
import { connectCodex, disconnectCodex } from "../codex/commands.js";
import {
  findCodexModel,
  loadCodexCatalog,
  refreshCodexCatalog,
  syncCodexCatalogToRegistry,
} from "../codex/catalog.js";
import { CodexSessionManager } from "../codex/session-manager.js";
import { stripCodexRegistryPrefix } from "../codex/inference.js";
import { discoverOllamaModels } from "../ollama/discover.js";

async function promptSecretReplacement(
  label: string,
  existing: string | undefined,
): Promise<string | undefined> {
  if (existing) {
    console.log(chalk.dim("  A credential is already configured. Press Enter to keep it."));
  }
  const value = await promptOptional(label);
  if (value) return value;
  if (existing) return existing;
  console.log(chalk.yellow("  No credential entered; connection cancelled."));
  return undefined;
}

function apiKeyAdapter(options: {
  id: string;
  label: string;
  description: string;
  read: (config: AbosConfig) => string | undefined;
  write: (config: AbosConfig, value: string) => void;
  prompt: string;
  supportsModel: (model: ModelEntry) => boolean;
}): AiConnectionAdapter {
  return {
    id: options.id,
    method: "api_key",
    label: options.label,
    description: options.description,
    availability: (config) => options.read(config) ? "available" : "unavailable",
    supportsModel: options.supportsModel,
    connect: async (config) => {
      const key = await promptSecretReplacement(options.prompt, options.read(config));
      if (!key) return { configured: false };
      options.write(config, key);
      saveConfig(config);
      return { configured: true };
    },
  };
}

export function createBuiltinAiConnectionAdapterRegistry(): AiConnectionAdapterRegistry {
  const registry = new AiConnectionAdapterRegistry();

  registry.register({
    id: "codex",
    method: "oauth",
    label: "ChatGPT / Codex",
    description: "Provider-managed ChatGPT device-code session through the official Codex app-server.",
    // enabled records last known configuration, not a live account assertion.
    availability: (config) => config.codex?.enabled ? "unknown" : "unavailable",
    supportsModel: (model) => model.provider === "codex",
    connect: async (config) => ({
      configured: true,
      discoveredModels: await connectCodex(config),
    }),
    disconnect: disconnectCodex,
    discoverModels: async (config, modelRegistry) => {
      const manager = new CodexSessionManager();
      let snapshot = loadCodexCatalog();
      try {
        snapshot = await refreshCodexCatalog(
          manager,
          config.codex?.includeHiddenModels ?? false,
        );
      } catch (error) {
        if (!snapshot) throw error;
      }
      if (!snapshot) return 0;
      syncCodexCatalogToRegistry(modelRegistry, snapshot);
      return snapshot.models.length;
    },
    configureModel: async (config, model) => {
      const actualModel = stripCodexRegistryPrefix(model.modelId);
      const snapshot = loadCodexCatalog();
      const descriptor = snapshot
        ? findCodexModel(snapshot.models, actualModel)
        : undefined;
      const efforts = descriptor?.supportedReasoningEfforts ?? [];

      config.codex = {
        enabled: true,
        includeHiddenModels: config.codex?.includeHiddenModels ?? false,
        ...config.codex,
        selectedModel: actualModel,
      };

      if (efforts.length > 0) {
        console.log(chalk.cyan("\n  Reasoning Effort\n"));
        efforts.forEach((effort, index) => {
          const active = effort.reasoningEffort === config.codex?.reasoningEffort
            ? chalk.green(" ◀ current")
            : "";
          console.log(`  ${index + 1}. ${effort.reasoningEffort} - ${effort.description}${active}`);
        });
        const input = await promptOptional(
          `Select reasoning [default: ${descriptor?.defaultReasoningEffort || efforts[0].reasoningEffort}]`,
        );
        const selectedIndex = Number.parseInt(input, 10) - 1;
        config.codex.reasoningEffort =
          selectedIndex >= 0 && selectedIndex < efforts.length
            ? efforts[selectedIndex].reasoningEffort
            : descriptor?.defaultReasoningEffort
              || config.codex.reasoningEffort
              || efforts[0].reasoningEffort;
      }

      saveConfig(config);
    },
  });

  registry.register(apiKeyAdapter({
    id: "openai",
    label: "OpenAI",
    description: "Direct OpenAI API credential.",
    read: (config) => config.openaiApiKey,
    write: (config, value) => { config.openaiApiKey = value; },
    prompt: "OpenAI API key (sk-...)",
    supportsModel: (model) => model.provider === "openai",
  }));

  registry.register(apiKeyAdapter({
    id: "anthropic",
    label: "Anthropic",
    description: "Direct Anthropic API credential.",
    read: (config) => config.anthropicApiKey,
    write: (config, value) => { config.anthropicApiKey = value; },
    prompt: "Anthropic API key (sk-ant-...)",
    supportsModel: (model) => model.provider === "anthropic",
  }));

  registry.register(apiKeyAdapter({
    id: "conway",
    label: "Conway",
    description: "Use the Conway inference route with the existing or supplied Conway credential.",
    read: (config) => config.conwayApiKey,
    write: (config, value) => { config.conwayApiKey = value; },
    prompt: "Conway API key (cnwy_k_...)",
    // Conway can proxy multiple model owners; exclude provider-native routes
    // that require a distinct runtime/session.
    supportsModel: (model) => model.provider !== "codex" && model.provider !== "ollama",
  }));

  registry.register({
    id: "ollama",
    method: "local",
    label: "Ollama",
    description: "Local/self-hosted Ollama runtime.",
    availability: (config) => config.ollamaBaseUrl ? "available" : "unavailable",
    supportsModel: (model) => model.provider === "ollama",
    connect: async (config) => {
      const input = await promptOptional(
        `Ollama base URL [${config.ollamaBaseUrl || "http://localhost:11434"}]`,
      );
      config.ollamaBaseUrl = input || config.ollamaBaseUrl || "http://localhost:11434";
      saveConfig(config);
      return { configured: true };
    },
    discoverModels: async (config, modelRegistry) => {
      const baseUrl = config.ollamaBaseUrl;
      if (!baseUrl) return 0;
      // discoverOllamaModels writes to the same DB authority used by ModelRegistry.
      const db = (modelRegistry as unknown as { db?: unknown }).db;
      if (!db) return 0;
      await discoverOllamaModels(baseUrl, db as any);
      return modelRegistry.getAll().filter((model) => model.provider === "ollama").length;
    },
  });

  return registry;
}
