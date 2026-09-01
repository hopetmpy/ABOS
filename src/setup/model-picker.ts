/**
 * Interactive Model Picker
 *
 * Presents a numbered list of available models and lets the user
 * pick one to set as the active inference model.
 *
 * Usage: abos --pick-model
 */

import chalk from "chalk";
import { loadConfig, saveConfig, resolvePath } from "../config.js";
import { createDatabase } from "../state/database.js";
import { ModelRegistry } from "../inference/registry.js";
import { discoverOllamaModels } from "../ollama/discover.js";
import {
  loadCodexCatalog,
  refreshCodexCatalog,
  syncCodexCatalogToRegistry,
} from "../codex/catalog.js";
import { CodexSessionManager } from "../codex/session-manager.js";
import { stripCodexRegistryPrefix } from "../codex/inference.js";
import { DEFAULT_MODEL_STRATEGY_CONFIG } from "../types.js";
import type {
  AbosConfig,
  AiConnectionMethod,
  AiRuntimeProvider,
  ModelEntry,
  ModelProvider,
} from "../types.js";
import { promptOptional, closePrompts } from "./prompts.js";
import { getAiProviderByRuntimeProvider } from "./ai-connection-registry.js";

const PROVIDER_LABEL: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  conway: "Conway",
  ollama: "Ollama",
  codex: "Codex",
  other: "Other",
};

export async function runModelPicker(
  requestedModel?: string,
  requestedReasoning?: string,
  providerFilters?: ModelProvider[],
  connectionProvider?: AiRuntimeProvider,
): Promise<boolean> {
  const config = loadConfig();
  if (!config) {
    console.log(chalk.red("  ABOS is not configured. Run: abos --setup"));
    return false;
  }

  const dbPath = resolvePath(config.dbPath);
  const db = createDatabase(dbPath);

  // Seed static baseline + discover Ollama models
  const registry = new ModelRegistry(db.raw);
  registry.initialize();

  const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || config.ollamaBaseUrl;
  if (ollamaBaseUrl) {
    console.log(chalk.dim(`  Checking Ollama at ${ollamaBaseUrl}...`));
    await discoverOllamaModels(ollamaBaseUrl, db.raw);
  }

  let codexCatalog = loadCodexCatalog();
  if (config.codex?.enabled) {
    try {
      console.log(chalk.dim("  Refreshing Codex model catalog..."));
      codexCatalog = await refreshCodexCatalog(
        new CodexSessionManager(),
        config.codex.includeHiddenModels ?? false,
      );
    } catch (error) {
      console.log(
        chalk.yellow(
          `  Codex catalog refresh unavailable; using cache if present: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    }
    if (codexCatalog) syncCodexCatalogToRegistry(registry, codexCatalog);
  }

  const allModels = registry.getAll().filter((m) => m.enabled);

  const activeConnectionProvider =
    connectionProvider ?? config.aiConnection?.active?.provider;
  const activeDefinition = activeConnectionProvider
    ? getAiProviderByRuntimeProvider(activeConnectionProvider)
    : undefined;
  const effectiveProviderFilters =
    providerFilters && providerFilters.length > 0
      ? providerFilters
      : activeDefinition?.modelProviders;

  const models =
    effectiveProviderFilters && effectiveProviderFilters.length > 0
      ? allModels.filter((model) => effectiveProviderFilters.includes(model.provider))
      : allModels;

  if (models.length === 0) {
    const scope = effectiveProviderFilters?.length
      ? ` for provider(s): ${effectiveProviderFilters.join(", ")}`
      : "";
    console.log(chalk.yellow(`  No registered models available${scope}.`));
    db.close();
    closePrompts();
    return false;
  }

  if (requestedModel) {
    let selected: ModelEntry;
    try {
      selected = resolveRequestedModel(models, requestedModel);
    } catch (error) {
      console.log(chalk.red(`  ${error instanceof Error ? error.message : String(error)}`));
      db.close();
      closePrompts();
      return false;
    }
    try {
      await applyModelSelection(
        config,
        selected,
        codexCatalog,
        requestedReasoning,
        false,
        activeConnectionProvider,
      );
    } catch (error) {
      console.log(chalk.red(`  ${error instanceof Error ? error.message : String(error)}`));
      db.close();
      closePrompts();
      return false;
    }
    saveConfig(config);
    console.log(chalk.green(`\n  Active model set to: ${selected.modelId} (${selected.displayName})`));
    if (selected.provider === "codex" && config.codex?.reasoningEffort) {
      console.log(chalk.green(`  Reasoning: ${config.codex.reasoningEffort}`));
    }
    console.log(chalk.dim("  The running ABOS process will use this selection on its next inference turn.\n"));
    db.close();
    closePrompts();
    return true;
  }

  console.log(chalk.cyan("\n  Available Models\n"));
  printModelTable(models, config.inferenceModel);

  console.log("");
  const input = await promptOptional("Enter model number (or press Enter to cancel)");

  if (!input) {
    console.log(chalk.dim("  Cancelled."));
    db.close();
    closePrompts();
    return false;
  }

  const idx = parseInt(input, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= models.length) {
    console.log(chalk.red(`  Invalid selection: "${input}"`));
    db.close();
    closePrompts();
    return false;
  }

  const selected = models[idx];
  await applyModelSelection(
    config,
    selected,
    codexCatalog,
    requestedReasoning,
    true,
    activeConnectionProvider,
  );
  saveConfig(config);
  closePrompts();

  console.log(chalk.green(`\n  Active model set to: ${selected.modelId} (${selected.displayName})`));
  console.log(chalk.dim("  The running ABOS process will use this selection on its next inference turn.\n"));

  db.close();
  return true;
}

function printModelTable(models: ModelEntry[], currentModelId: string): void {
  const numWidth = String(models.length).length;

  for (let i = 0; i < models.length; i++) {
    const m = models[i];
    const num = String(i + 1).padStart(numWidth);
    const provider = (PROVIDER_LABEL[m.provider] || m.provider).padEnd(9);
    const displayModelId = m.provider === "codex"
      ? stripCodexRegistryPrefix(m.modelId)
      : m.modelId;
    const cost = m.provider === "codex"
      ? chalk.dim("external ")
      : m.costPer1kInput === 0
        ? chalk.green("free     ")
        : chalk.dim(`${(m.costPer1kInput / 100 / 1000 * 1_000_000).toFixed(2)}/M in`);
    const active = m.modelId === currentModelId ? chalk.green(" ◀ active") : "";
    const tools = m.supportsTools ? "" : chalk.dim(" (no tools)");

    console.log(
      `  ${chalk.white(num + ".")} ${chalk.cyan(displayModelId.padEnd(32))} ${chalk.dim(provider)} ${cost}${tools}${active}`,
    );
  }
}


export function resolveRequestedModel(models: ModelEntry[], requested: string): ModelEntry {
  const normalized = requested.trim();
  if (!normalized) throw new Error("Model id cannot be empty");

  const matches = models.filter((model) => {
    if (model.modelId === normalized) return true;
    return model.provider === "codex" && stripCodexRegistryPrefix(model.modelId) === normalized;
  });

  if (matches.length === 0) {
    throw new Error(
      `Unknown model '${normalized}'. Run 'abos --pick-model' or 'abos --codex-models' to inspect available models.`,
    );
  }

  if (matches.length > 1) {
    const ids = matches.map((model) => model.modelId).join(", ");
    throw new Error(
      `Model '${normalized}' is ambiguous across providers (${ids}). Use the provider-qualified model id.`,
    );
  }

  return matches[0];
}

async function applyModelSelection(
  config: AbosConfig,
  selected: ModelEntry,
  codexCatalog: ReturnType<typeof loadCodexCatalog>,
  requestedReasoning: string | undefined,
  interactive: boolean,
  connectionProvider?: AiRuntimeProvider,
): Promise<void> {
  config.inferenceModel = selected.modelId;
  config.modelStrategy = {
    ...DEFAULT_MODEL_STRATEGY_CONFIG,
    ...(config.modelStrategy || {}),
    inferenceModel: selected.modelId,
  };

  const selectedConnectionProvider =
    connectionProvider ||
    (selected.provider === "codex" || selected.provider === "ollama"
      ? selected.provider
      : undefined);
  if (selectedConnectionProvider) {
    config.aiConnection = {
      ...(config.aiConnection || {}),
      active: {
        method: connectionMethodForProvider(selectedConnectionProvider),
        provider: selectedConnectionProvider,
        updatedAt: new Date().toISOString(),
      },
    };
  }

  if (selected.provider !== "codex") return;

  const actualModel = stripCodexRegistryPrefix(selected.modelId);
  const descriptor = codexCatalog?.models.find((model) => model.model === actualModel);
  config.codex = {
    enabled: true,
    includeHiddenModels: config.codex?.includeHiddenModels ?? false,
    ...config.codex,
    selectedModel: actualModel,
  };

  const efforts = descriptor?.supportedReasoningEfforts || [];
  if (requestedReasoning) {
    if (
      efforts.length > 0 &&
      !efforts.some((effort) => effort.reasoningEffort === requestedReasoning)
    ) {
      throw new Error(
        `Reasoning effort '${requestedReasoning}' is not advertised for ${actualModel}. Available: ${efforts.map((effort) => effort.reasoningEffort).join(", ")}`,
      );
    }
    config.codex.reasoningEffort = requestedReasoning;
    return;
  }

  if (!interactive || efforts.length === 0) {
    const existing = config.codex.reasoningEffort;
    const existingIsValid = existing && (
      efforts.length === 0 ||
      efforts.some((effort) => effort.reasoningEffort === existing)
    );
    config.codex.reasoningEffort = existingIsValid
      ? existing
      : descriptor?.defaultReasoningEffort || efforts[0]?.reasoningEffort;
    return;
  }

  console.log(chalk.cyan("\n  Reasoning Effort\n"));
  efforts.forEach((effort, i) => {
    const active = effort.reasoningEffort === config.codex?.reasoningEffort
      ? chalk.green(" ◀ active")
      : "";
    console.log(`  ${i + 1}. ${effort.reasoningEffort} - ${effort.description}${active}`);
  });
  const effortInput = await promptOptional(
    `Enter reasoning number [default: ${descriptor?.defaultReasoningEffort || efforts[0].reasoningEffort}]`,
  );
  const effortIndex = effortInput ? parseInt(effortInput, 10) - 1 : -1;
  config.codex.reasoningEffort =
    effortIndex >= 0 && effortIndex < efforts.length
      ? efforts[effortIndex].reasoningEffort
      : descriptor?.defaultReasoningEffort || config.codex.reasoningEffort || efforts[0].reasoningEffort;
}


function connectionMethodForProvider(provider: AiRuntimeProvider): AiConnectionMethod {
  if (provider === "codex") return "oauth";
  if (provider === "ollama") return "local";
  return "api_key";
}
