/**
 * Interactive / requested model selection.
 *
 * Model identity belongs to ModelRegistry. Connection adapters only constrain
 * which registered models are executable through the selected route and may
 * expose provider-native options (for example Codex reasoning effort).
 */

import chalk from "chalk";
import { loadConfig, saveConfig, resolvePath } from "../config.js";
import { createDatabase } from "../state/database.js";
import { ModelRegistry } from "../inference/registry.js";
import { discoverOllamaModels } from "../ollama/discover.js";
import type { ModelEntry, ModelStrategyConfig } from "../types.js";
import type { AiConnectionAdapter } from "../ai-connections/registry.js";
import { promptOptional, closePrompts } from "./prompts.js";
import { createBuiltinAiConnectionAdapterRegistry } from "./ai-connection-adapters.js";

export interface ModelPickerOptions {
  /** Explicit adapter when called from Connect AI. */
  adapter?: AiConnectionAdapter;
  /** Non-interactive model request for runtime hot switching. */
  requestedModel?: string;
  /** Provider-native options forwarded without core interpretation. */
  providerOptions?: Record<string, string | undefined>;
}

export async function runModelPicker(
  options: ModelPickerOptions = {},
): Promise<boolean> {
  const config = loadConfig();
  if (!config) {
    console.log(chalk.red("  ABOS is not configured. Run: abos --setup"));
    return false;
  }

  const dbPath = resolvePath(config.dbPath);
  const db = createDatabase(dbPath);

  try {
    const modelRegistry = new ModelRegistry(db.raw);
    modelRegistry.initialize();

    // Preserve the existing canonical Ollama discovery path.
    const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || config.ollamaBaseUrl;
    if (ollamaBaseUrl) {
      try {
        await discoverOllamaModels(ollamaBaseUrl, db.raw);
      } catch (error) {
        console.log(
          chalk.yellow(
            `  Ollama discovery unavailable: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
      }
    }

    const adapterRegistry = createBuiltinAiConnectionAdapterRegistry();
    let adapter = options.adapter;
    const activeProvider = config.aiConnection?.active?.provider;

    if (!adapter && activeProvider) {
      adapter = adapterRegistry.get(activeProvider);
      if (!adapter) {
        console.log(
          chalk.yellow(
            `  Active AI provider '${activeProvider}' is configured, but its adapter is not loaded in this runtime. This is currently unavailable, not impossible.`,
          ),
        );
        return false;
      }
    }

    if (adapter?.discoverModels) {
      try {
        await adapter.discoverModels(config, modelRegistry);
      } catch (error) {
        console.log(
          chalk.yellow(
            `  ${adapter.label} model discovery unavailable: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
      }
    }

    const allModels = modelRegistry.getAll().filter((model) => model.enabled);
    const models = adapter?.supportsModel
      ? allModels.filter((model) => adapter?.supportsModel?.(model))
      : allModels;

    if (models.length === 0) {
      console.log(
        chalk.yellow(
          adapter
            ? `  No registered models are currently available through ${adapter.label}.`
            : "  No models are currently available in ModelRegistry.",
        ),
      );
      return false;
    }

    let selected: ModelEntry | undefined;

    if (options.requestedModel) {
      selected = resolveRequestedModel(options.requestedModel, models);
      if (!selected) {
        console.log(
          chalk.red(
            `  Model '${options.requestedModel}' is not available through ${adapter?.label || "the current registry"}.`,
          ),
        );
        return false;
      }
    } else {
      console.log(chalk.cyan("\n  Available Models\n"));
      printModelTable(models, config.inferenceModel);

      console.log("");
      const input = await promptOptional("Enter model number (or press Enter to cancel)");
      if (!input) {
        console.log(chalk.dim("  Cancelled."));
        return false;
      }

      const index = Number.parseInt(input, 10) - 1;
      if (!Number.isInteger(index) || index < 0 || index >= models.length) {
        console.log(chalk.red(`  Invalid selection: "${input}"`));
        return false;
      }
      selected = models[index];
    }

    config.inferenceModel = selected.modelId;
    if (config.modelStrategy) {
      config.modelStrategy.inferenceModel = selected.modelId;

      // An explicit connection route must not later select a fallback model
      // that the same adapter cannot execute. Preserve compatible fallbacks;
      // otherwise collapse that slot to the explicitly selected model. The
      // compatibility decision belongs to the adapter, not a core provider
      // allowlist.
      reconcileAdapterFallbackModels(
        config.modelStrategy,
        selected,
        adapter,
        (modelId) => modelRegistry.get(modelId),
      );
    }

    if (adapter) {
      await adapter.configureModel?.(config, selected, options.providerOptions);
      const now = new Date().toISOString();
      const connectionId = config.aiConnection?.active?.provider === adapter.id
        ? config.aiConnection.active.connectionId || adapter.id
        : adapter.id;
      config.aiConnection = {
        ...(config.aiConnection || {}),
        connections: {
          ...(config.aiConnection?.connections || {}),
          [connectionId]: {
            id: connectionId,
            method: adapter.method,
            provider: adapter.id,
            configuredAt:
              config.aiConnection?.connections?.[connectionId]?.configuredAt || now,
          },
        },
        active: {
          connectionId,
          method: adapter.method,
          provider: adapter.id,
          updatedAt: now,
        },
      };
    }

    saveConfig(config);

    console.log(
      chalk.green(
        `\n  Active model set to: ${selected.modelId} (${selected.displayName})`,
      ),
    );
    if (adapter) {
      console.log(chalk.green(`  Active connection: ${adapter.method} → ${adapter.id}`));
    }
    console.log(chalk.dim("  Running ABOS processes pick up the route/model on the next inference turn.\n"));
    return true;
  } finally {
    db.close();
    closePrompts();
  }
}

export function reconcileAdapterFallbackModels(
  strategy: ModelStrategyConfig,
  selected: ModelEntry,
  adapter: Pick<AiConnectionAdapter, "supportsModel"> | undefined,
  getModel: (modelId: string) => ModelEntry | undefined,
): void {
  if (!adapter?.supportsModel) return;

  for (const key of ["lowComputeModel", "criticalModel"] as const) {
    const fallbackId = strategy[key];
    const fallback = fallbackId ? getModel(fallbackId) : undefined;
    if (!fallback || !adapter.supportsModel(fallback)) {
      strategy[key] = selected.modelId;
    }
  }
}

function resolveRequestedModel(
  requested: string,
  models: ModelEntry[],
): ModelEntry | undefined {
  const normalized = requested.trim();
  const exact = models.find((model) => model.modelId === normalized);
  if (exact) return exact;

  // Provider-qualified registries may expose "provider:model". Allow the
  // unqualified suffix only when it resolves uniquely inside the already
  // adapter-scoped candidate set.
  const suffixMatches = models.filter((model) => {
    const separator = model.modelId.indexOf(":");
    return separator >= 0 && model.modelId.slice(separator + 1) === normalized;
  });
  return suffixMatches.length === 1 ? suffixMatches[0] : undefined;
}

function printModelTable(models: ModelEntry[], currentModelId: string): void {
  const numWidth = String(models.length).length;

  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    const num = String(i + 1).padStart(numWidth);
    const provider = model.provider.padEnd(12);
    const cost = model.costPer1kInput === 0 && model.costPer1kOutput === 0
      ? chalk.green("external/free")
      : chalk.dim(
          `$${(model.costPer1kInput / 100 / 1000 * 1_000_000).toFixed(2)}/M in`,
        );
    const active = model.modelId === currentModelId ? chalk.green(" ◀ active") : "";
    const tools = model.supportsTools ? "" : chalk.dim(" (no tools)");

    console.log(
      `  ${chalk.white(num + ".")} ${chalk.cyan(model.modelId.padEnd(36))} ${chalk.dim(provider)} ${cost}${tools}${active}`,
    );
  }
}
