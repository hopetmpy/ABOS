import chalk from "chalk";
import { loadConfig, saveConfig } from "../config.js";
import { DEFAULT_CODEX_PROVIDER_CONFIG } from "../types.js";
import type { AbosConfig } from "../types.js";
import { refreshCodexCatalog } from "./catalog.js";
import { CodexSessionManager } from "./session-manager.js";

export async function connectCodex(config: AbosConfig): Promise<number> {
  const manager = new CodexSessionManager();
  const handle = await manager.beginDeviceCodeLogin();

  console.log(chalk.cyan("\n  Connect ABOS to Codex with ChatGPT\n"));
  console.log(`  Open: ${chalk.white(handle.verificationUrl)}`);
  console.log(`  Code: ${chalk.bold(handle.userCode)}\n`);
  console.log(chalk.dim("  Complete authorization in your browser. ABOS never asks for your ChatGPT password or OAuth token."));

  const completed = await handle.wait();
  if (!completed.success) {
    throw new Error(completed.error || "Codex device-code login failed");
  }

  config.codex = {
    ...DEFAULT_CODEX_PROVIDER_CONFIG,
    ...(config.codex || {}),
    enabled: true,
  };
  saveConfig(config);

  console.log(chalk.green("\n  ✓ Codex connected."));
  try {
    const snapshot = await refreshCodexCatalog(manager, config.codex.includeHiddenModels);
    console.log(chalk.green(`  ✓ Discovered ${snapshot.models.length} Codex model(s).\n`));
    return snapshot.models.length;
  } catch (error) {
    console.log(
      chalk.yellow(
        `  Connected, but model catalog refresh failed: ${error instanceof Error ? error.message : String(error)}\n`,
      ),
    );
    return 0;
  }
}

export async function runCodexLogin(): Promise<void> {
  const config = loadConfig();
  if (!config) {
    console.log(chalk.red("  ABOS is not configured. Run: abos --setup"));
    return;
  }
  await connectCodex(config);
}

export async function runCodexStatus(): Promise<void> {
  const manager = new CodexSessionManager();
  const response = await manager.account(false);
  if (!response.account) {
    console.log(chalk.yellow("  Codex: disconnected"));
    return;
  }

  const email = typeof response.account.email === "string" ? response.account.email : undefined;
  const plan = typeof response.account.planType === "string" ? response.account.planType : undefined;
  console.log(chalk.green("  Codex: connected"));
  if (email) console.log(`  Account: ${email}`);
  if (plan) console.log(`  Plan: ${plan}`);
}

export async function disconnectCodex(config: AbosConfig): Promise<void> {
  const manager = new CodexSessionManager();
  await manager.logout();
  config.codex = {
    ...DEFAULT_CODEX_PROVIDER_CONFIG,
    ...(config.codex || {}),
    enabled: false,
  };
  saveConfig(config);
  console.log(chalk.green("  ✓ Codex disconnected."));
}

export async function runCodexLogout(): Promise<void> {
  const config = loadConfig();
  if (!config) {
    console.log(chalk.red("  ABOS is not configured. Run: abos --setup"));
    return;
  }
  await disconnectCodex(config);
}

export async function runCodexModels(): Promise<void> {
  const config = loadConfig();
  const includeHidden = config?.codex?.includeHiddenModels ?? false;
  const snapshot = await refreshCodexCatalog(new CodexSessionManager(), includeHidden);

  console.log(chalk.cyan("\n  Codex Models\n"));
  for (const model of snapshot.models) {
    const marker = model.isDefault ? chalk.green(" default") : "";
    const efforts = model.supportedReasoningEfforts
      .map((option) => option.reasoningEffort)
      .join(", ");
    console.log(`  ${chalk.white(model.model)}  ${chalk.dim(model.displayName)}${marker}`);
    if (efforts) console.log(chalk.dim(`    reasoning: ${efforts}`));
  }
  console.log("");
}
