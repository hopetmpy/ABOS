/**
 * Non-secret Codex model catalog cache.
 *
 * The cache preserves the richer metadata returned by model/list (reasoning
 * efforts, modalities, service tiers, etc.). It is advisory and can always be
 * rebuilt from the official Codex runtime.
 */

import fs from "node:fs";
import path from "node:path";
import { getAbosDir } from "../identity/wallet.js";
import { CodexSessionManager } from "./session-manager.js";
import { codexRegistryModelId } from "./inference.js";
import { ModelRegistry } from "../inference/registry.js";
import type { CodexCatalogSnapshot, CodexModelDescriptor } from "./types.js";

const CATALOG_FILENAME = "codex-model-catalog.json";

export function getCodexCatalogPath(): string {
  return path.join(getAbosDir(), CATALOG_FILENAME);
}

export function loadCodexCatalog(): CodexCatalogSnapshot | null {
  const file = getCodexCatalogPath();
  if (!fs.existsSync(file)) return null;

  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as CodexCatalogSnapshot;
    if (
      parsed?.schemaVersion !== 1 ||
      typeof parsed.refreshedAt !== "string" ||
      !Array.isArray(parsed.models)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function refreshCodexCatalog(
  manager = new CodexSessionManager(),
  includeHidden = false,
): Promise<CodexCatalogSnapshot> {
  const models = await manager.listModels(includeHidden);
  const snapshot: CodexCatalogSnapshot = {
    schemaVersion: 1,
    refreshedAt: new Date().toISOString(),
    includeHidden,
    models,
  };
  saveCodexCatalog(snapshot);
  return snapshot;
}

export function findCodexModel(
  models: CodexModelDescriptor[],
  modelName: string,
): CodexModelDescriptor | undefined {
  return models.find((model) => model.model === modelName || model.id === modelName);
}

function saveCodexCatalog(snapshot: CodexCatalogSnapshot): void {
  const file = getCodexCatalogPath();
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

  const temp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temp, JSON.stringify(snapshot, null, 2), { mode: 0o600 });
  fs.renameSync(temp, file);
}


/**
 * Project the provider-rich Codex catalog into ABOS's routing registry.
 * Registry IDs are provider-namespaced because the same upstream model name
 * may also exist through OpenAI API or Conway.
 */
export function syncCodexCatalogToRegistry(
  registry: ModelRegistry,
  snapshot: CodexCatalogSnapshot,
): void {
  const now = snapshot.refreshedAt || new Date().toISOString();
  const seen = new Set<string>();

  for (const model of snapshot.models) {
    if (!model?.model) continue;
    const modelId = codexRegistryModelId(model.model);
    seen.add(modelId);
    const existing = registry.get(modelId);

    registry.upsert({
      modelId,
      provider: "codex",
      displayName: model.displayName || model.model,
      tierMinimum: "dead",
      // ChatGPT/Codex subscription usage is external to ABOS's treasury ledger.
      costPer1kInput: 0,
      costPer1kOutput: 0,
      maxTokens: existing?.maxTokens || 4096,
      // Codex model/list does not currently publish a context-window number.
      // Zero means unknown here; the full provider metadata remains in the cache.
      contextWindow: existing?.contextWindow || 0,
      supportsTools: true,
      // The current ABOS ChatMessage contract is text/tool oriented. Preserve
      // richer input modalities in the Codex catalog without falsely claiming
      // the adapter can already pass them through.
      supportsVision: false,
      parameterStyle: "max_completion_tokens",
      enabled: true,
      lastSeen: now,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    });
  }

  for (const existing of registry.getAll()) {
    if (existing.provider === "codex" && !seen.has(existing.modelId) && existing.enabled) {
      registry.setEnabled(existing.modelId, false);
    }
  }
}
