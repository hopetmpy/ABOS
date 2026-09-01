import chalk from "chalk";
import { loadConfig, saveConfig } from "../config.js";
import type {
  AbosConfig,
  AiConnectionMethod,
  AiRuntimeProvider,
} from "../types.js";
import { connectCodex } from "../codex/commands.js";
import { runModelPicker } from "./model-picker.js";
import { promptOptional, closePrompts } from "./prompts.js";
import {
  AI_CONNECTION_METHODS,
  getAiProvidersForMethod,
  isAvailableAiProvider,
  type AiConnectionProviderDefinition,
} from "./ai-connection-registry.js";

export interface AiConnectionFlowOptions {
  /** Show a management-oriented heading instead of first-run wording. */
  manage?: boolean;
  /** If true, returning without a new connection is allowed. */
  allowSkip?: boolean;
}

export async function runAiConnectionFlow(
  config: AbosConfig,
  options: AiConnectionFlowOptions = {},
): Promise<AbosConfig> {
  let working = config;

  try {
    while (true) {
      printConnectionSummary(working, options.manage ?? false);
    const method = await chooseConnectionMethod(options.allowSkip ?? true);
    if (!method) return loadConfig() ?? working;

    const provider = await chooseProvider(method);
    if (!provider) continue;

    if (!isAvailableAiProvider(provider)) {
      console.log(
        chalk.yellow(
          `\n  ${provider.label} is represented in the connection registry, but its adapter is not implemented yet.\n`,
        ),
      );
      continue;
    }

    const connected = await connectProvider(working, provider);
    if (!connected) continue;

    working = loadConfig() ?? working;

    console.log(chalk.green(`\n  ✓ ${provider.label} connection configured.`));

    const activated = await selectModelForConnection(provider);
    working = loadConfig() ?? working;
    if (activated) {
      console.log(chalk.green(`  ✓ ${provider.label} is now the active AI connection.`));
    } else {
      console.log(
        chalk.yellow(
          "  Provider is configured, but the previous active connection remains unchanged because no compatible model was selected.",
        ),
      );
    }

    const next = await promptOptional(
      "Next: [1] Continue  [2] Add another AI provider  [3] Choose another model for this active connection",
    );

    if (next === "2") continue;
    if (next === "3") {
      await selectModelForConnection(provider);
      working = loadConfig() ?? working;
    }
      return working;
    }
  } finally {
    closePrompts();
  }
}

function printConnectionSummary(config: AbosConfig, manage: boolean): void {
  const active = config.aiConnection?.active;
  const title = manage ? "Manage AI Connections" : "Connect AI";
  console.log(chalk.cyan(`\n  ── ${title} ─────────────────────────────────\n`));
  console.log(chalk.dim("  Choose how ABOS should connect to an inference provider."));
  console.log(chalk.dim("  Authentication method, provider, and model are independent choices.\n"));

  if (active) {
    console.log(
      `  Active: ${chalk.white(active.method)} → ${chalk.white(active.provider)} → ${chalk.white(config.inferenceModel)}\n`,
    );
  }
}

async function chooseConnectionMethod(
  allowSkip: boolean,
): Promise<AiConnectionMethod | null> {
  for (let i = 0; i < AI_CONNECTION_METHODS.length; i++) {
    const method = AI_CONNECTION_METHODS[i];
    console.log(`  ${i + 1}. ${chalk.white(method.label)}`);
    console.log(chalk.dim(`     ${method.description}`));
  }
  if (allowSkip) {
    console.log(`  ${AI_CONNECTION_METHODS.length + 1}. ${chalk.dim("Continue without changing AI connection")}`);
  }
  console.log("");

  const input = await promptOptional("Select connection method");
  if (!input && allowSkip) return null;

  const index = Number.parseInt(input, 10) - 1;
  if (index >= 0 && index < AI_CONNECTION_METHODS.length) {
    return AI_CONNECTION_METHODS[index].id;
  }
  if (allowSkip && index === AI_CONNECTION_METHODS.length) return null;

  console.log(chalk.yellow("  Invalid connection method."));
  return chooseConnectionMethod(allowSkip);
}

async function chooseProvider(
  method: AiConnectionMethod,
): Promise<AiConnectionProviderDefinition | null> {
  const providers = getAiProvidersForMethod(method);
  const methodLabel = AI_CONNECTION_METHODS.find((entry) => entry.id === method)?.label || method;

  console.log(chalk.cyan(`\n  ${methodLabel}\n`));
  providers.forEach((provider, i) => {
    const future = provider.availability === "future" ? chalk.dim(" [future]") : "";
    console.log(`  ${i + 1}. ${chalk.white(provider.label)}${future}`);
    console.log(chalk.dim(`     ${provider.description}`));
  });
  console.log(`  ${providers.length + 1}. ${chalk.dim("Back")}`);
  console.log("");

  const input = await promptOptional("Select provider");
  const index = Number.parseInt(input, 10) - 1;
  if (index === providers.length || !input) return null;
  if (index >= 0 && index < providers.length) return providers[index];

  console.log(chalk.yellow("  Invalid provider selection."));
  return chooseProvider(method);
}

async function connectProvider(
  config: AbosConfig,
  provider: AiConnectionProviderDefinition & { runtimeProvider: AiRuntimeProvider },
): Promise<boolean> {
  switch (provider.id) {
    case "codex": {
      const discovered = await connectCodex(config);
      if (discovered <= 0) {
        console.log(
          chalk.yellow(
            "  Codex authenticated, but no model catalog was available. The connection remains saved.",
          ),
        );
      }
      return true;
    }

    case "openai": {
      const key = await promptSecretReplacement(
        "OpenAI API key (sk-...)",
        config.openaiApiKey,
      );
      if (!key) return false;
      if (!key.startsWith("sk-")) {
        console.log(chalk.yellow("  Warning: OpenAI keys usually start with sk-. Saving anyway."));
      }
      config.openaiApiKey = key;
      saveConfig(config);
      return true;
    }

    case "anthropic": {
      const key = await promptSecretReplacement(
        "Anthropic API key (sk-ant-...)",
        config.anthropicApiKey,
      );
      if (!key) return false;
      if (!key.startsWith("sk-ant-")) {
        console.log(chalk.yellow("  Warning: Anthropic keys usually start with sk-ant-. Saving anyway."));
      }
      config.anthropicApiKey = key;
      saveConfig(config);
      return true;
    }

    case "conway": {
      const key = await promptSecretReplacement(
        "Conway API key (cnwy_k_...)",
        config.conwayApiKey,
      );
      if (!key) return false;
      config.conwayApiKey = key;
      saveConfig(config);
      return true;
    }

    case "ollama": {
      const input = await promptOptional(
        `Ollama base URL [${config.ollamaBaseUrl || "http://localhost:11434"}]`,
      );
      config.ollamaBaseUrl = input || config.ollamaBaseUrl || "http://localhost:11434";
      saveConfig(config);
      return true;
    }

    default:
      return false;
  }
}

async function selectModelForConnection(
  provider: AiConnectionProviderDefinition & { runtimeProvider: AiRuntimeProvider },
): Promise<boolean> {
  const filters = provider.modelProviders;
  return runModelPicker(undefined, undefined, filters, provider.runtimeProvider);
}

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

  console.log(chalk.yellow("  No credential entered; provider connection cancelled."));
  return undefined;
}

export function setActiveConnection(
  config: AbosConfig,
  method: AiConnectionMethod,
  provider: AiRuntimeProvider,
): void {
  config.aiConnection = {
    ...(config.aiConnection || {}),
    active: {
      method,
      provider,
      updatedAt: new Date().toISOString(),
    },
  };
}
