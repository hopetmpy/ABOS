import chalk from "chalk";
import { loadConfig, saveConfig } from "../config.js";
import type { AbosConfig } from "../types.js";
import {
  BUILTIN_AI_CONNECTION_METHODS,
  methodLabel,
  type AiConnectionAdapter,
} from "../ai-connections/registry.js";
import { promptOptional, closePrompts } from "./prompts.js";
import { createBuiltinAiConnectionAdapterRegistry } from "./ai-connection-adapters.js";
import { runModelPicker } from "./model-picker.js";

export interface AiConnectionFlowOptions {
  manage?: boolean;
  allowSkip?: boolean;
}

export async function runAiConnectionFlow(
  config: AbosConfig,
  options: AiConnectionFlowOptions = {},
): Promise<AbosConfig> {
  const registry = createBuiltinAiConnectionAdapterRegistry();
  let working = config;

  try {
    while (true) {
      printConnectionSummary(working, options.manage ?? false);

      const methods = collectMethods(registry.methods());
      const method = await chooseConnectionMethod(methods, options.allowSkip ?? true);
      if (!method) return loadConfig() ?? working;

      const adapter = await chooseAdapter(
        registry.list(method.id),
        method.label,
      );
      if (!adapter) continue;

      if (!adapter.connect) {
        console.log(
          chalk.yellow(
            `  ${adapter.label} is known, but this runtime does not currently expose a setup path for it. This is unavailable, not impossible.`,
          ),
        );
        continue;
      }

      let setup;
      try {
        setup = await adapter.connect(working);
      } catch (error) {
        console.log(
          chalk.red(
            `  ${adapter.label} connection failed: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
        continue;
      }

      working = loadConfig() ?? working;
      if (!setup.configured) continue;

      // Authentication/configuration is durable but does NOT become the active
      // inference route until a compatible model is explicitly selected.
      const now = new Date().toISOString();
      working.aiConnection = {
        ...(working.aiConnection || {}),
        connections: {
          ...(working.aiConnection?.connections || {}),
          [adapter.id]: {
            id: adapter.id,
            method: adapter.method,
            provider: adapter.id,
            configuredAt:
              working.aiConnection?.connections?.[adapter.id]?.configuredAt || now,
          },
        },
      };
      saveConfig(working);

      console.log(chalk.green(`\n  ✓ ${adapter.label} configured.`));
      const activated = await runModelPicker({ adapter });
      working = loadConfig() ?? working;

      if (activated) {
        console.log(chalk.green(`  ✓ ${adapter.label} is now the active AI connection.`));
      } else {
        console.log(
          chalk.yellow(
            "  Connection remains configured, but the previous active route was preserved because no compatible model was selected.",
          ),
        );
      }

      const next = await promptOptional(
        "Next: [1] Continue  [2] Add another AI connection  [3] Choose another model",
      );

      if (next === "2") continue;
      if (next === "3") {
        await runModelPicker({ adapter });
        working = loadConfig() ?? working;
      }
      return working;
    }
  } finally {
    closePrompts();
  }
}

function collectMethods(
  adapterMethods: string[],
): Array<{ id: string; label: string; description: string }> {
  const builtins = BUILTIN_AI_CONNECTION_METHODS.map((method) => ({ ...method }));
  const seen = new Set(builtins.map((method) => method.id));

  for (const id of adapterMethods) {
    if (seen.has(id)) continue;
    builtins.push({
      id,
      label: methodLabel(id),
      description: "Connection method supplied by a registered adapter.",
    });
    seen.add(id);
  }

  return builtins;
}

function printConnectionSummary(config: AbosConfig, manage: boolean): void {
  const active = config.aiConnection?.active;
  const configured = Object.values(config.aiConnection?.connections || {});
  const title = manage ? "Manage AI Connections" : "Connect AI";

  console.log(chalk.cyan(`\n  ── ${title} ─────────────────────────────────\n`));
  console.log(
    chalk.dim(
      "  Method, provider, and model are independent. Registered adapters determine what is currently executable.",
    ),
  );

  if (configured.length > 0) {
    console.log(chalk.dim(`  Configured: ${configured.map((entry) => entry.provider).join(", ")}`));
  }
  if (active) {
    console.log(
      `  Active: ${chalk.white(active.method)} → ${chalk.white(active.provider)} → ${chalk.white(config.inferenceModel)}\n`,
    );
  } else {
    console.log(chalk.dim("  Active: legacy/automatic routing until a connection is explicitly selected.\n"));
  }
}

async function chooseConnectionMethod(
  methods: Array<{ id: string; label: string; description: string }>,
  allowSkip: boolean,
): Promise<{ id: string; label: string } | null> {
  methods.forEach((method, index) => {
    console.log(`  ${index + 1}. ${chalk.white(method.label)}`);
    console.log(chalk.dim(`     ${method.description}`));
  });

  if (allowSkip) {
    console.log(`  ${methods.length + 1}. ${chalk.dim("Continue without changing AI connection")}`);
  }
  console.log("");

  const input = await promptOptional("Select connection method");
  if (!input && allowSkip) return null;

  const index = Number.parseInt(input, 10) - 1;
  if (index >= 0 && index < methods.length) {
    return { id: methods[index].id, label: methods[index].label };
  }
  if (allowSkip && index === methods.length) return null;

  console.log(chalk.yellow("  Invalid connection method."));
  return chooseConnectionMethod(methods, allowSkip);
}

async function chooseAdapter(
  adapters: AiConnectionAdapter[],
  methodLabelText: string,
): Promise<AiConnectionAdapter | null> {
  console.log(chalk.cyan(`\n  ${methodLabelText}\n`));

  if (adapters.length === 0) {
    console.log(
      chalk.yellow(
        "  No adapter for this method is loaded in the current runtime. Additional adapters can be registered without changing core provider types.",
      ),
    );
    return null;
  }

  adapters.forEach((adapter, index) => {
    console.log(`  ${index + 1}. ${chalk.white(adapter.label)}`);
    console.log(chalk.dim(`     ${adapter.description}`));
  });
  console.log(`  ${adapters.length + 1}. ${chalk.dim("Back")}`);
  console.log("");

  const input = await promptOptional("Select provider");
  const index = Number.parseInt(input, 10) - 1;
  if (!input || index === adapters.length) return null;
  if (index >= 0 && index < adapters.length) return adapters[index];

  console.log(chalk.yellow("  Invalid provider selection."));
  return chooseAdapter(adapters, methodLabelText);
}
