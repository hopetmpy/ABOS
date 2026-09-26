import { createHash } from "crypto";
import type { Database as DatabaseType } from "better-sqlite3";
import type { AbosDatabase } from "../types.js";
import {
  FAMILY_KNOWLEDGE_PATH,
  FAMILY_KNOWLEDGE_RECEIPT_PATH,
  serializeFamilyKnowledgeBundle,
  type FamilyKnowledgeBundle,
} from "../replication/family-knowledge.js";
import type { MockConwayClient } from "./mocks.js";

export const TEST_PARENT_ADDRESS =
  "0x2222222222222222222222222222222222222222";

function rawDb(db: AbosDatabase | DatabaseType): DatabaseType {
  return "raw" in db ? db.raw : db;
}

function setKv(
  db: AbosDatabase | DatabaseType,
  key: string,
  value: string,
): void {
  if ("setKV" in db && typeof db.setKV === "function") {
    db.setKV(key, value);
    return;
  }
  rawDb(db)
    .prepare(
      "INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, datetime('now'))",
    )
    .run(key, value);
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf-8").digest("hex");
}

/**
 * Materialize the minimum *real* P-029 bootstrap contract for tests that are
 * about lifecycle/runtime behavior rather than bootstrap failure itself.
 *
 * This does not mock verifyChildBootstrap. It installs constitution, family
 * bundle/receipt and child config exactly where the production verifier reads
 * them, so a test can prove its original behavior without relying on the old
 * "process liveness alone is enough" assumption.
 */
export function installValidP029Bootstrap(
  db: AbosDatabase | DatabaseType,
  conway: MockConwayClient,
  params: {
    childId: string;
    childName: string;
    childAddress: string;
    sandboxId: string;
    parentAddress?: string;
  },
): void {
  const parentAddress = params.parentAddress ?? TEST_PARENT_ADDRESS;
  const constitution = "# Constitution\nI. Preserve verified continuity.\n";
  const constitutionHash = sha256(constitution);

  const bundle: FamilyKnowledgeBundle = {
    format: "abos-family-knowledge/v1",
    version: 1,
    parentAddress,
    generatedAt: "2026-09-25T00:00:00.000Z",
    knowledge: [],
    skills: [],
    capabilities: [],
  };
  const familyRaw = serializeFamilyKnowledgeBundle(bundle);
  const familyHash = sha256(familyRaw);

  setKv(db, `constitution_hash:${params.sandboxId}`, constitutionHash);
  setKv(db, `family_knowledge_hash:${params.sandboxId}`, familyHash);

  conway.files["/root/.abos/constitution.md"] = constitution;
  conway.files[FAMILY_KNOWLEDGE_PATH] = familyRaw;
  conway.files[FAMILY_KNOWLEDGE_RECEIPT_PATH] = JSON.stringify({
    format: "abos-family-knowledge-receipt/v1",
    version: 1,
    parentAddress,
    childWalletAddress: params.childAddress,
    bundleHash: familyHash,
    knowledgeImported: 0,
    skillCatalogImported: 0,
    capabilityCatalogImported: 0,
    appliedAt: "2026-09-25T00:01:00.000Z",
  });
  conway.files["/root/.abos/abos.json"] = JSON.stringify({
    name: params.childName,
    walletAddress: params.childAddress,
    parentAddress,
    sandboxId: params.sandboxId,
  });
}
