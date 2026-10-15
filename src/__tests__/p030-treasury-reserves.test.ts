import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AbosDatabase } from "../types.js";
import { createDatabase } from "../state/database.js";
import { createTestDb } from "./mocks.js";
import { getTreasuryProjection } from "../economics/treasury-projection.js";
import { getTreasuryReserveSnapshot, setTreasuryReserve } from "../economics/treasury-reserves.js";
import { prepareFinancialEffect } from "../economics/financial-effects.js";

const open: AbosDatabase[] = [];
const dirs: string[] = [];
const db = () => { const v = createTestDb(); open.push(v); return v; };
afterEach(() => {
  for (const d of open.splice(0)) { try { d.close(); } catch { /* restarted */ } }
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
const alloc = (operationKey: string, reserveKey: string, targetCreditsCents: number) => ({
  operationKey, reserveKey, targetCreditsCents,
  decisionId: "P025:review-1",
  decisionEvidence: "scenario+alternatives inspected by existing strategic owner",
  observedCreditsCents: 1000,
  balanceEvidence: "test-provider-observation-only",
  otherCommittedCreditsCents: 100,
});

describe("P-030 durable internal reserve authority", () => {
  it("starts UNKNOWN without a reserve source; persists an earmark without sending money", () => {
    const d = db();
    expect(getTreasuryProjection(d, { observedCreditsCents: 1000, otherCommittedCreditsCents: 100 })
      .reservedCreditsCents).toBeNull();
    const created = setTreasuryReserve(d, alloc("op-1", "provider-failure", 200));
    expect(created.applied).toBe(true);
    expect(created.currentTotalCreditsCents).toBe(200);
    const projection = getTreasuryProjection(d, {
      observedCreditsCents: 1000, otherCommittedCreditsCents: 100,
    });
    expect(projection.reserveSource).toBe("durable");
    expect(projection.reservedCreditsCents).toBe(200);
    expect(projection.freeCreditsCents).toBe(700);
    expect((d.raw.prepare("SELECT count(*) AS n FROM transactions").get() as {n:number}).n).toBe(0);
    expect((d.raw.prepare("SELECT count(*) AS n FROM evidence_events WHERE authority_type='treasury_reserve'").get() as {n:number}).n).toBe(1);
  });

  it("prevents a caller's stale reserve input from bypassing durable authority", () => {
    const d = db();
    setTreasuryReserve(d, alloc("op-1", "res-1", 200));
    expect(() => getTreasuryProjection(d, {
      observedCreditsCents: 1000, reservedCreditsCents: 0,
      otherCommittedCreditsCents: 0,
    })).toThrow(/conflicts with durable/);
    expect(getTreasuryProjection(d, { observedCreditsCents: 1000,
      reservedCreditsCents: 200, otherCommittedCreditsCents: 0 }).reservedCreditsCents).toBe(200);
  });

  it("supports independent reserves, revisions and release while preserving append-only operations", () => {
    const d = db();
    setTreasuryReserve(d, alloc("op-1", "provider", 200));
    setTreasuryReserve(d, alloc("op-2", "maintenance", 100));
    expect(getTreasuryReserveSnapshot(d.raw).totalCreditsCents).toBe(300);
    setTreasuryReserve(d, alloc("op-3", "provider", 250));
    expect(getTreasuryReserveSnapshot(d.raw).totalCreditsCents).toBe(350);
    setTreasuryReserve(d, { ...alloc("op-4", "maintenance", 0), observedCreditsCents: null, balanceEvidence: null,
      otherCommittedCreditsCents: null });
    expect(getTreasuryReserveSnapshot(d.raw).totalCreditsCents).toBe(250);
    expect((d.raw.prepare("SELECT count(*) AS n FROM treasury_reserve_allocations").get() as {n:number}).n).toBe(4);
  });

  it("rejects duplicate operation identities with different terms and does not replay old changes", () => {
    const d = db();
    const input = alloc("op-1", "provider", 100);
    setTreasuryReserve(d, input);
    setTreasuryReserve(d, alloc("op-2", "provider", 200));
    const replay = setTreasuryReserve(d, input);
    expect(replay.applied).toBe(false);
    expect(replay.currentTotalCreditsCents).toBe(200);
    expect(getTreasuryReserveSnapshot(d.raw).totalCreditsCents).toBe(200);
    expect(() => setTreasuryReserve(d, { ...input, targetCreditsCents: 999 }))
      .toThrow(/operation key conflicts/);
  });

  it("rolls back overcommit, unknown observed balance and duplicate debit before evidence materializes", () => {
    const d = db();
    setTreasuryReserve(d, alloc("op-1", "res-1", 200));
    prepareFinancialEffect(d.raw, {
      operationKey: "purchase-unknown", effectKind: "credit_transfer",
      recipient: "0xchild", provider: "conway", amountCents: 650,
    });
    expect(() => setTreasuryReserve(d, alloc("op-2", "res-2", 100))).toThrow(/insufficient free liquidity/);
    expect(() => setTreasuryReserve(d, { ...alloc("op-3", "res-2", 10), observedCreditsCents: null }))
      .toThrow(/observed credit balance/);
    expect(getTreasuryReserveSnapshot(d.raw).totalCreditsCents).toBe(200);
    expect((d.raw.prepare("SELECT count(*) AS n FROM treasury_reserve_allocations").get() as {n:number}).n).toBe(1);
  });

  it("refuses increases with active local task estimates without same-unit valuation", () => {
    const d = db();
    const now = new Date().toISOString();
    d.raw.prepare("INSERT INTO goals (id,title,description,status,created_at) VALUES (?,?,?,?,?)")
      .run("g", "Goal", "Task", "active", now);
    d.raw.prepare(
      `INSERT INTO task_graph
       (id,goal_id,title,description,status,assigned_to,agent_role,priority,dependencies,estimated_cost_cents,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    ).run("t","g","task","task","running","0xchild","generalist",1,"[]",150,now);
    expect(() => setTreasuryReserve(d, alloc("op-1", "task-risk", 200)))
      .toThrow(/unknown or insufficient/);
    expect(getTreasuryReserveSnapshot(d.raw).initialized).toBe(false);
    expect(setTreasuryReserve(d, { ...alloc("op-1", "task-risk", 200),
      taskCommitmentCreditsCents: 150 }).applied).toBe(true);
  });

  it("survives physical SQLite close/reopen and replays without double allocation", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "abos-p030-reserves-"));
    dirs.push(dir);
    const file = path.join(dir, "state.db");
    const first = createDatabase(file);
    open.push(first);
    const input = alloc("op-1", "service", 250);
    setTreasuryReserve(first, input);
    first.close();
    const second = createDatabase(file);
    open.push(second);
    expect(getTreasuryReserveSnapshot(second.raw).totalCreditsCents).toBe(250);
    expect(setTreasuryReserve(second, input).applied).toBe(false);
    expect((second.raw.prepare("SELECT MAX(version) AS v FROM schema_version").get() as {v:number}).v).toBe(23);
    expect((second.raw.prepare("SELECT count(*) AS n FROM treasury_reserve_allocations").get() as {n:number}).n).toBe(1);
  });

  it("release is possible under missing balance but does not fabricate free liquidity", () => {
    const d = db();
    setTreasuryReserve(d, alloc("op-1", "emergency", 200));
    setTreasuryReserve(d, {
      ...alloc("op-2", "emergency", 0),
      observedCreditsCents: null, balanceEvidence: null, otherCommittedCreditsCents: null,
    });
    const projection = getTreasuryProjection(d);
    expect(projection.reservedCreditsCents).toBe(0);
    expect(projection.freeCreditsCents).toBeNull();
    expect(projection.reserveSource).toBe("durable");
  });
});
