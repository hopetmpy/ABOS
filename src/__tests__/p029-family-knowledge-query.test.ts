import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { KnowledgeStore } from "../memory/knowledge-store.js";
import { createDatabase } from "../state/database.js";
import { BUILTIN_TASKS } from "../heartbeat/tasks.js";
import {
  FAMILY_KNOWLEDGE_RESPONSE_PROTOCOL,
  applyFamilyKnowledgeQueryResponse,
  buildFamilyKnowledgeQueryResponse,
  createFamilyKnowledgeQueryRequest,
  parseFamilyKnowledgeQueryRequest,
  parseFamilyKnowledgeQueryResponse,
  type FamilyKnowledgeQueryResponse,
} from "../replication/family-knowledge-query.js";
import {
  MockSocialClient,
  createTestConfig,
  createTestDb,
  createTestIdentity,
} from "./mocks.js";

const PARENT = "0x2222222222222222222222222222222222222222";
const CHILD = "0x1111111111111111111111111111111111111111";
const STRANGER = "0x3333333333333333333333333333333333333333";

function addParentKnowledge(db: ReturnType<typeof createTestDb>) {
  const store = new KnowledgeStore(db.raw);
  store.add({
    category: "operational",
    key: "lesson:evidence-first",
    content: "Require evidence before declaring success.",
    source: "parent-observation",
    confidence: 0.95,
    lastVerified: "2026-09-25T00:00:00.000Z",
    tokenCount: 7,
    expiresAt: null,
  });
  store.add({
    category: "technical",
    key: "lesson:unrelated-cache",
    content: "Unrelated cache note.",
    source: "parent-observation",
    confidence: 0.9,
    lastVerified: "2026-09-25T00:00:00.000Z",
    tokenCount: 4,
    expiresAt: null,
  });
}

function addDirectChild(db: ReturnType<typeof createTestDb>) {
  db.insertChild({
    id: "child-query-1",
    name: "child-query",
    address: CHILD,
    sandboxId: "sandbox-child-query",
    genesisPrompt: "Query family knowledge.",
    fundedAmountCents: 0,
    status: "healthy",
    createdAt: "2026-09-25T00:00:00.000Z",
    chainType: "evm",
  });
}

function colonyEnvelope(params: {
  id: string;
  type: "peer_query" | "peer_response";
  from: string;
  to: string;
  content: string;
}): string {
  const now = new Date().toISOString();
  return JSON.stringify({
    protocol: "colony_message_v1",
    sentAt: now,
    message: {
      id: params.id,
      type: params.type,
      from: params.from,
      to: params.to,
      goalId: null,
      taskId: null,
      content: params.content,
      priority: "normal",
      requiresResponse: params.type === "peer_query",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      createdAt: now,
    },
  });
}

function relayMessage(params: {
  id: string;
  from: string;
  to: string;
  content: string;
}) {
  const now = new Date().toISOString();
  return {
    id: params.id,
    from: params.from,
    to: params.to,
    content: params.content,
    signedAt: now,
    createdAt: now,
    provenance: {
      transport: "social_relay",
      senderVerification: "relay_asserted",
      transportSender: params.from,
    },
  };
}

describe("P-029 selective family knowledge query", () => {
  it("round-trips parent -> child through the canonical heartbeat inbox and remains usable offline", async () => {
    const parentDb = createTestDb();
    const childDb = createTestDb();
    const parentSocial = new MockSocialClient();
    const childSocial = new MockSocialClient();

    try {
      parentDb.setIdentity("address", PARENT);
      childDb.setIdentity("address", CHILD);
      addDirectChild(parentDb);
      addParentKnowledge(parentDb);

      const request = createFamilyKnowledgeQueryRequest(childDb, PARENT, {
        query: "evidence",
        category: "operational",
        limit: 1,
      });
      const queryEnvelope = colonyEnvelope({
        id: "peer-query-1",
        type: "peer_query",
        from: CHILD,
        to: PARENT,
        content: JSON.stringify(request),
      });
      parentSocial.pollResponses.push({
        messages: [
          relayMessage({
            id: "relay-query-1",
            from: CHILD,
            to: PARENT,
            content: queryEnvelope,
          }),
        ],
      });

      await BUILTIN_TASKS.check_social_inbox({} as any, {
        db: parentDb,
        social: parentSocial,
        identity: { ...createTestIdentity(), address: PARENT as `0x${string}` },
        config: createTestConfig({ walletAddress: PARENT as `0x${string}` }),
      } as any);

      expect(parentSocial.sentMessages).toHaveLength(1);
      expect(parentSocial.sentMessages[0]!.to).toBe(CHILD);
      const responseEnvelope = parentSocial.sentMessages[0]!.content;
      const decoded = JSON.parse(responseEnvelope);
      expect(decoded.protocol).toBe("colony_message_v1");
      expect(decoded.message.type).toBe("peer_response");

      const response = parseFamilyKnowledgeQueryResponse(decoded.message.content);
      expect(response).not.toBeNull();
      expect(response!.requestId).toBe(request.requestId);
      expect(response!.knowledge).toHaveLength(1);
      expect(response!.knowledge[0]!.key).toBe("lesson:evidence-first");

      childSocial.pollResponses.push({
        messages: [
          relayMessage({
            id: "relay-response-1",
            from: PARENT,
            to: CHILD,
            content: responseEnvelope,
          }),
        ],
      });

      await BUILTIN_TASKS.check_social_inbox({} as any, {
        db: childDb,
        social: childSocial,
        identity: { ...createTestIdentity(), address: CHILD as `0x${string}` },
        config: createTestConfig({
          walletAddress: CHILD as `0x${string}`,
          parentAddress: PARENT as `0x${string}`,
        }),
      } as any);

      const inherited = new KnowledgeStore(childDb.raw).search(
        "evidence",
        "operational",
      );
      expect(inherited).toHaveLength(1);
      expect(inherited[0]!.key).toBe("lesson:evidence-first");
      expect(inherited[0]!.source).toContain(`family:v1:${PARENT}`);

      // Parent/relay is now absent. Previously imported knowledge remains local
      // and queryable, demonstrating offline operation after inheritance.
      const offline = new KnowledgeStore(childDb.raw).search("evidence");
      expect(offline).toHaveLength(1);
    } finally {
      parentDb.close();
      childDb.close();
    }
  });

  it("refuses unknown/terminal requesters and ignores unrelated peer payloads", () => {
    const parentDb = createTestDb();
    const childDb = createTestDb();
    try {
      parentDb.setIdentity("address", PARENT);
      addDirectChild(parentDb);
      addParentKnowledge(parentDb);
      const request = createFamilyKnowledgeQueryRequest(childDb, PARENT, {
        query: "evidence",
      });

      expect(() =>
        buildFamilyKnowledgeQueryResponse(parentDb, PARENT, STRANGER, request),
      ).toThrow(/not a direct known child/);

      parentDb.updateChildStatus("child-query-1", "failed");
      expect(() =>
        buildFamilyKnowledgeQueryResponse(parentDb, PARENT, CHILD, request),
      ).toThrow(/terminal/);

      expect(parseFamilyKnowledgeQueryRequest("plain peer query")).toBeNull();
      expect(parseFamilyKnowledgeQueryResponse("plain peer response")).toBeNull();
    } finally {
      parentDb.close();
      childDb.close();
    }
  });

  it("persists pending lineage across a database restart and applies exact replay idempotently", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "abos-p029-query-"));
    const dbPath = path.join(tmpDir, "state.db");
    let db = createDatabase(dbPath);

    try {
      db.setIdentity("address", CHILD);
      const request = createFamilyKnowledgeQueryRequest(db, PARENT, {
        query: "evidence",
        category: "operational",
        limit: 1,
      });
      db.close();

      db = createDatabase(dbPath);
      const response: FamilyKnowledgeQueryResponse = {
        protocol: FAMILY_KNOWLEDGE_RESPONSE_PROTOCOL,
        requestId: request.requestId,
        parentAddress: PARENT,
        query: request.query,
        category: request.category,
        generatedAt: new Date().toISOString(),
        knowledge: [
          {
            category: "operational",
            key: "lesson:evidence-first",
            content: "Require evidence before declaring success.",
            source: "parent-observation",
            confidence: 0.95,
            lastVerified: "2026-09-25T00:00:00.000Z",
            tokenCount: 7,
            expiresAt: null,
          },
        ],
      };

      const first = applyFamilyKnowledgeQueryResponse(db, PARENT, response);
      const replay = applyFamilyKnowledgeQueryResponse(db, PARENT, response);
      expect(first.imported).toBe(1);
      expect(replay).toEqual(first);
      expect(new KnowledgeStore(db.raw).search("evidence")).toHaveLength(1);
    } finally {
      try {
        db.close();
      } catch {
        // Already closed by an assertion path.
      }
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("rejects wrong-parent and unsolicited responses", () => {
    const childDb = createTestDb();
    try {
      const request = createFamilyKnowledgeQueryRequest(childDb, PARENT, {
        query: "evidence",
      });
      const response: FamilyKnowledgeQueryResponse = {
        protocol: FAMILY_KNOWLEDGE_RESPONSE_PROTOCOL,
        requestId: request.requestId,
        parentAddress: PARENT,
        query: request.query,
        category: request.category,
        generatedAt: new Date().toISOString(),
        knowledge: [],
      };

      expect(() =>
        applyFamilyKnowledgeQueryResponse(childDb, STRANGER, response),
      ).toThrow(/lineage mismatch/);

      const unsolicited = {
        ...response,
        requestId: "unsolicited-request",
      };
      expect(() =>
        applyFamilyKnowledgeQueryResponse(childDb, PARENT, unsolicited),
      ).toThrow(/Unsolicited/);
    } finally {
      childDb.close();
    }
  });
});
