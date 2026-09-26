import type { AbosDatabase, SocialClientInterface } from "../types.js";
import { KnowledgeStore } from "../memory/knowledge-store.js";
import {
  ColonyMessaging,
  SocialRelayTransport,
  type AgentMessage,
  type ProcessedMessage,
} from "../orchestration/messaging.js";
import {
  importFamilyKnowledgeItems,
  knowledgeToFamilyProjection,
  type FamilyKnowledgeItem,
} from "./family-knowledge.js";
import { ulid } from "ulid";

export const FAMILY_KNOWLEDGE_QUERY_PROTOCOL =
  "abos-family-knowledge-query/v1" as const;
export const FAMILY_KNOWLEDGE_RESPONSE_PROTOCOL =
  "abos-family-knowledge-response/v1" as const;

const MAX_QUERY_LENGTH = 512;
const MAX_CATEGORY_LENGTH = 128;
const DEFAULT_QUERY_LIMIT = 10;
const MAX_QUERY_LIMIT = 20;
const QUERY_TTL_MS = 10 * 60 * 1000;
const PENDING_PREFIX = "family_knowledge_query_pending:";
const RESULT_PREFIX = "family_knowledge_query_result:";

export interface FamilyKnowledgeQueryRequest {
  protocol: typeof FAMILY_KNOWLEDGE_QUERY_PROTOCOL;
  requestId: string;
  query: string;
  category: string | null;
  limit: number;
  requestedAt: string;
}

export interface FamilyKnowledgeQueryResponse {
  protocol: typeof FAMILY_KNOWLEDGE_RESPONSE_PROTOCOL;
  requestId: string;
  parentAddress: string;
  query: string;
  category: string | null;
  generatedAt: string;
  knowledge: FamilyKnowledgeItem[];
}

export interface FamilyKnowledgeQueryResult {
  requestId: string;
  parentAddress: string;
  query: string;
  category: string | null;
  imported: number;
  appliedAt: string;
}

interface PendingFamilyKnowledgeQuery extends FamilyKnowledgeQueryRequest {
  parentAddress: string;
  expiresAt: string;
}

export interface FamilyKnowledgePeerHandlerOptions {
  identityAddress: string;
  parentAddress?: string;
}

function sameAddress(left: string, right: string): boolean {
  if (left.startsWith("0x") && right.startsWith("0x")) {
    return left.toLowerCase() === right.toLowerCase();
  }
  return left === right;
}

function normalizeQueryOptions(params: {
  query: string;
  category?: string | null;
  limit?: number;
}): { query: string; category: string | null; limit: number } {
  const query = params.query.trim();
  if (!query) throw new Error("Family knowledge query cannot be empty");
  if (query.length > MAX_QUERY_LENGTH) {
    throw new Error(
      `Family knowledge query is too long (${query.length} > ${MAX_QUERY_LENGTH})`,
    );
  }

  const category = params.category?.trim() || null;
  if (category && category.length > MAX_CATEGORY_LENGTH) {
    throw new Error(
      `Family knowledge category is too long (${category.length} > ${MAX_CATEGORY_LENGTH})`,
    );
  }

  const limit = params.limit ?? DEFAULT_QUERY_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_QUERY_LIMIT) {
    throw new Error(
      `Family knowledge query limit must be an integer between 1 and ${MAX_QUERY_LIMIT}`,
    );
  }

  return { query, category, limit };
}

function pendingKey(requestId: string): string {
  return `${PENDING_PREFIX}${requestId}`;
}

function resultKey(requestId: string): string {
  return `${RESULT_PREFIX}${requestId}`;
}

function tryParseJsonObject(raw: string): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  return parsed as Record<string, unknown>;
}

function parseJsonObject(raw: string, label: string): Record<string, unknown> {
  const parsed = tryParseJsonObject(raw);
  if (!parsed) throw new Error(`${label} must be a valid JSON object`);
  return parsed;
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isFamilyKnowledgeItem(value: unknown): value is FamilyKnowledgeItem {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Partial<FamilyKnowledgeItem>;
  return (
    typeof item.category === "string" && item.category.length > 0 &&
    typeof item.key === "string" && item.key.length > 0 &&
    typeof item.content === "string" &&
    typeof item.source === "string" && item.source.length > 0 &&
    typeof item.confidence === "number" && Number.isFinite(item.confidence) &&
    item.confidence >= 0 && item.confidence <= 1 &&
    isIsoDate(item.lastVerified) &&
    typeof item.tokenCount === "number" && Number.isInteger(item.tokenCount) &&
    item.tokenCount >= 0 &&
    (item.expiresAt === null || isIsoDate(item.expiresAt))
  );
}

export function parseFamilyKnowledgeQueryRequest(
  raw: string,
): FamilyKnowledgeQueryRequest | null {
  const value = tryParseJsonObject(raw);
  if (!value || value.protocol !== FAMILY_KNOWLEDGE_QUERY_PROTOCOL) return null;

  if (
    typeof value.requestId !== "string" ||
    !value.requestId.trim() ||
    typeof value.query !== "string" ||
    (value.category !== null && value.category !== undefined &&
      typeof value.category !== "string") ||
    typeof value.limit !== "number" ||
    !isIsoDate(value.requestedAt)
  ) {
    throw new Error("Invalid family knowledge query contract");
  }

  const normalized = normalizeQueryOptions({
    query: value.query,
    category: typeof value.category === "string" ? value.category : null,
    limit: value.limit,
  });

  return {
    protocol: FAMILY_KNOWLEDGE_QUERY_PROTOCOL,
    requestId: value.requestId,
    query: normalized.query,
    category: normalized.category,
    limit: normalized.limit,
    requestedAt: value.requestedAt,
  };
}

export function parseFamilyKnowledgeQueryResponse(
  raw: string,
): FamilyKnowledgeQueryResponse | null {
  const value = tryParseJsonObject(raw);
  if (!value || value.protocol !== FAMILY_KNOWLEDGE_RESPONSE_PROTOCOL) return null;

  if (
    typeof value.requestId !== "string" ||
    !value.requestId.trim() ||
    typeof value.parentAddress !== "string" ||
    !value.parentAddress.trim() ||
    typeof value.query !== "string" ||
    (value.category !== null && value.category !== undefined &&
      typeof value.category !== "string") ||
    !isIsoDate(value.generatedAt) ||
    !Array.isArray(value.knowledge) ||
    value.knowledge.length > MAX_QUERY_LIMIT ||
    !value.knowledge.every(isFamilyKnowledgeItem)
  ) {
    throw new Error("Invalid family knowledge response contract");
  }

  const normalized = normalizeQueryOptions({
    query: value.query,
    category: typeof value.category === "string" ? value.category : null,
    limit: Math.max(1, value.knowledge.length || 1),
  });

  return {
    protocol: FAMILY_KNOWLEDGE_RESPONSE_PROTOCOL,
    requestId: value.requestId,
    parentAddress: value.parentAddress,
    query: normalized.query,
    category: normalized.category,
    generatedAt: value.generatedAt,
    knowledge: value.knowledge,
  };
}

export function createFamilyKnowledgeQueryRequest(
  db: AbosDatabase,
  parentAddress: string,
  params: { query: string; category?: string | null; limit?: number },
): FamilyKnowledgeQueryRequest {
  const parent = parentAddress.trim();
  if (!parent) throw new Error("Family knowledge query requires parent lineage");

  const normalized = normalizeQueryOptions(params);
  const requestedAt = new Date().toISOString();
  const request: FamilyKnowledgeQueryRequest = {
    protocol: FAMILY_KNOWLEDGE_QUERY_PROTOCOL,
    requestId: ulid(),
    query: normalized.query,
    category: normalized.category,
    limit: normalized.limit,
    requestedAt,
  };
  const pending: PendingFamilyKnowledgeQuery = {
    ...request,
    parentAddress: parent,
    expiresAt: new Date(Date.now() + QUERY_TTL_MS).toISOString(),
  };
  db.setKV(pendingKey(request.requestId), JSON.stringify(pending));
  return request;
}

function knownDirectChild(
  db: AbosDatabase,
  childAddress: string,
): { address: string; status: string } | null {
  const child = db.getChildren().find((candidate) =>
    sameAddress(candidate.address, childAddress)
  );
  if (!child) return null;
  return { address: child.address, status: child.status };
}

/**
 * Resolve one bounded query strictly from the curated KnowledgeStore authority.
 * Raw episodic/working memory is deliberately outside this route.
 */
export function buildFamilyKnowledgeQueryResponse(
  db: AbosDatabase,
  parentAddress: string,
  requesterAddress: string,
  request: FamilyKnowledgeQueryRequest,
): FamilyKnowledgeQueryResponse {
  const parent = parentAddress.trim();
  if (!parent) throw new Error("Family knowledge responder identity is required");

  const child = knownDirectChild(db, requesterAddress);
  if (!child) {
    throw new Error(
      `Family knowledge query refused: requester ${requesterAddress} is not a direct known child`,
    );
  }
  if (["failed", "dead", "cleaned_up"].includes(child.status)) {
    throw new Error(
      `Family knowledge query refused: child ${requesterAddress} is terminal (${child.status})`,
    );
  }

  const knowledge = new KnowledgeStore(db.raw)
    .search(request.query, request.category ?? undefined, request.limit)
    .map(knowledgeToFamilyProjection);

  return {
    protocol: FAMILY_KNOWLEDGE_RESPONSE_PROTOCOL,
    requestId: request.requestId,
    parentAddress: parent,
    query: request.query,
    category: request.category,
    generatedAt: new Date().toISOString(),
    knowledge,
  };
}

function readPending(
  db: AbosDatabase,
  requestId: string,
): PendingFamilyKnowledgeQuery | null {
  const raw = db.getKV(pendingKey(requestId));
  if (!raw) return null;
  const parsed = parseJsonObject(raw, "Pending family knowledge query");
  if (
    parsed.protocol !== FAMILY_KNOWLEDGE_QUERY_PROTOCOL ||
    typeof parsed.requestId !== "string" ||
    typeof parsed.parentAddress !== "string" ||
    typeof parsed.query !== "string" ||
    (parsed.category !== null && typeof parsed.category !== "string") ||
    typeof parsed.limit !== "number" ||
    !isIsoDate(parsed.requestedAt) ||
    !isIsoDate(parsed.expiresAt)
  ) {
    throw new Error("Invalid persisted family knowledge query state");
  }
  return parsed as unknown as PendingFamilyKnowledgeQuery;
}

/**
 * Apply a parent response idempotently through KnowledgeStore. A response is
 * accepted only for a durable pending request tied to the same parent/query, or
 * as an exact replay of an already-applied result after restart.
 */
export function applyFamilyKnowledgeQueryResponse(
  db: AbosDatabase,
  expectedParentAddress: string,
  response: FamilyKnowledgeQueryResponse,
): FamilyKnowledgeQueryResult {
  const parent = expectedParentAddress.trim();
  if (!sameAddress(response.parentAddress, parent)) {
    throw new Error(
      `Family knowledge response lineage mismatch: expected ${parent}, got ${response.parentAddress}`,
    );
  }

  const pending = readPending(db, response.requestId);
  if (!pending) {
    const existingRaw = db.getKV(resultKey(response.requestId));
    if (existingRaw) {
      const existing = parseJsonObject(
        existingRaw,
        "Applied family knowledge query result",
      ) as unknown as FamilyKnowledgeQueryResult;
      if (
        sameAddress(existing.parentAddress, parent) &&
        existing.query === response.query &&
        existing.category === response.category
      ) {
        return existing;
      }
    }
    throw new Error(
      `Unsolicited family knowledge response: no pending request ${response.requestId}`,
    );
  }

  if (!sameAddress(pending.parentAddress, parent)) {
    throw new Error("Pending family knowledge request belongs to another parent");
  }
  if (Date.parse(pending.expiresAt) < Date.now()) {
    db.deleteKV(pendingKey(response.requestId));
    throw new Error("Family knowledge response arrived after request expiry");
  }
  if (
    pending.query !== response.query ||
    pending.category !== response.category
  ) {
    throw new Error("Family knowledge response does not match pending query");
  }

  const imported = importFamilyKnowledgeItems(
    db,
    parent,
    response.knowledge,
  );
  const result: FamilyKnowledgeQueryResult = {
    requestId: response.requestId,
    parentAddress: parent,
    query: response.query,
    category: response.category,
    imported,
    appliedAt: new Date().toISOString(),
  };

  db.setKV(resultKey(response.requestId), JSON.stringify(result));
  db.deleteKV(pendingKey(response.requestId));
  return result;
}

export function configureFamilyKnowledgePeerHandlers(
  messaging: ColonyMessaging,
  db: AbosDatabase,
  options: FamilyKnowledgePeerHandlerOptions,
): void {
  const localAddress = db.getIdentity("address");
  if (!localAddress || !sameAddress(localAddress, options.identityAddress)) {
    throw new Error(
      "Family knowledge handler identity does not match the canonical local identity",
    );
  }

  messaging.setHandler("peer_query", async (message: AgentMessage) => {
    const request = parseFamilyKnowledgeQueryRequest(message.content);
    if (!request) return;

    const response = buildFamilyKnowledgeQueryResponse(
      db,
      localAddress,
      message.from,
      request,
    );
    await messaging.send(
      messaging.createMessage({
        type: "peer_response",
        to: message.from,
        content: JSON.stringify(response),
        priority: "normal",
        requiresResponse: false,
        expiresAt: new Date(Date.now() + QUERY_TTL_MS).toISOString(),
      }),
    );
  });

  messaging.setHandler("peer_response", async (message: AgentMessage) => {
    const response = parseFamilyKnowledgeQueryResponse(message.content);
    if (!response) return;

    const parent = options.parentAddress?.trim();
    if (!parent) {
      throw new Error("Family knowledge response refused: runtime has no parent lineage");
    }
    if (!sameAddress(message.from, parent)) {
      throw new Error(
        `Family knowledge response refused: sender ${message.from} is not parent ${parent}`,
      );
    }

    applyFamilyKnowledgeQueryResponse(db, parent, response);
  });
}

/**
 * Process only Family Knowledge carrier types from the already-persisted inbox.
 * This performs no polling; the existing social heartbeat remains the single
 * relay polling authority.
 */
export async function processFamilyKnowledgePeerInbox(params: {
  db: AbosDatabase;
  social: SocialClientInterface;
  identityAddress: string;
  parentAddress?: string;
}): Promise<ProcessedMessage[]> {
  const messaging = new ColonyMessaging(
    new SocialRelayTransport(params.social, params.db),
    params.db,
  );
  configureFamilyKnowledgePeerHandlers(messaging, params.db, {
    identityAddress: params.identityAddress,
    parentAddress: params.parentAddress,
  });
  return messaging.processInbox({ types: ["peer_query", "peer_response"] });
}

export async function sendFamilyKnowledgeQuery(
  db: AbosDatabase,
  social: SocialClientInterface,
  parentAddress: string,
  params: { query: string; category?: string | null; limit?: number },
): Promise<FamilyKnowledgeQueryRequest> {
  const localAddress = db.getIdentity("address");
  if (!localAddress) {
    throw new Error("Family knowledge query requires canonical local identity");
  }

  const request = createFamilyKnowledgeQueryRequest(db, parentAddress, params);
  const messaging = new ColonyMessaging(
    new SocialRelayTransport(social, db),
    db,
  );

  try {
    await messaging.send(
      messaging.createMessage({
        type: "peer_query",
        to: parentAddress,
        content: JSON.stringify(request),
        priority: "normal",
        requiresResponse: true,
        expiresAt: new Date(Date.now() + QUERY_TTL_MS).toISOString(),
      }),
    );
  } catch (error) {
    db.deleteKV(pendingKey(request.requestId));
    throw error;
  }

  return request;
}

export function getFamilyKnowledgeQueryResult(
  db: AbosDatabase,
  requestId: string,
): FamilyKnowledgeQueryResult | null {
  const raw = db.getKV(resultKey(requestId));
  if (!raw) return null;
  return parseJsonObject(raw, "Family knowledge query result") as unknown as FamilyKnowledgeQueryResult;
}
