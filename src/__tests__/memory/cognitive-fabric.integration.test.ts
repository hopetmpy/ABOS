import Database from "better-sqlite3";
import type BetterSqlite3 from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EnhancedRetriever } from "../../memory/enhanced-retriever.js";
import { KnowledgeStore } from "../../memory/knowledge-store.js";
import { MIGRATION_V10 } from "../../state/schema.js";

const openKnowledgeDb = (path: string): BetterSqlite3.Database => {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
};

const addKnowledge = (
  store: KnowledgeStore,
  params: {
    category: string;
    key: string;
    content: string;
    confidence?: number;
    expiresAt?: string | null;
  },
): string => store.add({
  category: params.category,
  key: params.key,
  content: params.content,
  source: "p020-integration",
  confidence: params.confidence ?? 0.9,
  lastVerified: new Date().toISOString(),
  tokenCount: 24,
  expiresAt: params.expiresAt ?? null,
});

describe("P-020 cognitive fabric integration", () => {
  const cleanupDirs: string[] = [];
  const openDbs: BetterSqlite3.Database[] = [];

  afterEach(() => {
    for (const db of openDbs.splice(0)) {
      if (db.open) db.close();
    }
    for (const dir of cleanupDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reactivates durable open-world knowledge after a SQLite restart", () => {
    const dir = mkdtempSync(join(tmpdir(), "abos-p020-restart-"));
    cleanupDirs.push(dir);
    const dbPath = join(dir, "cognitive.sqlite");

    const firstDb = openKnowledgeDb(dbPath);
    firstDb.exec(MIGRATION_V10);
    const firstStore = new KnowledgeStore(firstDb);
    const durableId = addKnowledge(firstStore, {
      category: "legal-regulatory",
      key: "restart-recovery-policy",
      content: "restart recovery policy persists durable cognitive state",
    });
    firstDb.close();

    const restartedDb = openKnowledgeDb(dbPath);
    openDbs.push(restartedDb);
    const retriever = new EnhancedRetriever(restartedDb);
    const result = retriever.retrieveScored({
      sessionId: "restart-session",
      currentInput: "restart recovery policy durable cognitive state",
      budgetTokens: 500,
    });

    expect(result.entries.map((candidate) => candidate.entry.id)).toContain(durableId);
    expect(result.entries.find((candidate) => candidate.entry.id === durableId)?.entry.category)
      .toBe("legal-regulatory");
  });

  it("keeps stale facts dormant and activates relevant live knowledge on demand", () => {
    const db = openKnowledgeDb(":memory:");
    openDbs.push(db);
    db.exec(MIGRATION_V10);
    const store = new KnowledgeStore(db);

    const liveId = addKnowledge(store, {
      category: "technical",
      key: "api-timeout-live",
      content: "api timeout live policy uses bounded retries",
    });
    const staleId = addKnowledge(store, {
      category: "technical",
      key: "api-timeout-stale",
      content: "api timeout stale policy uses unlimited retries",
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });

    const retriever = new EnhancedRetriever(db);
    const dormant = retriever.retrieveScored({
      sessionId: "activation-session",
      currentInput: "unrelated lunar gardening note",
      budgetTokens: 500,
    });
    expect(dormant.entries).toHaveLength(0);

    const activated = retriever.retrieveScored({
      sessionId: "activation-session",
      currentInput: "api timeout policy retries",
      budgetTokens: 500,
    });
    const activatedIds = activated.entries.map((candidate) => candidate.entry.id);
    expect(activatedIds).toContain(liveId);
    expect(activatedIds).not.toContain(staleId);
  });

  it("preserves conflicting live knowledge as separate evidence instead of silently collapsing it", () => {
    const db = openKnowledgeDb(":memory:");
    openDbs.push(db);
    db.exec(MIGRATION_V10);
    const store = new KnowledgeStore(db);

    const firstId = addKnowledge(store, {
      category: "operational",
      key: "provider-a-timeout-policy",
      content: "provider timeout policy states thirty seconds",
      confidence: 0.95,
    });
    const secondId = addKnowledge(store, {
      category: "operational",
      key: "provider-b-timeout-policy",
      content: "provider timeout policy states sixty seconds",
      confidence: 0.7,
    });

    const retriever = new EnhancedRetriever(db);
    const result = retriever.retrieveScored({
      sessionId: "conflict-session",
      currentInput: "provider timeout policy seconds",
      budgetTokens: 500,
    });
    const ids = result.entries.map((candidate) => candidate.entry.id);

    expect(ids).toContain(firstId);
    expect(ids).toContain(secondId);
    expect(result.entries.find((candidate) => candidate.entry.id === firstId)?.entry.content)
      .not.toBe(result.entries.find((candidate) => candidate.entry.id === secondId)?.entry.content);
  });
});
