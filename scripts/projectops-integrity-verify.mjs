import {createHash} from "node:crypto";
import {existsSync,readFileSync,statSync} from "node:fs";
import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const at=path=>resolve(root,path);
const read=path=>readFileSync(at(path),"utf8");
const fail=message=>{throw new Error(`PROJECTOPS_INTEGRITY_VERIFY: ${message}`)};
const needFile=path=>{if(!existsSync(at(path)))fail(`required file missing: ${path}`)};
const need=(source,needle,label)=>{if(!source.includes(needle))fail(label??`missing contract: ${needle}`)};
const forbid=(source,needle,label)=>{if(source.includes(needle))fail(label??`forbidden contract present: ${needle}`)};
const field=(source,name)=>{
  const matches=[...source.matchAll(new RegExp(`^${name}:\\s*(.+)$`,"gm"))];
  if(matches.length!==1)fail(`manifest field must occur exactly once: ${name}`);
  return matches[0][1].trim();
};
const blob=source=>{
  const bytes=Buffer.from(source.replaceAll("\r\n","\n"),"utf8");
  return createHash("sha1").update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest("hex");
};
const needBlob=(path,expected)=>{
  const actual=blob(read(path));
  if(actual!==expected)fail(`${path} lost preserved blob identity: expected ${expected}, got ${actual}`);
};
const stateOf=content=>{
  const m=content.match(/^State:\s*(.+)$/m);
  if(!m)fail("plan module missing State");
  return m[1].trim();
};
const validPlanStates=new Set(["ABIERTO","EN_EJECUCIÓN","PARCIAL","BLOQUEADO","HECHO","DESCARTADO","PLANIFICADO"]);

const p={
  agents:"AGENTS.md",
  protocol:"ProjectOps/system/ABOS_OPERATING_PROTOCOL.md",
  reasoning:"ProjectOps/system/ABOS_ADAPTIVE_REASONING_LAYER.md",
  acceptance:"ProjectOps/system/ABOS_ADAPTIVE_REASONING_ACCEPTANCE.md",
  mode:"ProjectOps/system/PUBLIC_TRACKED_MATRIX.md",
  project:"ProjectOps/PROJECT.md",
  continuity:"ProjectOps/CONTINUITY.md",
  plan:"ProjectOps/PLAN.md",
  legacyContinuity:"ProjectOps/continuity/C0000-legacy.md",
  legacyPlan:"ProjectOps/plan/LEGACY_FULL_PLAN.md",
  constitution:"constitution.md",
};
for(const path of Object.values(p))needFile(path);
if(existsSync(at("CONTINUITY.md"))||existsSync(at("PLAN.md")))fail("competing root ProjectOps authority exists");

// Historical snapshots remain immutable. Live governance remains correctable.
needBlob(p.legacyContinuity,"6ee88dc560dc53ddb6e728fca9193fa62f6ee3a7");
needBlob(p.legacyPlan,"8c52273bf1801958273a77474315c85e0903ee1d");

// Retired governance experiments must not silently return.
for(const retired of [
  "ProjectOps/system/ABOS_STATIC_CLOSURE_LAYER.md",
  "scripts/projectops-scheduler-contract.mjs",
  "scripts/projectops-integrity-verify.test.mjs",
])if(existsSync(at(retired)))fail(`retired governance artifact still exists: ${retired}`);

// AGENTS owns cadence. Verify the proven macro chaining + visible recovery contract.
const agents=read(p.agents);
for(const marker of [
  "<!-- PROJECTOPS:ABOS-ROOT-ENTRYPOINT -->",
  "única autoridad raíz sobre la cadencia de trabajo del agente en ABOS",
  "ProjectOps/CONTINUITY.md",
  "ProjectOps/PLAN.md",
  "ProjectOps/PROJECT.md",
  "CHECKPOINT LIGERO → CONTINUAR",
  "Required-Context",
  "DECISION_READY",
  "NO_CHANGE",
  "SOURCE_FIRST_DEFERRED_MATERIAL_VALIDATION",
  "NO_PREMATURE_RETURN_AFTER_SUBUNIT",
  "LOCAL_BLOCK_IS_NOT_TOTAL_BLOCK",
  "NO_TIME_QUOTA_AS_BOUNDARY",
  "NO_GLOBAL_PROCESS_KILL_BY_TIMEOUT",
  "RECOVERY_IS_NOT_CLOSURE",
  "FUNCTIONAL_BASELINE → PLAN DELTA → EXTEND/CORRECT → VERIFY PRESERVATION → MACRO RECONCILE",
  "UNIT_DONE_IS_TRANSITION_NOT_HANDOFF",
  "NEXT_ELIGIBLE_WORK",
  "LOCAL_FAILURE_REQUIRES_REROUTE",
  "STOP_GATE_REQUIRES_TERMINAL_CONDITION",
  "REQUESTED_SCOPE_COMPLETE",
  "TOTAL_REAL_BLOCK",
  "La auditoría estática forma parte de `AUDITAR/REAUDITAR/VERIFICAR`; **no es una capa, estado ni frontera separada**.",
  "no hagas reconciliación completa ni reporte de cierre después de cada subunidad",
  "Antes de devolver cualquier salida de corte, deja un **checkpoint de recuperación útil**",
  "Para solicitudes de ejecución, una respuesta final debe pasar `STOP_GATE_REQUIRES_TERMINAL_CONDITION`",
  "Un bloque sólo puede entregarse como terminado cuando la frontera solicitada realmente terminó",
])need(agents,marker,`AGENTS lost single-kernel/chaining contract: ${marker}`);
for(const forbidden of [
  "Authority: ONLY_EXECUTION_SCHEDULER",
  "Authority: MANDATORY_ADDITIVE_REASONING_LAYER",
  "Authority: MANDATORY_ADDITIVE_VERIFICATION_CLOSURE_LAYER",
  "STATIC_CLOSED`/`GLOBAL_STATIC_CLOSED`",
  "ACTIVE_MACRO_NEXT",
  "FINAL_RESPONSE_IS_SCHEDULER_TRANSITION",
])forbid(agents,forbidden,`AGENTS reintroduced parallel scheduling semantics: ${forbidden}`);
const chainingIndex=agents.indexOf("### Resolución obligatoria del siguiente trabajo");
const reconcileIndex=agents.indexOf("La reconciliación completa ocurre");
const closeIndex=agents.indexOf("## REANUDACIÓN Y CIERRE");
if(chainingIndex<0||reconcileIndex<0||closeIndex<0)fail("AGENTS chaining/reconciliation/closure sections not found");
if(!(chainingIndex<reconcileIndex&&reconcileIndex<closeIndex))fail("NEXT_ELIGIBLE_WORK must resolve before macro reconciliation/closure");
if(statSync(at(p.agents)).size>20*1024)fail("AGENTS exceeded 20 KiB operating-kernel budget");

// Operating Protocol is reference-only technical constitution, never cadence.
const protocol=read(p.protocol);
for(const marker of [
  "Authority: REFERENCE_ONLY_NON_SCHEDULER",
  "Invoked-By: `AGENTS.md`",
  "Does-Not-Schedule: true",
  "ProjectOps-Model: SINGLE_OPERATING_SYSTEM",
])need(protocol,marker,`engineering constitution lost non-scheduler contract: ${marker}`);
for(const forbidden of [
  "# AGENTS.md — PROTOCOLO OPERATIVO CANÓNICO DEL AGENTE",
  "## PROTOCOLO DE ACTIVACIÓN OBLIGATORIO",
  "## CICLO OBLIGATORIO POR UNIDAD SIGNIFICATIVA",
  "## CICLO TÉCNICO POR SUBUNIDAD Y RECONCILIACIÓN POR BLOQUE MACRO",
  "37. ALGORITMO OPERATIVO OBLIGATORIO",
  "27. CIERRE OBLIGATORIO",
  "# ORDEN FINAL DE TRABAJO",
  "Authority: ONLY_EXECUTION_SCHEDULER",
  "Authority: MANDATORY_ADDITIVE_REASONING_LAYER",
])forbid(protocol,forbidden,`engineering constitution reintroduced scheduler semantics: ${forbidden}`);

// Adaptive Reasoning is a reference only, never a second operating layer.
const reasoning=read(p.reasoning);
for(const marker of [
  "<!-- PROJECTOPS:ADAPTIVE-REASONING-REFERENCE:BEGIN -->",
  "<!-- PROJECTOPS:ADAPTIVE-REASONING-REFERENCE:END -->",
  "Authority: REFERENCE_ONLY_NON_SCHEDULER",
  "Invoked-By: `AGENTS.md`",
  "Does-Not-Schedule: true",
  "ProjectOps-Model: SINGLE_OPERATING_SYSTEM",
  "NO_CHANGE_IS_VALID",
  "REQUIRED_CONTEXT_IS_FLOOR",
  "COMPETING_HYPOTHESES_WHEN_MATERIAL",
  "ADVERSARIAL_REVIEW_REQUIRED",
  "DECISION_READY_GATE",
])need(reasoning,marker,`adaptive reasoning reference missing invariant: ${marker}`);
for(const forbidden of [
  "Authority: MANDATORY_ADDITIVE_REASONING_LAYER",
  "<!-- PROJECTOPS:ADAPTIVE-REASONING-LAYER:BEGIN -->",
  "<!-- PROJECTOPS:ADAPTIVE-REASONING-LAYER:END -->",
  "Esta capa **se suma**",
  "Authority: ONLY_EXECUTION_SCHEDULER",
  "## 5. CICLO ADAPTATIVO OBLIGATORIO",
  "## 11. CRITERIO EXPLÍCITO DE PARADA",
])forbid(reasoning,forbidden,`adaptive reasoning reintroduced parallel operating authority: ${forbidden}`);
if(statSync(at(p.reasoning)).size>48*1024)fail("reasoning reference exceeded context budget");

// Acceptance is evidence. Crucially, verifier must not freeze it in NOT_YET_EXECUTED.
const acceptance=read(p.acceptance);
need(acceptance,"Authority: EVIDENCE_REPORT","adaptive acceptance must remain evidence-only");
for(const forbidden of [
  "Authority: ACCEPTANCE_CONTRACT",
  "Authority: ONLY_EXECUTION_SCHEDULER",
  "Authority: MANDATORY_ADDITIVE_REASONING_LAYER",
])forbid(acceptance,forbidden,`acceptance acquired operating authority: ${forbidden}`);
if(!/^Behavioral-State:\s*\S+/m.test(acceptance))fail("acceptance must declare Behavioral-State");

const mode=read(p.mode);
need(mode,"Mode: PUBLIC_TRACKED_DOCUMENTARY_MATRIX","public ProjectOps host mode missing");
need(mode,"Repository-Visibility-Observed-At-Cutover: PUBLIC","public-host observation missing");

const project=read(p.project);
for(const marker of [
  "Authority: CANONICAL_PROJECT_BASELINE",
  "Autonomous Business Operating System",
  "constitution.md",
  "Adaptive Path Intelligence",
  "objective != method",
  "Execution boundary",
  "Economía causal",
  "Children / replication",
  "parent authority != child wallet authority",
  "E0 — TARGET / NARRATIVE",
  "E5 — EXTERNAL AUTHENTICATED LIVE",
  "E6 — ECONOMIC LIVE",
  "E7 — SUSTAINED OPERATION",
  "Anti-contaminación entre proyectos",
])need(project,marker,`PROJECT baseline missing ABOS identity/invariant: ${marker}`);
for(const forbidden of ["Authority: ONLY_EXECUTION_SCHEDULER","Authority: MANDATORY_ADDITIVE_REASONING_LAYER"])
  forbid(project,forbidden,`PROJECT competes with AGENTS as scheduler: ${forbidden}`);

needFile("src/state/schema.ts");
const schemaSource=read("src/state/schema.ts");
const schemaMatch=schemaSource.match(/export const SCHEMA_VERSION\s*=\s*(\d+)\s*;/);
if(!schemaMatch)fail("unable to determine SCHEMA_VERSION from src/state/schema.ts");
const observedSchema=field(project,"Schema-Version-Observed-In-Source").replaceAll("`","");
if(observedSchema!==schemaMatch[1])fail(`PROJECT schema baseline drift: source=${schemaMatch[1]} project=${observedSchema}`);

const continuity=read(p.continuity);
const activePlan=field(continuity,"Active-Plan");
const activeSegment=field(continuity,"Active-Segment");
const activeBranch=field(continuity,"Current-Host-Branch");
if(!/^P-\d{3}$/.test(activePlan))fail(`invalid Active-Plan: ${activePlan}`);
if(!/^continuity\/C\d{4}\.md$/.test(activeSegment))fail(`invalid Active-Segment: ${activeSegment}`);
if(!activeBranch)fail("Current-Host-Branch must not be empty");
if(field(continuity,"Reasoning-Layer")!=="system/ABOS_ADAPTIVE_REASONING_LAYER.md")fail("Reasoning-Layer authority mismatch");
if(field(continuity,"Reasoning-Acceptance")!=="system/ABOS_ADAPTIVE_REASONING_ACCEPTANCE.md")fail("Reasoning-Acceptance authority mismatch");
if(field(continuity,"ProjectOps-Integrity-Verifier")!=="scripts/projectops-integrity-verify.mjs")fail("integrity verifier authority mismatch");
if(!/^[0-9a-f]{40}$/.test(field(continuity,"Last-Reconciled-Host-Head")))fail("Last-Reconciled-Host-Head must be exact Git SHA");

const activeSegmentPath=`ProjectOps/${activeSegment}`;
needFile(activeSegmentPath);
const segment=read(activeSegmentPath);
need(segment,"State: ACTIVE","active continuity segment not ACTIVE");
need(segment,"AGENTS.md","active segment must identify AGENTS.md when kernel behavior is under intervention");
const segmentBranch=segment.match(/^Host-Branch:\s*`?([^`\n]+)`?$/m)?.[1]?.trim();
if(segmentBranch&&segmentBranch!==activeBranch)fail(`active segment branch mismatch: ${segmentBranch} != ${activeBranch}`);
if(statSync(at(activeSegmentPath)).size>100*1024)fail("active continuity segment exceeded rotation threshold");

const plan=read(p.plan);
for(const forbidden of ["Authority: ONLY_EXECUTION_SCHEDULER","Authority: MANDATORY_ADDITIVE_REASONING_LAYER"])
  forbid(plan,forbidden,`PLAN competes with AGENTS as scheduler: ${forbidden}`);
const rows=new Map();
for(const m of plan.matchAll(/^\|\s*(P-\d{3})\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|\s*(plan\/[^|\s]+\.md)\s*\|$/gm)){
  const [,id,title,state,deps,modulePath]=m;
  if(rows.has(id))fail(`duplicate PLAN id: ${id}`);
  const normalizedState=state.trim();
  if(!validPlanStates.has(normalizedState))fail(`${id} has invalid state: ${normalizedState}`);
  const full=`ProjectOps/${modulePath}`;
  needFile(full);
  if(stateOf(read(full))!==normalizedState)fail(`${id} manifest/module state mismatch`);
  rows.set(id,{title:title.trim(),state:normalizedState,deps:deps.trim(),modulePath});
}
if(!rows.has(activePlan))fail(`active plan ${activePlan} missing from PLAN`);
const activeState=rows.get(activePlan).state;
if(!new Set(["ABIERTO","EN_EJECUCIÓN","PARCIAL","BLOQUEADO","PLANIFICADO"]).has(activeState))fail(`active plan ${activePlan} has non-active state: ${activeState}`);

const activePlanPath=`ProjectOps/${rows.get(activePlan).modulePath}`;
const active=read(activePlanPath).split(/\r?\n/);
const rci=active.findIndex(line=>line.trim()==="Required-Context:");
if(rci<0)fail(`${activePlanPath} lacks Required-Context`);
let count=0;
for(let i=rci+1;i<active.length;i++){
  if(!active[i].trim()&&count>0)break;
  const m=active[i].match(/^\s*-\s+`([^`]+)`/);
  if(!m)continue;
  needFile(m[1]);
  count++;
}
if(!count)fail(`${activePlanPath} Required-Context has no local paths`);

console.log("PROJECTOPS_INTEGRITY_VERIFY: PASS");
console.log("PROJECTOPS_INTEGRITY_VERIFY: AGENTS owns cadence + visible recovery/final-output contract; ProjectOps remains subordinate evidence/state/plan");
