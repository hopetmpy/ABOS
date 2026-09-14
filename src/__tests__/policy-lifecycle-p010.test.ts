import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDatabase } from "../state/database.js";
import { PolicyEngine } from "../agent/policy-engine.js";
import {
  claimApprovedPolicyAuthorization,
  computePolicyScopeHash,
  listPendingPolicyAuthorizations,
} from "../agent/policy-authorization.js";
import { executeTool } from "../agent/tools.js";
import type { AbosTool, PolicyRequest, PolicyRule, ToolContext } from "../types.js";
import { createTestConfig } from "./mocks.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function fixturePath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "abos-p010-"));
  dirs.push(dir);
  return path.join(dir, "state.db");
}

function quarantinedRule(): PolicyRule {
  return {
    id: "test.authorization_required",
    description: "Require authorization",
    priority: 1,
    appliesTo: { by: "all" },
    evaluate: () => ({
      rule: "test.authorization_required",
      action: "quarantine",
      reasonCode: "AUTHORIZATION_REQUIRED",
      humanMessage: "creator authorization required",
    }),
  };
}

function requestFor(tool: AbosTool, context: ToolContext): PolicyRequest {
  return {
    tool,
    args: { amount_cents: 2500 },
    context,
    turnContext: {
      inputSource: "external",
      turnToolCallCount: 0,
    },
  };
}

describe("P-010 durable policy lifecycle", () => {
  it("migrates policy_decisions to schema v16 additively", () => {
    const db = createDatabase(fixturePath());
    const version = db.raw.prepare("SELECT MAX(version) AS version FROM schema_version").get() as { version: number };
    expect(version.version).toBe(16);
    const columns = db.raw.prepare("PRAGMA table_info(policy_decisions)").all() as Array<{ name: string }>;
    const names = new Set(columns.map((entry) => entry.name));
    for (const required of [
      "lifecycle_state",
      "scope_hash",
      "authorization_json",
      "approved_at",
      "claim_token",
      "execution_state",
      "constitution_result",
    ]) {
      expect(names.has(required), required).toBe(true);
    }
    db.close();
  });

  it("persists pending authorization before refusing the effect", async () => {
    const db = createDatabase(fixturePath());
    let effects = 0;
    const tool: AbosTool = {
      name: "test_money_effect",
      description: "test",
      category: "financial",
      riskLevel: "dangerous",
      parameters: { type: "object", properties: {} },
      execute: async () => { effects += 1; return "executed"; },
    };
    const context = { db, config: createTestConfig() } as ToolContext;
    const engine = new PolicyEngine(db.raw, [quarantinedRule()]);
    const result = await executeTool(
      tool.name,
      { amount_cents: 2500 },
      [tool],
      context,
      engine,
      { inputSource: "external", turnToolCallCount: 0 },
    );
    expect(result.error).toContain("Policy authorization required");
    expect(effects).toBe(0);
    const pending = listPendingPolicyAuthorizations(db.raw);
    expect(pending).toHaveLength(1);
    db.close();
  });

  it("consumes one exact approved scope once and refuses replay", async () => {
    const db = createDatabase(fixturePath());
    let effects = 0;
    const tool: AbosTool = {
      name: "test_money_effect",
      description: "test",
      category: "financial",
      riskLevel: "dangerous",
      parameters: { type: "object", properties: {} },
      execute: async () => { effects += 1; return "executed"; },
    };
    const context = { db, config: createTestConfig() } as ToolContext;
    const engine = new PolicyEngine(db.raw, [quarantinedRule()]);
    const turnContext = { inputSource: "external" as const, turnToolCallCount: 0 };

    const first = await executeTool(tool.name, { amount_cents: 2500 }, [tool], context, engine, turnContext);
    expect(first.error).toContain("Policy authorization required");
    const pending = listPendingPolicyAuthorizations(db.raw);
    expect(pending).toHaveLength(1);
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    const approvedAt = new Date().toISOString();
    db.raw.prepare(
      "UPDATE policy_decisions SET lifecycle_state='approved', expires_at=?, approved_at=? WHERE id=?",
    ).run(expiresAt, approvedAt, pending[0].id);

    const second = await executeTool(tool.name, { amount_cents: 2500 }, [tool], context, engine, turnContext);
    expect(second.error).toBeUndefined();
    expect(second.result).toBe("executed");
    expect(effects).toBe(1);

    const third = await executeTool(tool.name, { amount_cents: 2500 }, [tool], context, engine, turnContext);
    expect(third.error).toContain("Policy authorization required");
    expect(effects).toBe(1);

    const consumed = db.raw.prepare(
      "SELECT lifecycle_state, claimed_at, claim_token FROM policy_decisions WHERE id=?",
    ).get(pending[0].id) as { lifecycle_state: string; claimed_at: string | null; claim_token: string | null };
    expect(consumed.lifecycle_state).toBe("consumed");
    expect(consumed.claimed_at).toBeTruthy();
    expect(consumed.claim_token).toBeTruthy();
    db.close();
  });

  it("preserves an approved authorization across restart and still claims it once", () => {
    const dbPath = fixturePath();
    let db = createDatabase(dbPath);
    const tool: AbosTool = {
      name: "restart_scope",
      description: "test",
      category: "financial",
      riskLevel: "dangerous",
      parameters: { type: "object", properties: {} },
      execute: async () => "unused",
    };
    let context = { db, config: createTestConfig() } as ToolContext;
    const request = requestFor(tool, context);
    const engine = new PolicyEngine(db.raw, [quarantinedRule()]);
    const decision = engine.evaluate(request);
    engine.persistDecision(decision, request);
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    db.raw.prepare(
      "UPDATE policy_decisions SET lifecycle_state='approved', expires_at=?, approved_at=? WHERE id=?",
    ).run(expiresAt, new Date().toISOString(), decision.id);
    const scopeHash = computePolicyScopeHash(request);
    db.close();

    db = createDatabase(dbPath);
    context = { db, config: createTestConfig() } as ToolContext;
    void context;
    const first = claimApprovedPolicyAuthorization(db.raw, scopeHash);
    const second = claimApprovedPolicyAuthorization(db.raw, scopeHash);
    expect(first?.decisionId).toBe(decision.id);
    expect(second).toBeNull();
    db.close();
  });

  it("does not resurrect a consumed authorization after restart", () => {
    const dbPath = fixturePath();
    let db = createDatabase(dbPath);
    const tool: AbosTool = {
      name: "restart_consumed_scope",
      description: "test",
      category: "financial",
      riskLevel: "dangerous",
      parameters: { type: "object", properties: {} },
      execute: async () => "unused",
    };
    const context = { db, config: createTestConfig() } as ToolContext;
    const request = requestFor(tool, context);
    const engine = new PolicyEngine(db.raw, [quarantinedRule()]);
    const decision = engine.evaluate(request);
    engine.persistDecision(decision, request);
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    db.raw.prepare(
      "UPDATE policy_decisions SET lifecycle_state='approved', expires_at=?, approved_at=? WHERE id=?",
    ).run(expiresAt, new Date().toISOString(), decision.id);
    const scopeHash = computePolicyScopeHash(request);
    expect(claimApprovedPolicyAuthorization(db.raw, scopeHash)?.decisionId).toBe(decision.id);
    db.close();

    db = createDatabase(dbPath);
    expect(claimApprovedPolicyAuthorization(db.raw, scopeHash)).toBeNull();
    const row = db.raw.prepare(
      "SELECT lifecycle_state, claim_token, claimed_at FROM policy_decisions WHERE id=?",
    ).get(decision.id) as { lifecycle_state: string; claim_token: string | null; claimed_at: string | null };
    expect(row.lifecycle_state).toBe("consumed");
    expect(row.claim_token).toBeTruthy();
    expect(row.claimed_at).toBeTruthy();
    db.close();
  });
});
