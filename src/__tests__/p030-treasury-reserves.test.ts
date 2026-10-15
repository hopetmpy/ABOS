import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AbosDatabase, ToolContext } from "../types.js";
import { createTestConfig, createTestIdentity, MockConwayClient, MockInferenceClient } from "./mocks.js";
import { createBuiltinTools } from "../agent/tools.js";
import { buildPlannerContext } from "../orchestration/planner-context.js";
import { runWithEvidenceContext } from "../observability/evidence.js";
import { createDatabase } from "../state/database.js";
import { createTestDb } from "./mocks.js";
import { AdaptivePathEngine } from "../intelligence/adaptive-engine.js";
import { getEvidenceByAuthority } from "../observability/evidence.js";
import { getTreasuryProjection } from "../economics/treasury-projection.js";
import { getTreasuryReserveSnapshot, getTreasuryReserveLearning, describeTreasuryReserveLearning, setTreasuryReserve, getPendingReserveCreditOverlap, getTreasuryReserveLocalSettlement } from "../economics/treasury-reserves.js";
import { prepareFinancialEffect } from "../economics/financial-effects.js";
import { executeCreditEffect } from "../economics/credit-transfer.js";

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

describe("P-030 policy-catalog internal reserve action", () => {
  it("can persist a real internal earmark from a protected tool call without moving credit", async () => {
    const d = db();
    const conway = new MockConwayClient();
    conway.creditsCents = 1000;
    const ctx: ToolContext = {
      db: d, conway, identity: createTestIdentity(),
      config: createTestConfig(), inference: new MockInferenceClient(),
    };
    const tools = createBuiltinTools(ctx.config.sandboxId);
    const setTool = tools.find(tool => tool.name === "set_treasury_reserve");
    const viewTool = tools.find(tool => tool.name === "check_credits");
    expect(setTool?.riskLevel).toBe("caution");
    expect(setTool).toBeDefined();
    const argumentsForReserve = {
      reserve_key: "provider-outage",
      target_credits_cents: 250,
      decision_evidence: "P025 review of provider outage alternatives",
      other_commitments_cents: 100,
    };
    const once = await runWithEvidenceContext(
      { correlationId: "p030-tool-test", toolCallId: "reserve-call-1", policyDecisionId: "policy-reserve-1" },
      () => setTool!.execute(argumentsForReserve, ctx),
    );
    const replay = await runWithEvidenceContext(
      { correlationId: "p030-tool-test", toolCallId: "reserve-call-1", policyDecisionId: "policy-reserve-1" },
      () => setTool!.execute(argumentsForReserve, ctx),
    );
    expect(JSON.parse(once).applied).toBe(true);
    expect(JSON.parse(replay).applied).toBe(false);
    expect(getTreasuryReserveSnapshot(d.raw).totalCreditsCents).toBe(250);
    const view = await viewTool!.execute({}, ctx);
    expect(view).toContain("reserved credits=250 (durable)");
    expect((d.raw.prepare("SELECT COUNT(*) AS n FROM transactions").get() as {n:number}).n).toBe(0);
  });

  it("rejects an unauthenticated tool-call identity and an outage-backed increase", async () => {
    const d = db();
    const conway = new MockConwayClient();
    const ctx: ToolContext = {
      db:d, conway, identity:createTestIdentity(),
      config:createTestConfig(), inference:new MockInferenceClient(),
    };
    const tool = createBuiltinTools(ctx.config.sandboxId).find(v=>v.name==="set_treasury_reserve")!;
    const args = {
      reserve_key:"emergency", target_credits_cents:100,
      decision_evidence:"scenario evidence", other_commitments_cents:0,
    };
    expect(await tool.execute(args,ctx)).toMatch(/Blocked: reserve adjustment/);
    conway.getCreditsBalance = async () => { throw new Error("provider offline"); };
    await expect(runWithEvidenceContext(
      {correlationId:"p030-outage",toolCallId:"reserve-call-2"},
      ()=>tool.execute(args,ctx),
    )).rejects.toThrow(/observed credit balance/);
    expect(getTreasuryReserveSnapshot(d.raw).initialized).toBe(false);
  });
});

describe("P-030 persisted v22 upgrade", () => {
  it("reopens legacy v22 state and materializes the v23 reserve authority without losing settled rows", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "abos-p030-upgrade-"));
    dirs.push(dir);
    const file = path.join(dir, "legacy.db");
    const legacy = createDatabase(file);
    open.push(legacy);
    legacy.raw.prepare(
      "INSERT INTO transactions (id,type,amount_cents,description) VALUES (?,?,?,?)",
    ).run("historical-capital", "capital_allocation", 175, "pre-upgrade economic history");
    // Reconstruct the persisted v22 schema boundary: no reserve table/version23.
    legacy.raw.exec(
      "DROP TABLE treasury_reserve_allocations; DELETE FROM schema_version WHERE version=23;",
    );
    legacy.close();
    const upgraded = createDatabase(file);
    open.push(upgraded);
    const version = upgraded.raw.prepare(
      "SELECT MAX(version) AS version FROM schema_version",
    ).get() as {version:number};
    expect(version.version).toBe(23);
    expect((upgraded.raw.prepare(
      "SELECT amount_cents FROM transactions WHERE id='historical-capital'",
    ).get() as {amount_cents:number}).amount_cents).toBe(175);
    expect(getTreasuryReserveSnapshot(upgraded.raw).initialized).toBe(false);
    expect(setTreasuryReserve(upgraded, alloc("legacy-upgrade-1", "contingency", 75)).applied).toBe(true);
    expect(getTreasuryProjection(upgraded, {
      observedCreditsCents: 1000, otherCommittedCreditsCents: 100,
    }).freeCreditsCents).toBe(825);
  });
});

describe("P-030 actual P-025 → P-023 prediction/outcome reuse", () => {
  function reviewedPathFixture(d: AbosDatabase) {
    const now = new Date().toISOString();
    d.raw.prepare(
      "INSERT INTO goals (id,title,description,status,created_at) VALUES (?,?,?,?,?)",
    ).run("goal-reserve", "Economic objective", "Contingency", "active", now);
    const candidate = {
      goalId: "goal-reserve", taskId: "task-reserve",
      hypothesis: "Contingency earmark protects this path",
      strategy: "Evaluate provider alternatives then execute",
      assumptions: ["Provider replacement is available"],
      requiredCapabilities: [],
      expectedOutcome: "Observed delivery with acceptable contingency",
      sequence: ["Earmark", "Execute", "Observe"],
      evidence: ["P025 independent planning factors"],
    };
    const engine = new AdaptivePathEngine(d.raw);
    const selected = engine.selectCandidate(candidate, { availability: "observed" });
    engine.store.bindTask({
      taskId: "task-reserve", goalId: "goal-reserve", pathId: selected.path.id,
    });
    d.raw.prepare(
      "INSERT OR REPLACE INTO kv (key,value,updated_at) VALUES (?,?,datetime('now'))",
    ).run("orchestrator.review_feedback.goal-reserve",
      `P025 reviewed alternatives and conditions ; materialized_path=${selected.path.id}`);
    return { candidate, engine, path: selected.path };
  }

  it("links only materialized review decisions and later P-023 path resolution, not revenue", () => {
    const d = db();
    const { candidate, engine, path } = reviewedPathFixture(d);
    runWithEvidenceContext(
      { correlationId:"goal:goal-reserve", goalId:"goal-reserve", taskId:"task-reserve" },
      () => setTreasuryReserve(d, alloc("review-1","provider-replacement",400)),
    );
    const events = getEvidenceByAuthority(d.raw, "treasury_reserve", "provider-replacement");
    const reserved = events.find(x=>x.eventType==="treasury.reserve_increased")!;
    expect((reserved.payload as any).reviewedStrategicPathId).toBe(path.id);
    expect((reserved.provenance as any).reviewProvenance).toBe("materialized_p025_reviewed_path");
    const before = getTreasuryReserveLearning(d.raw);
    expect(before.reviewedPathLinked).toBe(1);
    expect(before.awaitingOutcome).toBe(1);
    expect(before.observedReserveUseCreditsCents).toBeNull();
    engine.recordSuccess({
      candidate, pathId:path.id, markPathSucceeded:true,
      evidence:["terminal outcome observed by P023"], conditions:{availability:"observed"},
    });
    const after = getTreasuryReserveLearning(d.raw);
    expect(after.confirmedStrategicOutcomes).toBe(1);
    expect(after.awaitingOutcome).toBe(0);
    expect(after.observedReserveUseCreditsCents).toBeNull();
    expect((d.raw.prepare("SELECT count(*) AS n FROM transactions").get() as {n:number}).n).toBe(0);
  });

  it("does not invent a P-025 review from a caller assertion or backdate strategic outcomes", () => {
    const d = db();
    const { candidate, engine, path } = reviewedPathFixture(d);
    // Removing the canonical review marker preserves UNKNOWN despite a selected path.
    d.raw.prepare("DELETE FROM kv WHERE key = ?")
      .run("orchestrator.review_feedback.goal-reserve");
    runWithEvidenceContext(
      {correlationId:"goal:goal-reserve",goalId:"goal-reserve",taskId:"task-reserve"},
      ()=>setTreasuryReserve(d, alloc("unreviewed-1","unreviewed",50)),
    );
    const unreviewed = getTreasuryReserveLearning(d.raw);
    expect(unreviewed.reviewProvenanceUnknown).toBe(1);
    expect(unreviewed.confirmedStrategicOutcomes).toBe(0);
    engine.recordSuccess({
      candidate, pathId:path.id, markPathSucceeded:true,
      evidence:["prior outcome"], conditions:{availability:"observed"},
    });
    d.raw.prepare(
      "INSERT OR REPLACE INTO kv (key,value,updated_at) VALUES (?,?,datetime('now'))",
    ).run("orchestrator.review_feedback.goal-reserve",
      `Reviewed result ; materialized_path=${path.id}`);
    runWithEvidenceContext(
      {correlationId:"goal:goal-reserve",goalId:"goal-reserve",taskId:"task-reserve"},
      ()=>setTreasuryReserve(d, alloc("reviewed-after-success","reserve-after",100)),
    );
    expect(getTreasuryReserveLearning(d.raw).confirmedStrategicOutcomes).toBe(0);
    expect(getTreasuryReserveLearning(d.raw).awaitingOutcome).toBe(1);
  });
});

describe("P-030 adaptive-context economic history persistence", () => {
  it("keeps P-023 learning after a reserve is released, with no invented credit spend", async () => {
    const d=db();
    const now = new Date().toISOString();
    d.raw.prepare("INSERT INTO goals (id,title,description,status,created_at) VALUES (?,?,?,?,?)")
      .run("g-learn","Reserve calibration","Causal result","active",now);
    const candidate = {
      goalId:"g-learn",taskId:"t-learn",hypothesis:"A reserved contingency supports execution",
      strategy:"Selected strategy", assumptions:["Provider is available"],
      requiredCapabilities:[],sequence:["Reserve","Measure"],expectedOutcome:"Delivery observed",
    };
    const engine = new AdaptivePathEngine(d.raw);
    const path = engine.selectCandidate(candidate,{provider:"available"}).path;
    engine.store.bindTask({taskId:"t-learn",goalId:"g-learn",pathId:path.id});
    d.raw.prepare("INSERT OR REPLACE INTO kv (key,value,updated_at) VALUES (?,?,datetime('now'))")
      .run("orchestrator.review_feedback.g-learn",
        `P025 approve ; materialized_path=${path.id}`);
    runWithEvidenceContext({correlationId:"goal:g-learn",goalId:"g-learn",taskId:"t-learn"},
      ()=>setTreasuryReserve(d,alloc("learning-start","contingency",150)));
    engine.recordSuccess({candidate,pathId:path.id,markPathSucceeded:true,
      evidence:["observed delivery"],conditions:{provider:"available"}});
    setTreasuryReserve(d,{...alloc("learning-release","contingency",0),
      observedCreditsCents:null,balanceEvidence:null,otherCommittedCreditsCents:null});
    const learning=getTreasuryReserveLearning(d.raw);
    expect(learning.confirmedStrategicOutcomes).toBe(1);
    expect(learning.reviewProvenanceUnknown).toBe(1);
    expect(learning.observedReserveUseCreditsCents).toBeNull();
    const planner=await buildPlannerContext({db:d.raw});
    expect(planner.adaptiveContext).toContain("confirmed strategic paths=1");
    expect(planner.adaptiveContext).toContain("not measured reserve usage");
    expect(getTreasuryReserveSnapshot(d.raw).totalCreditsCents).toBe(0);
  });
});

describe("P-030 P-025/P-023 cross-authority physical recovery", () => {
  it("reopens actual SQLite and retains reviewed reserve decision plus later P-023 learning exactly once", async () => {
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),"abos-p030-p023-recovery-"));
    dirs.push(dir);
    const filename=path.join(dir,"state.db");
    const first=createDatabase(filename);
    open.push(first);
    const timestamp=new Date().toISOString();
    first.raw.prepare("INSERT INTO goals (id,title,description,status,created_at) VALUES (?,?,?,?,?)")
      .run("g-recovery","Strategy","Economic learning","active",timestamp);
    const candidate={
      goalId:"g-recovery",taskId:"t-recovery",
      hypothesis:"Reserved downside is adequate",
      strategy:"Execute validated strategy",assumptions:["Provider available"],
      requiredCapabilities:[],sequence:["Reserve","Observe"],expectedOutcome:"Delivery confirmed",
    };
    const engine=new AdaptivePathEngine(first.raw);
    const selected=engine.selectCandidate(candidate,{provider:"observed"}).path;
    engine.store.bindTask({goalId:"g-recovery",taskId:"t-recovery",pathId:selected.id});
    first.raw.prepare("INSERT OR REPLACE INTO kv (key,value,updated_at) VALUES (?,?,datetime('now'))")
      .run("orchestrator.review_feedback.g-recovery",
        `Strategic plan approved ; materialized_path=${selected.id}`);
    runWithEvidenceContext(
      {correlationId:"goal:g-recovery",goalId:"g-recovery",taskId:"t-recovery"},
      ()=>setTreasuryReserve(first,alloc("recovery-op","risk-recovery",175)),
    );
    engine.recordSuccess({
      candidate,pathId:selected.id,markPathSucceeded:true,
      evidence:["terminally observed output"],conditions:{provider:"observed"},
    });
    const before=getTreasuryReserveLearning(first.raw);
    expect(before.reviewedPathLinked).toBe(1);
    expect(before.confirmedStrategicOutcomes).toBe(1);
    first.close();

    const second=createDatabase(filename);
    open.push(second);
    const after=getTreasuryReserveLearning(second.raw);
    expect(after).toEqual(before);
    expect(setTreasuryReserve(second,alloc("recovery-op","risk-recovery",175)).applied).toBe(false);
    expect(getTreasuryReserveLearning(second.raw)).toEqual(before);
    expect((await buildPlannerContext({db:second.raw})).adaptiveContext)
      .toContain("confirmed strategic paths=1");
    expect(getTreasuryReserveSnapshot(second.raw).totalCreditsCents).toBe(175);
    expect((second.raw.prepare("SELECT count(*) AS n FROM transactions").get() as {n:number}).n).toBe(0);
  });
});

describe("P-030 causal reserve-funded Conway credit effects", () => {
  it("binds reserve to a real locally reconciled credit effect and never treats it as LIVE P&L", async () => {
    const d=db(), conway=new MockConwayClient();
    conway.creditsCents=1000;
    setTreasuryReserve(d,alloc("cap-1","provider-replacement",300));
    const effect=await executeCreditEffect({
      db:d,conway,operationKey:"reserve-provider-1",kind:"credit_transfer",
      toAddress:"0xrecipient",amountCents:200,note:"replacement capacity",
      reserveKey:"provider-replacement",
    });
    expect(effect.state).toBe("completed");
    expect(effect.request.treasuryReserveKey).toBe("provider-replacement");
    const local=getTreasuryReserveLocalSettlement(d.raw);
    expect(local).toEqual({locallyReconciledCreditsCents:200,
      matchingEffects:1,unverifiableEffects:0});
    expect(getTreasuryReserveLearning(d.raw).observedReserveUseCreditsCents).toBeNull();
    expect(getTreasuryReserveLearning(d.raw).locallyReconciledReserveTransfersCreditsCents).toBe(200);
    expect(getTreasuryProjection(d,{
      observedCreditsCents:800,otherCommittedCreditsCents:0,
    }).freeCreditsCents).toBe(500);
    expect((d.raw.prepare("SELECT COUNT(*) AS n FROM transactions").get() as {n:number}).n).toBe(1);

    // Existing reserve has 100 cents remaining after the linked completed effect.
    await expect(executeCreditEffect({
      db:d,conway,operationKey:"reserve-provider-2",kind:"credit_transfer",
      toAddress:"0xanother",amountCents:150,note:"overspend",
      reserveKey:"provider-replacement",
    })).rejects.toThrow(/exceeds active earmark/);
    expect((d.raw.prepare("SELECT COUNT(*) AS n FROM financial_effects").get() as {n:number}).n).toBe(1);
    expect((d.raw.prepare("SELECT COUNT(*) AS n FROM transactions").get() as {n:number}).n).toBe(1);
    const replay=await executeCreditEffect({
      db:d,conway,operationKey:"reserve-provider-1",kind:"credit_transfer",
      toAddress:"0xrecipient",amountCents:200,note:"replacement capacity",
      reserveKey:"provider-replacement",
    });
    expect(replay.id).toBe(effect.id);
    expect((d.raw.prepare("SELECT COUNT(*) AS n FROM transactions").get() as {n:number}).n).toBe(1);
    // Replay remains safe even after releasing/reassigning the reserve.
    // No new capacity is required because no new provider effect is created.
    setTreasuryReserve(d,{
      ...alloc("release-cap", "provider-replacement", 0),
      observedCreditsCents:null, balanceEvidence:null,
      otherCommittedCreditsCents:null,
    });
    const afterRelease = await executeCreditEffect({
      db:d,conway,operationKey:"reserve-provider-1",kind:"credit_transfer",
      toAddress:"0xrecipient",amountCents:200,note:"replacement capacity",
      reserveKey:"provider-replacement",
    });
    expect(afterRelease.id).toBe(effect.id);
    expect((d.raw.prepare("SELECT COUNT(*) AS n FROM transactions").get() as {n:number}).n).toBe(1);
    await expect(executeCreditEffect({
      db:d,conway,operationKey:"reserve-new-after-release",kind:"credit_transfer",
      toAddress:"0xnew",amountCents:20,note:"new request",
      reserveKey:"provider-replacement",
    })).rejects.toThrow(/not an active durable earmark/);
  });

  it("counts unsettled reserved credits only once while preserving unrelated credit/USDC units", () => {
    const d=db();
    setTreasuryReserve(d,alloc("pending-cap","reserve-pending",300));
    prepareFinancialEffect(d.raw,{
      operationKey:"bound-pending",effectKind:"credit_transfer",
      recipient:"0xrecipient",provider:"conway",amountCents:200,
      request:{note:"pending",treasuryReserveKey:"reserve-pending"},
    });
    prepareFinancialEffect(d.raw,{
      operationKey:"unrelated-pending",effectKind:"credit_transfer",
      recipient:"0xunrelated",provider:"conway",amountCents:100,
      request:{note:"unrelated"},
    });
    prepareFinancialEffect(d.raw,{
      operationKey:"usdc-topup",effectKind:"x402_credit_topup",
      recipient:"0xwallet",provider:"conway",amountCents:400,unit:"usdc_cent",
      request:{treasuryReserveKey:"reserve-pending"},
    });
    expect(getPendingReserveCreditOverlap(d.raw)).toBe(200);
    const report=getTreasuryProjection(d,{
      observedCreditsCents:1000,otherCommittedCreditsCents:0,
    });
    expect(report.pendingTransferCreditsCents).toBe(300);
    expect(report.pendingTransferWithinReservesCreditsCents).toBe(200);
    expect(report.reservedCreditsCents).toBe(300);
    expect(report.freeCreditsCents).toBe(600);
    expect(report.projectedCreditShortfallCents).toBe(0);
    expect(getTreasuryReserveLocalSettlement(d.raw).locallyReconciledCreditsCents).toBeNull();
  });

  it("refuses unknown, empty or inactive reserve identity before provider dispatch", async () => {
    const d=db(), conway=new MockConwayClient();
    await expect(executeCreditEffect({
      db:d,conway,operationKey:"no-cap-1",kind:"credit_transfer",
      toAddress:"0xrecipient",amountCents:20,note:"try",reserveKey:"absent",
    })).rejects.toThrow(/not an active durable earmark/);
    await expect(executeCreditEffect({
      db:d,conway,operationKey:"no-cap-2",kind:"credit_transfer",
      toAddress:"0xrecipient",amountCents:20,note:"try",reserveKey:" ",
    })).rejects.toThrow(/cannot be blank/);
    expect((d.raw.prepare("SELECT count(*) AS n FROM financial_effects").get() as {n:number}).n).toBe(0);
    expect((d.raw.prepare("SELECT count(*) AS n FROM transactions").get() as {n:number}).n).toBe(0);
  });
});
