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
