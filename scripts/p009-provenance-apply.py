from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one match, found {count}: {old[:120]!r}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")
    print(f"patched {path}")


# 1. Shared contracts: explicit external input + persisted provenance.
replace_once(
    "src/types.ts",
    '''export interface AgentTurn {\n  id: string;\n  timestamp: string;\n  state: AgentState;\n  input?: string;\n  inputSource?: InputSource;\n  thinking: string;''',
    '''export interface AgentTurn {\n  id: string;\n  timestamp: string;\n  state: AgentState;\n  input?: string;\n  inputSource?: InputSource;\n  /** Durable explanation of the inbound evidence that produced this turn. */\n  inputProvenance?: TurnInputProvenance;\n  thinking: string;''',
)
replace_once(
    "src/types.ts",
    '''export type InputSource =\n  | "heartbeat"\n  | "creator"\n  | "agent"\n  | "system"\n  | "wakeup";''',
    '''export type InputSource =\n  | "heartbeat"\n  | "creator"\n  | "agent"\n  | "external"\n  | "system"\n  | "wakeup";''',
)
replace_once(
    "src/types.ts",
    '''export interface InboxMessage {\n  id: string;\n  from: string;\n  to: string;''',
    '''/**\n * Evidence about how an inbound sender identity was observed. Values are open\n * strings so new transports/verification mechanisms do not require a core\n * allowlist. They are evidence, not a second identity authority.\n */\nexport interface MessageProvenance {\n  transport: string;\n  senderVerification: string;\n  /** Sender identity observed/asserted by the transport, when available. */\n  transportSender?: string;\n}\n\nexport interface TurnInputMessageProvenance extends MessageProvenance {\n  messageId: string;\n  assertedSender: string;\n}\n\nexport interface TurnInputProvenance {\n  messages: TurnInputMessageProvenance[];\n  transformations: string[];\n}\n\nexport interface InboxMessage {\n  id: string;\n  from: string;\n  to: string;''',
)
replace_once(
    "src/types.ts",
    '''  createdAt: string;\n  replyTo?: string;\n}\n\n// ─── Heartbeat''',
    '''  createdAt: string;\n  replyTo?: string;\n  /** Transport/verification evidence. Missing means legacy unknown. */\n  provenance?: MessageProvenance;\n}\n\n// ─── Heartbeat''',
)

# 2. Additive V15 persistence. Legacy rows must remain unknown, never promoted.
replace_once("src/state/schema.ts", "export const SCHEMA_VERSION = 14;", "export const SCHEMA_VERSION = 15;")
with Path("src/state/schema.ts").open("a", encoding="utf-8") as f:
    f.write('''\n\n// === Authority / Provenance v1 ===\n// Additive only. Existing inbox rows intentionally default to legacy/unknown.\nexport const MIGRATION_V15_ALTER_INBOX_TRANSPORT = `\n  ALTER TABLE inbox_messages ADD COLUMN transport TEXT NOT NULL DEFAULT 'legacy_unknown';\n`;\n\nexport const MIGRATION_V15_ALTER_INBOX_SENDER_VERIFICATION = `\n  ALTER TABLE inbox_messages ADD COLUMN sender_verification TEXT NOT NULL DEFAULT 'unknown';\n`;\n\nexport const MIGRATION_V15_ALTER_INBOX_TRANSPORT_SENDER = `\n  ALTER TABLE inbox_messages ADD COLUMN transport_sender TEXT;\n`;\n\nexport const MIGRATION_V15_ALTER_TURNS_INPUT_PROVENANCE = `\n  ALTER TABLE turns ADD COLUMN input_provenance TEXT;\n`;\n''')
print("patched src/state/schema.ts")

# 3. Database round-trip and migration runner.
replace_once(
    "src/state/database.ts",
    '''  MIGRATION_V13,\n  MIGRATION_V14,\n} from "./schema.js";''',
    '''  MIGRATION_V13,\n  MIGRATION_V14,\n  MIGRATION_V15_ALTER_INBOX_TRANSPORT,\n  MIGRATION_V15_ALTER_INBOX_SENDER_VERIFICATION,\n  MIGRATION_V15_ALTER_INBOX_TRANSPORT_SENDER,\n  MIGRATION_V15_ALTER_TURNS_INPUT_PROVENANCE,\n} from "./schema.js";''',
)
replace_once(
    "src/state/database.ts",
    '''      `INSERT INTO turns (id, timestamp, state, input, input_source, thinking, tool_calls, token_usage, cost_cents)\n       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,\n    ).run(\n      turn.id,\n      turn.timestamp,\n      turn.state,\n      turn.input ?? null,\n      turn.inputSource ?? null,\n      turn.thinking,\n      JSON.stringify(turn.toolCalls),\n      JSON.stringify(turn.tokenUsage),\n      turn.costCents,\n    );''',
    '''      `INSERT INTO turns (id, timestamp, state, input, input_source, input_provenance, thinking, tool_calls, token_usage, cost_cents)\n       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,\n    ).run(\n      turn.id,\n      turn.timestamp,\n      turn.state,\n      turn.input ?? null,\n      turn.inputSource ?? null,\n      turn.inputProvenance ? JSON.stringify(turn.inputProvenance) : null,\n      turn.thinking,\n      JSON.stringify(turn.toolCalls),\n      JSON.stringify(turn.tokenUsage),\n      turn.costCents,\n    );''',
)
replace_once(
    "src/state/database.ts",
    '''      `INSERT OR IGNORE INTO inbox_messages (\n        id, from_address, to_address, content, raw_content,\n        received_at, reply_to, status\n      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'received')`,\n    ).run(\n      msg.id,\n      msg.from,\n      msg.to,\n      msg.content,\n      msg.rawContent ?? null,\n      msg.createdAt || new Date().toISOString(),\n      msg.replyTo ?? null,\n    );''',
    '''      `INSERT OR IGNORE INTO inbox_messages (\n        id, from_address, to_address, content, raw_content,\n        received_at, reply_to, transport, sender_verification, transport_sender, status\n      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'received')`,\n    ).run(\n      msg.id,\n      msg.from,\n      msg.to,\n      msg.content,\n      msg.rawContent ?? null,\n      msg.createdAt || new Date().toISOString(),\n      msg.replyTo ?? null,\n      msg.provenance?.transport ?? "legacy_unknown",\n      msg.provenance?.senderVerification ?? "unknown",\n      msg.provenance?.transportSender ?? null,\n    );''',
)
replace_once(
    "src/state/database.ts",
    '''      `SELECT id, from_address, content, received_at, processed_at, reply_to, to_address, raw_content,\n              status, retry_count, max_retries\n       FROM inbox_messages''',
    '''      `SELECT id, from_address, content, received_at, processed_at, reply_to, to_address, raw_content,\n              transport, sender_verification, transport_sender, status, retry_count, max_retries\n       FROM inbox_messages''',
)
replace_once(
    "src/state/database.ts",
    '''      rawContent: row.raw_content ?? null,\n      status: "in_progress" as const,''',
    '''      rawContent: row.raw_content ?? null,\n      transport: row.transport ?? "legacy_unknown",\n      senderVerification: row.sender_verification ?? "unknown",\n      transportSender: row.transport_sender ?? null,\n      status: "in_progress" as const,''',
)
replace_once(
    "src/state/database.ts",
    '''  rawContent: string | null;\n  status: string;''',
    '''  rawContent: string | null;\n  transport: string;\n  senderVerification: string;\n  transportSender: string | null;\n  status: string;''',
)
replace_once(
    "src/state/database.ts",
    '''    input: row.input ?? undefined,\n    inputSource: row.input_source ?? undefined,\n    thinking: row.thinking,''',
    '''    input: row.input ?? undefined,\n    inputSource: row.input_source ?? undefined,\n    inputProvenance: row.input_provenance\n      ? safeJsonParse(\n          row.input_provenance,\n          undefined as AgentTurn["inputProvenance"],\n          "deserializeTurn.inputProvenance",\n        )\n      : undefined,\n    thinking: row.thinking,''',
)
replace_once(
    "src/state/database.ts",
    '''    createdAt: row.received_at,\n    replyTo: row.reply_to ?? undefined,\n  };\n}\n\nfunction deserializeReputation''',
    '''    createdAt: row.received_at,\n    replyTo: row.reply_to ?? undefined,\n    provenance: {\n      transport: row.transport ?? "legacy_unknown",\n      senderVerification: row.sender_verification ?? "unknown",\n      transportSender: row.transport_sender ?? undefined,\n    },\n  };\n}\n\nfunction deserializeReputation''',
)
replace_once(
    "src/state/database.ts",
    '''    {\n      version: 14,\n      apply: () => db.exec(MIGRATION_V14),\n    },\n  ];''',
    '''    {\n      version: 14,\n      apply: () => db.exec(MIGRATION_V14),\n    },\n    {\n      version: 15,\n      apply: () => {\n        try { db.exec(MIGRATION_V15_ALTER_INBOX_TRANSPORT); } catch { logger.debug("V15 ALTER (inbox transport) skipped — column likely exists"); }\n        try { db.exec(MIGRATION_V15_ALTER_INBOX_SENDER_VERIFICATION); } catch { logger.debug("V15 ALTER (inbox sender_verification) skipped — column likely exists"); }\n        try { db.exec(MIGRATION_V15_ALTER_INBOX_TRANSPORT_SENDER); } catch { logger.debug("V15 ALTER (inbox transport_sender) skipped — column likely exists"); }\n        try { db.exec(MIGRATION_V15_ALTER_TURNS_INPUT_PROVENANCE); } catch { logger.debug("V15 ALTER (turn input_provenance) skipped — column likely exists"); }\n      },\n    },\n  ];''',
)

# 4. Social ingress: preserve what is actually known, without inventing crypto verification.
replace_once(
    "src/social/client.ts",
    '''          signedAt: m.signedAt,\n          createdAt: m.createdAt,\n          replyTo: m.replyTo,\n        })),''',
    '''          signedAt: m.signedAt,\n          createdAt: m.createdAt,\n          replyTo: m.replyTo,\n          provenance: {\n            transport: "social_relay",\n            senderVerification: "relay_asserted",\n            transportSender: m.from,\n          },\n        })),''',
)

# 5. Existing policy authority recognizes the explicit external source.
replace_once(
    "src/agent/policy-rules/authority.ts",
    '''function isExternalSource(inputSource: string | undefined): boolean {\n  return inputSource === undefined || inputSource === "heartbeat";\n}''',
    '''function isExternalSource(inputSource: string | undefined): boolean {\n  return (\n    inputSource === undefined ||\n    inputSource === "heartbeat" ||\n    inputSource === "external"\n  );\n}''',
)

# 6. Agent loop: derive authority from persisted transport evidence, not from the fact that ABOS received it.
replace_once(
    "src/agent/loop.ts",
    '''const MAX_REPETITIVE_TURNS = 3;\n\nexport interface AgentLoopOptions''',
    '''const MAX_REPETITIVE_TURNS = 3;\n\n/**\n * Project durable inbox evidence onto the existing InputSource policy contract.\n * Only the in-process LocalDB path is treated as agent-originated; social and\n * legacy/unknown transports remain external/untrusted.\n */\nexport function deriveInboxInputSource(\n  messages: readonly InboxMessageRow[],\n): InputSource {\n  if (messages.length === 0) return "external";\n  return messages.every(\n    (message) =>\n      message.transport === "local_db" &&\n      message.senderVerification === "local_trusted",\n  )\n    ? "agent"\n    : "external";\n}\n\nexport function buildInboxInputProvenance(\n  messages: readonly InboxMessageRow[],\n): NonNullable<AgentTurn["inputProvenance"]> {\n  return {\n    messages: messages.map((message) => ({\n      messageId: message.id,\n      assertedSender: message.fromAddress,\n      transportSender: message.transportSender ?? undefined,\n      transport: message.transport,\n      senderVerification: message.senderVerification,\n    })),\n    transformations: [\n      "inbox_claimed",\n      "content_sanitized_and_formatted_for_inference",\n      "authority_derived_from_transport_evidence",\n    ],\n  };\n}\n\nexport interface AgentLoopOptions''',
)
replace_once(
    "src/agent/loop.ts",
    '''  let pendingInput: { content: string; source: string } | undefined = {\n    content: wakeupInput,\n    source: "wakeup",\n  };''',
    '''  let pendingInput:\n    | {\n        content: string;\n        source: InputSource;\n        provenance?: AgentTurn["inputProvenance"];\n      }\n    | undefined = {\n    content: wakeupInput,\n    source: "wakeup",\n  };''',
)
replace_once(
    "src/agent/loop.ts",
    '''          pendingInput = { content: formatted, source: "agent" };''',
    '''          pendingInput = {\n            content: formatted,\n            source: deriveInboxInputSource(claimedMessages),\n            provenance: buildInboxInputProvenance(claimedMessages),\n          };''',
)
replace_once(
    "src/agent/loop.ts",
    '''        input: currentInput?.content,\n        inputSource: currentInput?.source as any,\n        thinking: response.message.content || "",''',
    '''        input: currentInput?.content,\n        inputSource: currentInput?.source,\n        inputProvenance: currentInput?.provenance,\n        thinking: response.message.content || "",''',
)

# 7. Structured Colony forwarding: bind inner claims to outer transport evidence before authorization.
replace_once(
    "src/orchestration/messaging.ts",
    '''    this.db.raw.prepare(\n      `INSERT INTO inbox_messages (id, from_address, to_address, content, received_at, status)\n       VALUES (?, ?, ?, ?, datetime('now'), 'received')`,\n    ).run(id, fromAddress, to, envelope);''',
    '''    this.db.raw.prepare(\n      `INSERT INTO inbox_messages (\n         id, from_address, to_address, content, received_at,\n         transport, sender_verification, transport_sender, status\n       ) VALUES (?, ?, ?, ?, datetime('now'), 'local_db', 'local_trusted', ?, 'received')`,\n    ).run(id, fromAddress, to, envelope, fromAddress);''',
)
replace_once(
    "src/orchestration/messaging.ts",
    '''    createdAt: row.receivedAt,\n    replyTo: row.replyTo ?? undefined,\n  };\n}\n\nfunction parseInboundMessage''',
    '''    createdAt: row.receivedAt,\n    replyTo: row.replyTo ?? undefined,\n    provenance: {\n      transport: row.transport,\n      senderVerification: row.senderVerification,\n      transportSender: row.transportSender ?? undefined,\n    },\n  };\n}\n\nfunction parseInboundMessage''',
)
replace_once(
    "src/orchestration/messaging.ts",
    '''  const msg = candidate as AgentMessage;\n  if (msg.expiresAt && Date.parse(msg.expiresAt) < Date.now()) {''',
    '''  const msg = candidate as AgentMessage;\n  bindMessageIdentityToTransport(row, msg);\n  if (msg.expiresAt && Date.parse(msg.expiresAt) < Date.now()) {''',
)
replace_once(
    "src/orchestration/messaging.ts",
    '''  return msg;\n}\n\nfunction validateMessage(message: unknown): asserts message is AgentMessage {''',
    '''  return msg;\n}\n\nfunction bindMessageIdentityToTransport(\n  inbox: InboxMessage,\n  message: AgentMessage,\n): void {\n  const observedSender =\n    inbox.provenance?.transportSender ?? inbox.from;\n  if (!sameObservedIdentity(message.from, observedSender)) {\n    throw new Error(\n      `message.from does not match transport sender: inner=${message.from}, outer=${observedSender}`,\n    );\n  }\n\n  if (inbox.to && !sameObservedIdentity(message.to, inbox.to)) {\n    throw new Error(\n      `message.to does not match transport recipient: inner=${message.to}, outer=${inbox.to}`,\n    );\n  }\n}\n\nfunction sameObservedIdentity(left: string, right: string): boolean {\n  if (left.startsWith("0x") && right.startsWith("0x")) {\n    return left.toLowerCase() === right.toLowerCase();\n  }\n  return left === right;\n}\n\nfunction validateMessage(message: unknown): asserts message is AgentMessage {''',
)

# 8. Existing authority regression test: explicit external must behave like legacy external.
replace_once(
    "src/__tests__/authority-rules.test.ts",
    '''    it("blocks spawn_child from heartbeat input", () => {''',
    '''    it("blocks destructive tools from explicit external input", () => {\n      const rules = createAuthorityRules();\n      const engine = new PolicyEngine(db, rules);\n\n      const tool = createMockTool({\n        name: "delete_sandbox",\n        riskLevel: "dangerous",\n        category: "conway",\n      });\n      const request = createRequest(tool, {}, "external");\n\n      const decision = engine.evaluate(request);\n      expect(decision.action).toBe("deny");\n      expect(decision.reasonCode).toBe("EXTERNAL_DANGEROUS_TOOL");\n      expect(decision.authorityLevel).toBe("external");\n    });\n\n    it("blocks spawn_child from heartbeat input", () => {''',
)

# 9. Focused adversarial coverage across ingress -> persistence -> policy projection -> Colony binding.
test_path = Path("src/__tests__/authority-provenance.test.ts")
if test_path.exists():
    raise SystemExit(f"{test_path}: already exists; refusing blind overwrite")
test_path.write_text(r'''import { afterEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import {
  claimInboxMessages,
  createDatabase,
} from "../state/database.js";
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
    expect(version.version).toBe(15);
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
''', encoding="utf-8")
print(f"created {test_path}")

print("P-009 patch prepared successfully")
