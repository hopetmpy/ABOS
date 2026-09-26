import { createHash } from "crypto";
import { describe, expect, it } from "vitest";
import type { ChildAbosAgent } from "../types.js";
import { KnowledgeStore } from "../memory/knowledge-store.js";
import {
  FAMILY_KNOWLEDGE_PATH,
  FAMILY_KNOWLEDGE_RECEIPT_PATH,
  type FamilyKnowledgeBundle,
  familyKnowledgeBundleHash,
  importFamilyKnowledgeBundle,
  serializeFamilyKnowledgeBundle,
} from "../replication/family-knowledge.js";
import { verifyChildBootstrap } from "../replication/bootstrap-gate.js";
import { MockConwayClient, createTestDb } from "./mocks.js";

const PARENT = "0x2222222222222222222222222222222222222222";
const CHILD = "0x1111111111111111111111111111111111111111";

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf-8").digest("hex");
}

function bundle(): FamilyKnowledgeBundle {
  return {
    format: "abos-family-knowledge/v1",
    version: 1,
    parentAddress: PARENT,
    generatedAt: "2026-09-25T00:00:00.000Z",
    knowledge: [
      {
        category: "operational",
        key: "lesson:evidence-first",
        content: "Require evidence before declaring success.",
        source: PARENT,
        confidence: 0.95,
        lastVerified: "2026-09-25T00:00:00.000Z",
        tokenCount: 7,
        expiresAt: null,
      },
    ],
    skills: [
      {
        name: "parent-analysis-skill",
        description: "A parent catalog skill, not an installed child skill.",
        source: "parent-registry",
        enabled: true,
      },
    ],
    capabilities: [
      {
        id: "parent.exec.example",
        type: "executor",
        provider: "parent-runtime",
        description: "Verified only in the parent environment.",
        state: "verified_available",
        available: true,
        authority: "parent-capability-probe",
        observedAt: "2026-09-25T00:00:00.000Z",
        evidence: ["parent-only probe"],
        definitionFingerprint: "fingerprint-parent-example",
        provides: ["example.execute"],
        requirements: [],
        permissions: ["parent.permission"],
        dependencies: [],
        environment: "parent-sandbox",
        version: "1",
      },
    ],
  };
}

describe("P-029 Family Knowledge projection", () => {
  it("imports selectively and idempotently into KnowledgeStore without promoting skills or capabilities", () => {
    const db = createTestDb();
    try {
      const payload = bundle();
      const raw = serializeFamilyKnowledgeBundle(payload);

      const first = importFamilyKnowledgeBundle(db, raw, PARENT, CHILD);
      const second = importFamilyKnowledgeBundle(db, raw, PARENT, CHILD);

      expect(first.bundleHash).toBe(familyKnowledgeBundleHash(payload));
      expect(second.bundleHash).toBe(first.bundleHash);

      const rows = db.raw
        .prepare(
          "SELECT category, key, source, content FROM knowledge_store ORDER BY key ASC",
        )
        .all() as Array<{
          category: string;
          key: string;
          source: string;
          content: string;
        }>;

      // One curated knowledge item + one skill catalog item + one capability
      // catalog item. Re-import must update, not duplicate.
      expect(rows).toHaveLength(3);
      expect(rows.every((row) => row.source.startsWith(`family:v1:${PARENT}:`))).toBe(true);

      const capabilityKnowledge = rows.find(
        (row) => row.key === "family:capability:parent.exec.example",
      );
      expect(capabilityKnowledge).toBeDefined();
      expect(JSON.parse(capabilityKnowledge!.content)).toMatchObject({
        kind: "family_capability_catalog",
        id: "parent.exec.example",
        state: "verified_available",
        inheritedExecutionReady: false,
      });

      const childCapabilityRows = db.raw
        .prepare("SELECT COUNT(*) AS count FROM capability_records")
        .get() as { count: number };
      expect(childCapabilityRows.count).toBe(0);

      const installedParentSkill = db.raw
        .prepare("SELECT COUNT(*) AS count FROM skills WHERE name = ?")
        .get("parent-analysis-skill") as { count: number };
      expect(installedParentSkill.count).toBe(0);
    } finally {
      db.close();
    }
  });

  it("rejects a bundle whose parent lineage does not match genesis authority", () => {
    const db = createTestDb();
    try {
      const raw = serializeFamilyKnowledgeBundle(bundle());
      expect(() =>
        importFamilyKnowledgeBundle(
          db,
          raw,
          "0x3333333333333333333333333333333333333333",
          CHILD,
        ),
      ).toThrow(/lineage mismatch/);
      expect(new KnowledgeStore(db.raw).search("")).toEqual([]);
    } finally {
      db.close();
    }
  });
});

describe("P-029 child bootstrap gate", () => {
  function arrangeValidGate() {
    const db = createTestDb();
    const conway = new MockConwayClient();
    const constitution = "# Constitution\nI. Keep continuity.\n";
    const family = bundle();
    const familyRaw = serializeFamilyKnowledgeBundle(family);
    const familyHash = sha256(familyRaw);
    const child: ChildAbosAgent = {
      id: "child-p029-1",
      name: "child-one",
      address: CHILD,
      sandboxId: "sandbox-child-1",
      genesisPrompt: "Execute delegated mission.",
      fundedAmountCents: 0,
      status: "wallet_verified",
      createdAt: "2026-09-25T00:00:00.000Z",
      chainType: "evm",
    };

    db.setKV(`constitution_hash:${child.sandboxId}`, sha256(constitution));
    db.setKV(`family_knowledge_hash:${child.sandboxId}`, familyHash);
    conway.files["/root/.abos/constitution.md"] = constitution;
    conway.files[FAMILY_KNOWLEDGE_PATH] = familyRaw;
    conway.files[FAMILY_KNOWLEDGE_RECEIPT_PATH] = JSON.stringify({
      format: "abos-family-knowledge-receipt/v1",
      version: 1,
      parentAddress: PARENT,
      childWalletAddress: CHILD,
      bundleHash: familyHash,
      knowledgeImported: family.knowledge.length,
      skillCatalogImported: family.skills.length,
      capabilityCatalogImported: family.capabilities.length,
      appliedAt: "2026-09-25T00:01:00.000Z",
    });
    conway.files["/root/.abos/abos.json"] = JSON.stringify({
      name: child.name,
      walletAddress: CHILD,
      parentAddress: PARENT,
      sandboxId: child.sandboxId,
    });

    return { db, conway, child, familyHash };
  }

  it("attests only when constitution, family receipt and child identity agree", async () => {
    const { db, conway, child, familyHash } = arrangeValidGate();
    try {
      const result = await verifyChildBootstrap(conway, db, child);

      expect(result.valid).toBe(true);
      expect(result.constitutionValid).toBe(true);
      expect(result.familyKnowledgeValid).toBe(true);
      expect(result.configIdentityValid).toBe(true);

      const attestation = JSON.parse(
        db.getKV(`child_bootstrap_attestation:${child.id}`)!,
      );
      expect(attestation).toMatchObject({
        childId: child.id,
        sandboxId: child.sandboxId,
        walletAddress: CHILD,
        familyKnowledgeHash: familyHash,
        familyParentAddress: PARENT,
      });
    } finally {
      db.close();
    }
  });

  it("fails closed on constitution tampering and does not write an attestation", async () => {
    const { db, conway, child } = arrangeValidGate();
    try {
      conway.files["/root/.abos/constitution.md"] += "tampered";

      const result = await verifyChildBootstrap(conway, db, child);

      expect(result.valid).toBe(false);
      expect(result.constitutionValid).toBe(false);
      expect(result.evidence.join(" ")).toContain("hash mismatch");
      expect(db.getKV(`child_bootstrap_attestation:${child.id}`)).toBeUndefined();
    } finally {
      db.close();
    }
  });

  it("fails closed when child config claims another wallet", async () => {
    const { db, conway, child } = arrangeValidGate();
    try {
      conway.files["/root/.abos/abos.json"] = JSON.stringify({
        name: child.name,
        walletAddress: "0x4444444444444444444444444444444444444444",
        parentAddress: PARENT,
        sandboxId: child.sandboxId,
      });

      const result = await verifyChildBootstrap(conway, db.raw, child);

      expect(result.valid).toBe(false);
      expect(result.configIdentityValid).toBe(false);
      expect(result.evidence.join(" ")).toContain("wallet=false");
    } finally {
      db.close();
    }
  });
});
