import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDatabase } from "../state/database.js";
import {
  MIGRATION_V18_EVIDENCE_FABRIC,
  SCHEMA_VERSION,
} from "../state/schema.js";
import {
  appendEvidenceEvent,
  correlationIdFor,
  currentEvidenceContext,
  getEvidenceByAuthority,
  getEvidenceByCorrelation,
  redactEvidenceValue,
  runWithEvidenceContext,
} from "../observability/evidence.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "abos-p013-evidence-"));
  tempDirs.push(dir);
  return path.join(dir, "state.db");
}

describe("P-013 evidence fabric core", () => {
  it("creates schema v18 independently from the compactable memory event stream", () => {
    expect(SCHEMA_VERSION).toBe(18);
    const db = new Database(":memory:");
    db.exec(MIGRATION_V18_EVIDENCE_FABRIC);

    const columns = db.prepare("PRAGMA table_info(evidence_events)").all() as Array<{ name: string }>;
    const names = columns.map((column) => column.name);
    expect(names).toContain("correlation_id");
    expect(names).toContain("causation_id");
    expect(names).toContain("authority_type");
    expect(names).not.toContain("compacted_to");
    db.close();
  });

  it("applies v18 on a fresh canonical database", () => {
    const database = createDatabase(tempDbPath());
    const version = database.raw.prepare("SELECT MAX(version) AS version FROM schema_version").get() as { version: number };
    expect(version.version).toBe(18);
    expect(
      database.raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='evidence_events'").get(),
    ).toBeTruthy();
    database.raw.close();
  });

  it("appends an ordered causal chain without becoming domain state", () => {
    const db = new Database(":memory:");
    db.exec(MIGRATION_V18_EVIDENCE_FABRIC);
    const correlationId = correlationIdFor("turn", "turn-1");

    const first = appendEvidenceEvent(db, {
      correlationId,
      eventType: "policy.evaluated",
      domain: "policy",
      authorityType: "policy_decision",
      authorityId: "policy-1",
      turnId: "turn-1",
      toolCallId: "tool-1",
      payload: { action: "allow", argsHash: "abc" },
    });
    const second = appendEvidenceEvent(db, {
      correlationId,
      causationId: first.id,
      eventType: "self_mod.proposed",
      domain: "self_mod",
      authorityType: "self_mod_transaction",
      authorityId: "tx-1",
      turnId: "turn-1",
      toolCallId: "tool-1",
      payload: { status: "proposed" },
    });

    const chain = getEvidenceByCorrelation(db, correlationId);
    expect(chain.map((event) => event.id)).toEqual([first.id, second.id]);
    expect(chain[1].causationId).toBe(first.id);
    expect(getEvidenceByAuthority(db, "self_mod_transaction", "tx-1")).toHaveLength(1);
    db.close();
  });

  it("redacts structured secrets while preserving non-secret accounting fields", () => {
    const redacted = redactEvidenceValue({
      apiKey: "sk-super-secret-value-123456789",
      tokenCount: 321,
      nested: {
        authorization: "Bearer top.secret.token",
        url: "https://example.test/?access_token=secret-value&ok=1",
        message: "Authorization: Bearer another.secret.value",
      },
    }) as any;

    expect(redacted.apiKey).toBe("[REDACTED]");
    expect(redacted.tokenCount).toBe(321);
    expect(redacted.nested.authorization).toBe("[REDACTED]");
    expect(redacted.nested.url).toContain("access_token=[REDACTED]");
    expect(redacted.nested.url).not.toContain("secret-value");
    expect(redacted.nested.message).toContain("Bearer [REDACTED]");
  });

  it("redacts payload before durable insertion", () => {
    const db = new Database(":memory:");
    db.exec(MIGRATION_V18_EVIDENCE_FABRIC);
    const event = appendEvidenceEvent(db, {
      correlationId: "turn:t1",
      eventType: "tool.observed",
      domain: "tool",
      authorityType: "tool_call",
      authorityId: "c1",
      payload: { password: "never-store-me", result: "ok" },
      provenance: { access_token: "never-store-this-either", producer: "test" },
    });

    expect(event.payload).toEqual({ password: "[REDACTED]", result: "ok" });
    expect(event.provenance).toEqual({ access_token: "[REDACTED]", producer: "test" });
    const raw = db.prepare("SELECT payload_json, provenance_json FROM evidence_events WHERE id = ?").get(event.id) as any;
    expect(raw.payload_json).not.toContain("never-store-me");
    expect(raw.provenance_json).not.toContain("never-store-this-either");
    db.close();
  });

  it("propagates correlation context across async work but does not treat process memory as durable authority", async () => {
    expect(currentEvidenceContext()).toBeUndefined();
    await runWithEvidenceContext(
      { correlationId: "turn:turn-7", turnId: "turn-7", toolCallId: "tool-7" },
      async () => {
        await Promise.resolve();
        expect(currentEvidenceContext()).toMatchObject({
          correlationId: "turn:turn-7",
          turnId: "turn-7",
          toolCallId: "tool-7",
        });
      },
    );
    expect(currentEvidenceContext()).toBeUndefined();
  });

  it("rejects a causation id that is not an already-persisted evidence event", () => {
    const db = new Database(":memory:");
    db.exec(MIGRATION_V18_EVIDENCE_FABRIC);
    expect(() => appendEvidenceEvent(db, {
      correlationId: "test:causal-guard",
      causationId: "adaptive_path:not-an-evidence-event",
      eventType: "test.child",
      domain: "test",
      authorityType: "test_authority",
      authorityId: "child-1",
    })).toThrow(/causationId must reference an existing evidence event/);
    expect(db.prepare("SELECT COUNT(*) AS count FROM evidence_events").get()).toEqual({ count: 0 });
    db.close();
  });

  it("rejects empty correlation and event identity labels", () => {
    const db = new Database(":memory:");
    db.exec(MIGRATION_V18_EVIDENCE_FABRIC);
    expect(() => appendEvidenceEvent(db, {
      correlationId: " ",
      eventType: "x",
      domain: "test",
      authorityType: "test",
    })).toThrow(/correlationId cannot be empty/);
    expect(() => appendEvidenceEvent(db, {
      correlationId: "test:1",
      eventType: " ",
      domain: "test",
      authorityType: "test",
    })).toThrow(/eventType cannot be empty/);
    db.close();
  });
});
