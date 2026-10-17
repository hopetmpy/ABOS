/**
 * Soul Tools — Tool implementations for soul management.
 *
 * Provides updateSoul, reflectOnSoul (trigger), viewSoul, and viewSoulHistory.
 * All operations validate before saving and log to soul_history.
 *
 * Phase 2.1: Soul System Redesign
 */

import fs from "fs";
import path from "path";
import type BetterSqlite3 from "better-sqlite3";
import type { SoulModel, SoulHistoryRow } from "../types.js";
import { loadCurrentSoul, writeSoulMd, createHash, createDefaultSoul } from "./model.js";
import { validateSoul } from "./validator.js";
import { insertSoulHistory, getCurrentSoulVersion, getLatestSoulHistory, getSoulHistory } from "../state/database.js";
import { ulid } from "ulid";
import { createLogger } from "../observability/logger.js";
import { getHomeDir } from "../platform/home.js";
const logger = createLogger("soul");

// ─── Update Soul ────────────────────────────────────────────────

export interface UpdateSoulResult {
  success: boolean;
  version: number;
  errors?: string[];
}

/**
 * Update the soul with new content. Validates, versions, saves to file, and logs.
 */
export async function updateSoul(
  db: BetterSqlite3.Database,
  updates: Partial<SoulModel>,
  source: SoulHistoryRow["changeSource"],
  reason?: string,
  soulPath?: string,
): Promise<UpdateSoulResult> {
  try {
    const home = getHomeDir();
    const resolvedPath = soulPath || path.join(home, ".abos", "SOUL.md");

    // Load current soul or create default
    let current = loadCurrentSoul(db, resolvedPath);
    if (!current) {
      current = createDefaultSoul(
        updates.corePurpose || "No purpose set.",
        updates.name || "",
        updates.address || "",
        updates.creator || "",
      );
    }

    // Soul v1 frontmatter is a protected identity reference, not a regular
    // self-description. Agent/reflection paths cannot author those fields,
    // even on first creation. Existing lineage/constitution references cannot
    // be silently rewritten by labelling a call "system" or "human".
    const immutable = [
      "name", "address", "creator", "bornAt",
      "constitutionHash", "genesisPromptOriginal",
    ] as const;
    const existing = loadCurrentSoul(db, resolvedPath);
    const forbidden = immutable.filter(field =>
      Object.hasOwn(updates, field) &&
      (source === "agent" || source === "reflection" ||
        (existing !== null && updates[field] !== existing[field]))
    );
    // Reflection owns its diagnostic score; ordinary self-editing cannot
    // fabricate identity-alignment evidence or version/history metadata.
    const managed = [
      "genesisAlignment", "lastReflected", "format", "version",
      "updatedAt", "rawContent", "contentHash",
    ] as const;
    if (source === "agent") {
      forbidden.push(...managed.filter(field => Object.hasOwn(updates, field)));
    }
    if (forbidden.length > 0) {
      return {
        success: false,
        version: current.version,
        errors: ["Protected Soul identity or runtime evidence cannot be edited through updateSoul: " + forbidden.join(", ")],
      };
    }

    // Merge updates into current soul
    const merged: SoulModel = {
      ...current,
      ...updates,
      format: "soul/v1",
      updatedAt: new Date().toISOString(),
    };

    // Validate
    const validation = validateSoul(merged);
    if (!validation.valid) {
      return {
        success: false,
        version: current.version,
        errors: validation.errors,
      };
    }

    // Increment version
    const currentVersion = getCurrentSoulVersion(db);
    const newVersion = Math.max(currentVersion, current.version) + 1;
    const newSoul: SoulModel = {
      ...validation.sanitized,
      version: newVersion,
      updatedAt: new Date().toISOString(),
    };

    // Write to file
    const content = writeSoulMd(newSoul);
    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(resolvedPath, content, "utf-8");

    // Get previous version ID
    const latestHistory = getLatestSoulHistory(db);
    const previousVersionId = latestHistory?.id || null;

    // Log to soul_history
    insertSoulHistory(db, {
      id: ulid(),
      version: newVersion,
      content,
      contentHash: createHash(content),
      changeSource: source,
      changeReason: reason || null,
      previousVersionId,
      approvedBy: null,
      createdAt: new Date().toISOString(),
    });

    return { success: true, version: newVersion };
  } catch (error) {
    logger.error("updateSoul failed", error instanceof Error ? error : undefined);
    return {
      success: false,
      version: 0,
      errors: [error instanceof Error ? error.message : "Unknown error"],
    };
  }
}

// ─── View Soul ──────────────────────────────────────────────────

/**
 * View the current soul model.
 */
export function viewSoul(
  db: BetterSqlite3.Database,
  soulPath?: string,
): SoulModel | null {
  return loadCurrentSoul(db, soulPath);
}

// ─── View Soul History ──────────────────────────────────────────

/**
 * View soul change history.
 */
export function viewSoulHistory(
  db: BetterSqlite3.Database,
  limit?: number,
): SoulHistoryRow[] {
  return getSoulHistory(db, limit);
}
