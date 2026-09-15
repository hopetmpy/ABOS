import { afterEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import {
  claimInboxMessages,
  createDatabase,
} from "../state/database.js";
import { SCHEMA_VERSION } from "../state/schema.js";
import { createSocialClient } from "../social/client.js";
import {
  ColonyMessaging,
  LocalDBTransport,
  type MessageTransport,
} from "../orchestration/messaging.js";
import {
  buildInboxInputProvenance,
  deriveInboxInputSource,
} from "../agent/loop.js";
import type { AgentTurn, InboxMessage } from "../types.js";

function tmpDbPath(label: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `abos-p009-${label}-`));
  return path.join(dir, "state.db");
}

function structuredMessage(params: {
  outerFrom: string;
  outerTo: string;
  innerFrom?: string;
  innerTo?: string;
  id?: string;
}): InboxMessage {
  const now = new Date().toISOString();
  const inner = {
    id: `${params.id ?? "msg"}-inner`,
    type: "task_assignment",
    from: params.innerFrom ?? params.outerFrom,
    to: params.innerTo ?? params.outerTo,
    goalId: "goal-1",
    taskId: "task-1",
    content: "{}",
    priority: "high",
    requiresResponse: true,
    expiresAt: null,
    createdAt: now,
  };
  const raw = JSON.stringify({
    protocol: "colony_message_v1",
    sentAt: now,
    message: inner,
  });
  return {
    id: params.id ?? "msg",
    from: params.outerFrom,
    to: params.outerTo,
    content: raw,
    rawContent: raw,
    signedAt: now,
    createdAt: now,
    provenance: {
      transport: "social_relay",
      senderVerification: "relay_asserted",
      transportSender: params.outerFrom,
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("P-009 authority provenance", () => {
  it("marks Social poll sender as relay-asserted, not cryptographically verified", async () => {
    const account = privateKeyToAccount(
      "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784f7bf4f2ff80",
    );
    const sender = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: () => Promise.resolve({
        messages: [{
          id: "social-1",
          from: sender,
          to: account.address,
          content: "hello",
          signedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          nonce: "nonce-p009-1",
        }],
      }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const social = createSocialClient("https://relay.example.com", account);
    const result = await social.poll();

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.provenance).toEqual({
      transport: "social_relay",
      senderVerification: "relay_asserted",
      transportSender: sender,
    });
  });

  it("projects social and legacy inbox rows to external while local trusted rows remain agent", () => {
    const base = {
      id: "m",
      fromAddress: "sender",
      content: "hello",
      receivedAt: new Date().toISOString(),
      processedAt: null,
      replyTo: null,
      toAddress: "receiver",
      rawContent: null,
      status: "in_progress",
      retryCount: 1,
      maxRetries: 3,
      transportSender: "sender",
    };

    expect(deriveInboxInputSource([{
      ...base,
      transport: "social_relay",
      senderVerification: "relay_asserted",
    }])).toBe("external");
    expect(deriveInboxInputSource([{
      ...base,
      transport: "legacy_unknown",
      senderVerification: "unknown",
      transportSender: null,
    }])).toBe("external");
    expect(deriveInboxInputSource([{
      ...base,
      transport: "local_db",
      senderVerification: "local_trusted",
    }])).toBe("agent");
  });

  it("persists inbox and turn provenance across restart", () => {
    const dbPath = tmpDbPath("restart");
    const db = createDatabase(dbPath);
    const now = new Date().toISOString();
    db.insertInboxMessage({
      id: "persisted-social",
      from: "relay-sender",
      to: "me",
      content: "hello",
      signedAt: now,
      createdAt: now,
      provenance: {
        transport: "social_relay",
        senderVerification: "relay_asserted",
        transportSender: "relay-sender",
      },
    });
    const claimed = claimInboxMessages(db.raw, 1);
    expect(claimed[0]?.transport).toBe("social_relay");
    expect(claimed[0]?.senderVerification).toBe("relay_asserted");

    const provenance = buildInboxInputProvenance(claimed);
    const turn: AgentTurn = {
      id: "turn-p009",
      timestamp: now,
      state: "running",
      input: "hello",
      inputSource: "external",
      inputProvenance: provenance,
      thinking: "observed",
      toolCalls: [],
      tokenUsage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      costCents: 0,
    };
    db.insertTurn(turn);
    db.close();

    const reopened = createDatabase(dbPath);
    expect(reopened.getTurnById("turn-p009")?.inputSource).toBe("external");
    expect(reopened.getTurnById("turn-p009")?.inputProvenance).toEqual(provenance);
    reopened.close();
  });

  it("migrates v14 rows to legacy unknown without inventing trust", () => {
    const dbPath = tmpDbPath("migration");
    const raw = new Database(dbPath);
    raw.exec(`
      CREATE TABLE schema_version (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO schema_version (version) VALUES (14);
      CREATE TABLE turns (
        id TEXT PRIMARY KEY, timestamp TEXT NOT NULL, state TEXT NOT NULL,
        input TEXT, input_source TEXT, thinking TEXT NOT NULL,
        tool_calls TEXT NOT NULL DEFAULT '[]', token_usage TEXT NOT NULL DEFAULT '{}',
        cost_cents INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE inbox_messages (
        id TEXT PRIMARY KEY, from_address TEXT NOT NULL, content TEXT NOT NULL,
        received_at TEXT NOT NULL DEFAULT (datetime('now')), processed_at TEXT,
        reply_to TEXT, to_address TEXT, raw_content TEXT,
        status TEXT DEFAULT 'received', retry_count INTEGER DEFAULT 0,
        max_retries INTEGER DEFAULT 3
      );
      INSERT INTO inbox_messages (
        id, from_address, to_address, content, status
      ) VALUES ('legacy-1', 'legacy-sender', 'me', 'hello', 'received');
    `);
    raw.close();

    const migrated = createDatabase(dbPath);
    const version = migrated.raw
      .prepare("SELECT MAX(version) AS version FROM schema_version")
      .get() as { version: number };
    expect(version.version).toBe(SCHEMA_VERSION);
    const legacy = migrated.getUnprocessedInboxMessages(10)[0];
    expect(legacy?.provenance).toEqual({
      transport: "legacy_unknown",
      senderVerification: "unknown",
      transportSender: undefined,
    });
    const turnColumns = migrated.raw
      .prepare("PRAGMA table_info(turns)")
      .all() as Array<{ name: string }>;
    expect(turnColumns.map((column) => column.name)).toContain("input_provenance");
    migrated.close();
  });

  it("records LocalDB delivery as local trusted evidence", async () => {
    const db = createDatabase(tmpDbPath("local"));
    db.setIdentity("address", "local-parent");
    const transport = new LocalDBTransport(db);
    await transport.deliver("local-child", "hello");

    const claimed = claimInboxMessages(db.raw, 1);
    expect(claimed[0]?.transport).toBe("local_db");
    expect(claimed[0]?.senderVerification).toBe("local_trusted");
    expect(claimed[0]?.transportSender).toBe("local-parent");
    db.close();
  });

  it("rejects Colony inner sender spoofing before a handler can authorize it", async () => {
    const db = createDatabase(tmpDbPath("spoof-from"));
    const delivered: string[] = [];
    const transport: MessageTransport = {
      deliver: async (_to, envelope) => { delivered.push(envelope); },
      getRecipients: () => [],
    };
    const handler = vi.fn();
    const messaging = new ColonyMessaging(transport, db, {
      handlers: { task_assignment: handler },
    });
    db.insertInboxMessage(structuredMessage({
      id: "spoof-from",
      outerFrom: "actual-relay-sender",
      innerFrom: "configured-parent",
      outerTo: "child",
    }));

    const result = await messaging.processInbox({ types: ["task_assignment"] });
    expect(result[0]?.success).toBe(false);
    expect(result[0]?.error).toContain("message.from does not match transport sender");
    expect(handler).not.toHaveBeenCalled();
    expect(delivered).toHaveLength(0);
    db.close();
  });

  it("rejects Colony inner recipient mismatch and accepts a consistent envelope", async () => {
    const db = createDatabase(tmpDbPath("recipient"));
    const transport: MessageTransport = {
      deliver: async () => {},
      getRecipients: () => [],
    };
    const handler = vi.fn();
    const messaging = new ColonyMessaging(transport, db, {
      handlers: { task_assignment: handler },
    });

    db.insertInboxMessage(structuredMessage({
      id: "bad-to",
      outerFrom: "parent",
      outerTo: "child",
      innerTo: "different-child",
    }));
    let result = await messaging.processInbox({ types: ["task_assignment"] });
    expect(result[0]?.success).toBe(false);
    expect(result[0]?.error).toContain("message.to does not match transport recipient");
    expect(handler).not.toHaveBeenCalled();

    db.insertInboxMessage(structuredMessage({
      id: "good",
      outerFrom: "parent",
      outerTo: "child",
    }));
    result = await messaging.processInbox({ types: ["task_assignment"] });
    expect(result[0]?.success).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
    db.close();
  });
});
