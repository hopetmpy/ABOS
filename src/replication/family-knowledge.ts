import { createHash } from "crypto";
import type { AbosDatabase, ConwayClient, Skill } from "../types.js";
import {
  KnowledgeStore,
  type KnowledgeEntry,
} from "../memory/knowledge-store.js";
import { CapabilityStore } from "../capabilities/store.js";
import type { CapabilityDescriptor } from "../capabilities/model.js";

export const FAMILY_KNOWLEDGE_VERSION = 1 as const;
export const FAMILY_KNOWLEDGE_PATH = "/root/.abos/family-knowledge.json";
export const FAMILY_KNOWLEDGE_HASH_PATH = "/root/.abos/family-knowledge.sha256";
export const FAMILY_KNOWLEDGE_RECEIPT_PATH = "/root/.abos/family-knowledge.applied.json";

const MAX_KNOWLEDGE_ENTRIES = 200;
const FAMILY_SOURCE_PREFIX = `family:v${FAMILY_KNOWLEDGE_VERSION}:`;

export interface FamilyKnowledgeItem {
  category: string;
  key: string;
  content: string;
  source: string;
  confidence: number;
  lastVerified: string;
  tokenCount: number;
  expiresAt: string | null;
}

export interface FamilySkillCatalogItem {
  name: string;
  description: string;
  source: string;
  enabled: boolean;
}

export interface FamilyCapabilityCatalogItem {
  id: string;
  type: string;
  provider: string;
  description: string;
  state: string;
  available: boolean;
  authority: string | null;
  observedAt: string | null;
  evidence: string[];
  definitionFingerprint: string;
  provides: string[];
  requirements: string[];
  permissions: string[];
  dependencies: string[];
  environment: string | null;
  version: string | null;
}

export interface FamilyKnowledgeBundle {
  format: "abos-family-knowledge/v1";
  version: typeof FAMILY_KNOWLEDGE_VERSION;
  parentAddress: string;
  generatedAt: string;
  knowledge: FamilyKnowledgeItem[];
  skills: FamilySkillCatalogItem[];
  capabilities: FamilyCapabilityCatalogItem[];
}

export interface FamilyKnowledgeReceipt {
  format: "abos-family-knowledge-receipt/v1";
  version: typeof FAMILY_KNOWLEDGE_VERSION;
  parentAddress: string;
  childWalletAddress: string;
  bundleHash: string;
  knowledgeImported: number;
  skillCatalogImported: number;
  capabilityCatalogImported: number;
  appliedAt: string;
}

export interface FamilyKnowledgeVerification {
  valid: boolean;
  detail: string;
  parentAddress?: string;
  bundleHash?: string;
  receipt?: FamilyKnowledgeReceipt;
}

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}

function knowledgeToProjection(entry: KnowledgeEntry): FamilyKnowledgeItem {
  return {
    category: entry.category,
    key: entry.key,
    content: entry.content,
    source: entry.source,
    confidence: entry.confidence,
    lastVerified: entry.lastVerified,
    tokenCount: entry.tokenCount,
    expiresAt: entry.expiresAt,
  };
}

function skillToProjection(skill: Skill): FamilySkillCatalogItem {
  return {
    name: skill.name,
    description: skill.description,
    source: skill.source,
    enabled: skill.enabled,
  };
}

function capabilityToProjection(
  capability: CapabilityDescriptor,
  definitionFingerprint: string,
): FamilyCapabilityCatalogItem {
  return {
    id: capability.id,
    type: capability.type,
    provider: capability.provider,
    description: capability.description,
    state: typeof capability.state === "string" ? capability.state : "unknown",
    available: capability.available === true,
    authority: capability.authority ?? null,
    observedAt: capability.observedAt ?? null,
    evidence: [...(capability.evidence ?? [])],
    definitionFingerprint,
    provides: [...(capability.provides ?? [])],
    requirements: [...capability.requirements],
    permissions: [...capability.permissions],
    dependencies: [...(capability.dependencies ?? [])],
    environment: capability.environment ?? null,
    version: capability.version ?? null,
  };
}

/**
 * Build a selective family projection from existing authorities.
 *
 * Deliberately excluded: working memory, episodic memory, raw semantic memory,
 * credentials, wallet material, policy state, and child execution authority.
 */
export function buildFamilyKnowledgeBundle(
  db: AbosDatabase,
  parentAddress: string,
): FamilyKnowledgeBundle {
  const address = parentAddress.trim();
  if (!address) throw new Error("Family knowledge parent address is required");

  const store = new KnowledgeStore(db.raw);
  const knowledge = store
    .search("", undefined, MAX_KNOWLEDGE_ENTRIES)
    .map(knowledgeToProjection);

  const skills = db
    .getSkills()
    .filter((skill) => skill.enabled)
    .map(skillToProjection)
    .sort((a, b) => a.name.localeCompare(b.name));

  const capabilities = new CapabilityStore(db.raw)
    .list()
    .map((record) =>
      capabilityToProjection(record.capability, record.definitionFingerprint)
    )
    .sort((a, b) => a.id.localeCompare(b.id));

  return {
    format: "abos-family-knowledge/v1",
    version: FAMILY_KNOWLEDGE_VERSION,
    parentAddress: address,
    generatedAt: new Date().toISOString(),
    knowledge,
    skills,
    capabilities,
  };
}

export function serializeFamilyKnowledgeBundle(bundle: FamilyKnowledgeBundle): string {
  return JSON.stringify(bundle, null, 2);
}

export function familyKnowledgeBundleHash(bundle: FamilyKnowledgeBundle): string {
  return sha256(serializeFamilyKnowledgeBundle(bundle));
}

function parseBundle(raw: string): FamilyKnowledgeBundle {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Invalid family knowledge bundle JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid family knowledge bundle: expected object");
  }

  const bundle = parsed as Partial<FamilyKnowledgeBundle>;
  if (
    bundle.format !== "abos-family-knowledge/v1" ||
    bundle.version !== FAMILY_KNOWLEDGE_VERSION ||
    typeof bundle.parentAddress !== "string" ||
    !bundle.parentAddress.trim() ||
    !Array.isArray(bundle.knowledge) ||
    !Array.isArray(bundle.skills) ||
    !Array.isArray(bundle.capabilities)
  ) {
    throw new Error("Invalid family knowledge bundle contract");
  }

  return bundle as FamilyKnowledgeBundle;
}

function inheritedSource(parentAddress: string, source: string): string {
  return `${FAMILY_SOURCE_PREFIX}${parentAddress}:${source}`;
}

function upsertKnowledgeProjection(
  store: KnowledgeStore,
  parentAddress: string,
  entry: FamilyKnowledgeItem,
): void {
  const source = inheritedSource(parentAddress, entry.source);
  const existing = store
    .search(entry.key, entry.category, MAX_KNOWLEDGE_ENTRIES)
    .find(
      (candidate) =>
        candidate.category === entry.category &&
        candidate.key === entry.key &&
        candidate.source === source,
    );

  if (existing) {
    store.update(existing.id, {
      content: entry.content,
      confidence: entry.confidence,
      lastVerified: entry.lastVerified,
      tokenCount: entry.tokenCount,
      expiresAt: entry.expiresAt,
      source,
    });
    return;
  }

  store.add({
    category: entry.category,
    key: entry.key,
    content: entry.content,
    source,
    confidence: entry.confidence,
    lastVerified: entry.lastVerified,
    tokenCount: entry.tokenCount,
    expiresAt: entry.expiresAt,
  });
}

function upsertCatalogKnowledge(
  store: KnowledgeStore,
  params: {
    category: string;
    key: string;
    content: string;
    source: string;
    lastVerified: string;
  },
): void {
  const existing = store
    .search(params.key, params.category, MAX_KNOWLEDGE_ENTRIES)
    .find(
      (candidate) =>
        candidate.category === params.category &&
        candidate.key === params.key &&
        candidate.source === params.source,
    );

  const tokenCount = Math.max(1, Math.ceil(params.content.length / 4));
  if (existing) {
    store.update(existing.id, {
      content: params.content,
      confidence: 1,
      lastVerified: params.lastVerified,
      tokenCount,
      expiresAt: null,
      source: params.source,
    });
    return;
  }

  store.add({
    category: params.category,
    key: params.key,
    content: params.content,
    source: params.source,
    confidence: 1,
    lastVerified: params.lastVerified,
    tokenCount,
    expiresAt: null,
  });
}

/**
 * Import the projection into the existing KnowledgeStore authority.
 * Capability catalog entries remain knowledge only; they are never registered
 * into the child's CapabilityRegistry and therefore cannot grant execution
 * readiness by inheritance.
 */
export function importFamilyKnowledgeBundle(
  db: AbosDatabase,
  raw: string,
  expectedParentAddress: string,
  childWalletAddress: string,
): FamilyKnowledgeReceipt {
  const bundle = parseBundle(raw);
  if (bundle.parentAddress !== expectedParentAddress) {
    throw new Error(
      `Family knowledge lineage mismatch: expected parent ${expectedParentAddress}, got ${bundle.parentAddress}`,
    );
  }
  if (!childWalletAddress.trim()) {
    throw new Error("Family knowledge import requires child wallet identity");
  }

  const store = new KnowledgeStore(db.raw);
  for (const entry of bundle.knowledge) {
    upsertKnowledgeProjection(store, bundle.parentAddress, entry);
  }

  for (const skill of bundle.skills) {
    upsertCatalogKnowledge(store, {
      category: "operational",
      key: `family:skill:${skill.name}`,
      content: JSON.stringify({
        kind: "family_skill_catalog",
        ...skill,
        inventoryOnly: true,
      }),
      source: `${FAMILY_SOURCE_PREFIX}${bundle.parentAddress}:skill-registry:${skill.source}`,
      lastVerified: bundle.generatedAt,
    });
  }

  for (const capability of bundle.capabilities) {
    upsertCatalogKnowledge(store, {
      category: "technical",
      key: `family:capability:${capability.id}`,
      content: JSON.stringify({
        kind: "family_capability_catalog",
        ...capability,
        inheritedExecutionReady: false,
        note: "Parent capability evidence is lineage knowledge, not child execution authority.",
      }),
      source: `${FAMILY_SOURCE_PREFIX}${bundle.parentAddress}:capability-registry:${capability.authority ?? "unknown"}`,
      lastVerified: capability.observedAt ?? bundle.generatedAt,
    });
  }

  return {
    format: "abos-family-knowledge-receipt/v1",
    version: FAMILY_KNOWLEDGE_VERSION,
    parentAddress: bundle.parentAddress,
    childWalletAddress,
    bundleHash: familyKnowledgeBundleHash(bundle),
    knowledgeImported: bundle.knowledge.length,
    skillCatalogImported: bundle.skills.length,
    capabilityCatalogImported: bundle.capabilities.length,
    appliedAt: new Date().toISOString(),
  };
}

export async function writeFamilyKnowledgeBundle(
  childConway: ConwayClient,
  sandboxId: string,
  db: AbosDatabase,
  parentAddress: string,
): Promise<{ bundle: FamilyKnowledgeBundle; hash: string }> {
  const bundle = buildFamilyKnowledgeBundle(db, parentAddress);
  const raw = serializeFamilyKnowledgeBundle(bundle);
  const hash = sha256(raw);

  await childConway.writeFile(FAMILY_KNOWLEDGE_PATH, raw);
  await childConway.writeFile(FAMILY_KNOWLEDGE_HASH_PATH, hash);
  db.setKV(`family_knowledge_hash:${sandboxId}`, hash);

  return { bundle, hash };
}

export async function verifyFamilyKnowledgeBootstrap(
  childConway: ConwayClient,
  sandboxId: string,
  db: AbosDatabase,
  expectedWalletAddress: string,
): Promise<FamilyKnowledgeVerification> {
  const storedHash = db.getKV(`family_knowledge_hash:${sandboxId}`);
  if (!storedHash) {
    return { valid: false, detail: "no stored family knowledge hash found" };
  }

  try {
    const raw = await childConway.readFile(FAMILY_KNOWLEDGE_PATH);
    const bundle = parseBundle(raw);
    const actualHash = sha256(raw);
    if (actualHash !== storedHash) {
      return {
        valid: false,
        detail: `family knowledge hash mismatch: expected ${storedHash.slice(0, 16)}..., got ${actualHash.slice(0, 16)}...`,
      };
    }

    const receiptRaw = await childConway.readFile(FAMILY_KNOWLEDGE_RECEIPT_PATH);
    const receipt = JSON.parse(receiptRaw) as Partial<FamilyKnowledgeReceipt>;
    if (
      receipt.format !== "abos-family-knowledge-receipt/v1" ||
      receipt.version !== FAMILY_KNOWLEDGE_VERSION ||
      receipt.parentAddress !== bundle.parentAddress ||
      receipt.bundleHash !== storedHash ||
      receipt.childWalletAddress !== expectedWalletAddress
    ) {
      return {
        valid: false,
        detail: "family knowledge receipt does not match bundle lineage/hash/wallet",
      };
    }

    return {
      valid: true,
      detail: "family knowledge bundle hash and applied receipt match",
      parentAddress: bundle.parentAddress,
      bundleHash: storedHash,
      receipt: receipt as FamilyKnowledgeReceipt,
    };
  } catch (error) {
    return {
      valid: false,
      detail: `failed to verify family knowledge bootstrap: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
