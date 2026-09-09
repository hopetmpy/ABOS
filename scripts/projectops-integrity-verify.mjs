import {createHash} from "node:crypto";
import {existsSync,readFileSync,statSync} from "node:fs";
import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const at=path=>resolve(root,path);
const read=path=>readFileSync(at(path),"utf8");
const fail=message=>{throw new Error(`PROJECTOPS_INTEGRITY_VERIFY: ${message}`)};
const requirePath=path=>{if(!existsSync(at(path)))fail(`required path missing: ${path}`)};
const requireText=(content,needle,label)=>{if(!content.includes(needle))fail(label)};
const forbidFile=path=>{if(existsSync(at(path)))fail(`forbidden competing root authority exists: ${path}`)};
const lineCount=content=>content.length?content.split(/\r?\n/).length:0;
const gitBlobSha=content=>{
  const bytes=Buffer.from(content,"utf8");
  return createHash("sha1").update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest("hex");
};
const requireBlob=(path,expected)=>{
  const actual=gitBlobSha(read(path));
  if(actual!==expected)fail(`${path} lost preserved blob identity: expected ${expected}, got ${actual}`);
};
const field=(content,name)=>{
  const match=content.match(new RegExp(`^${name}:\\s*(.+)$`,"m"));
  if(!match)fail(`manifest field missing: ${name}`);
  return match[1].trim();
};
const moduleState=content=>{
  const match=content.match(/^State:\s*(.+)$/m);
  if(!match)fail("plan module missing State field");
  return match[1].trim();
};

const paths={
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

for(const path of Object.values(paths))requirePath(path);
forbidFile("CONTINUITY.md");
forbidFile("PLAN.md");

// Preserved migration authorities must never drift.
requireBlob(paths.protocol,"ba0d546c704d7078fb1471107c29c7174379d134");
requireBlob(paths.legacyContinuity,"6ee88dc560dc53ddb6e728fca9193fa62f6ee3a7");
requireBlob(paths.legacyPlan,"8c52273bf1801958273a77474315c85e0903ee1d");

const agents=read(paths.agents);
requireText(agents,"<!-- PROJECTOPS:ABOS-ROOT-ENTRYPOINT -->","root AGENTS ProjectOps marker missing");
const protocolIndex=agents.indexOf("ProjectOps/system/ABOS_OPERATING_PROTOCOL.md");
const reasoningIndex=agents.indexOf("ProjectOps/system/ABOS_ADAPTIVE_REASONING_LAYER.md");
const continuityIndex=agents.indexOf("ProjectOps/CONTINUITY.md");
if(protocolIndex<0||reasoningIndex<0||continuityIndex<0||!(protocolIndex<reasoningIndex&&reasoningIndex<continuityIndex))
  fail("root activation order must be protocol -> adaptive reasoning -> continuity");
for(const needle of [
  "ProjectOps/PROJECT.md",
  "Required-Context",
  "mínimo obligatorio, no un límite",
  "DECISION_READY",
  "NO_CHANGE",
  "FALSAR/DISCRIMINAR",
  "ATACAR",
  "Autonomous Business Operating System",
  "constitution.md",
  "funding no es balance",
  "PUBLIC_TRACKED_MATRIX.md",
  "~/.abos",
])requireText(agents,needle,`root AGENTS ABOS integration missing: ${needle}`);
requireText(agents,"no se hardcodea en este router","root AGENTS lost dynamic plan-state rule");
if(statSync(at(paths.agents)).size>12*1024)fail("root AGENTS exceeded 12 KiB compact-router budget");

const reasoning=read(paths.reasoning);
for(const needle of [
  "<!-- PROJECTOPS:ADAPTIVE-REASONING-LAYER:BEGIN -->",
  "<!-- PROJECTOPS:ADAPTIVE-REASONING-LAYER:END -->",
  "Authority: MANDATORY_ADDITIVE_REASONING_LAYER",
  "NO_CHANGE_IS_VALID",
  "REQUIRED_CONTEXT_IS_FLOOR",
  "COMPETING_HYPOTHESES_WHEN_MATERIAL",
  "ADVERSARIAL_REVIEW_REQUIRED",
  "DECISION_READY_GATE",
  "SOURCE_IS_NOT_LIVE_EVIDENCE",
  "UNKNOWN_IS_NOT_ZERO_OR_IMPOSSIBLE",
  "OBJECTIVE_IS_NOT_METHOD",
  "ECONOMIC_CLAIMS_REQUIRE_CAUSAL_AUTHORITY",
  "BOUNDARY_SWITCH_REQUIRES_REPLAN",
  "funding != balance",
  "Parent/child y replication",
  "Executor/environment boundaries",
  "Long-running state, concurrency y recovery",
  "Inference y model routing",
  "Constitution, policy y autonomía",
  "Self-modification y capability acquisition",
  "Evidencia externa",
])requireText(reasoning,needle,`adaptive reasoning ABOS invariant missing: ${needle}`);
if(statSync(at(paths.reasoning)).size>48*1024)fail("adaptive reasoning layer exceeded 48 KiB mandatory-context budget; modularize before growing further");
if(lineCount(reasoning)>800)fail("adaptive reasoning layer exceeded 800-line mandatory-context budget; modularize before growing further");

const acceptance=read(paths.acceptance);
requireText(acceptance,"Authority: ACCEPTANCE_CONTRACT","ABOS acceptance contract authority missing");
requireText(acceptance,"Suite: A–N","ABOS acceptance suite must be A–N");
requireText(acceptance,"BEHAVIORAL_SUITE_NOT_YET_EXECUTED","ABOS acceptance must not fabricate behavioral PASS");
for(const scenario of [
  "A — Falso bug por documentación desactualizada",
  "B — Dependencia fuera de Required-Context",
  "C — Failure estratégico disfrazado de retry",
  "D — Implementación parecida bajo otro nombre",
  "E — Executor remoto falla y local podría funcionar",
  "F — Child balance no observable",
  "G — Funding, P&L y ROI",
  "H — Inference daily cap",
  "I — Parent intenta recall del child",
  "J — Provider/model desconocido",
  "K — Heartbeat timeout con operación aún viva",
  "L — Self-modification / replication frente a constitution",
  "M — Source/CI versus LIVE",
  "N — PR abierto frente a main",
])requireText(acceptance,scenario,`ABOS acceptance scenario missing: ${scenario}`);

const mode=read(paths.mode);
requireText(mode,"Mode: PUBLIC_TRACKED_DOCUMENTARY_MATRIX","ABOS public ProjectOps host mode missing");
requireText(mode,"Repository-Visibility-Observed-At-Cutover: PUBLIC","ABOS public-host observation missing");
requireText(mode,"No equivale a una instalación privada del CLI ProjectOps","ABOS public host must distinguish documentary matrix from CLI install");

const project=read(paths.project);
for(const needle of [
  "Identity-Model: TARGET_VISION_PLUS_EVIDENCE_BASELINE",
  "Autonomous Business Operating System",
  "Runtime-Version-Observed: `0.3.0`",
  "Schema-Version-Observed-In-Source: `14`",
  "constitution.md",
  "Adaptive Path Intelligence",
  "objective != method",
  "Execution boundary",
  "Economía causal",
  "Parent/child",
  "E0 — TARGET / NARRATIVE",
  "E5 — EXTERNAL AUTHENTICATED LIVE",
  "E6 — ECONOMIC LIVE",
  "E7 — SUSTAINED OPERATION",
  "PR #29",
  "Documentation drift",
])requireText(project,needle,`PROJECT ABOS baseline missing: ${needle}`);

const continuity=read(paths.continuity);
const activePlan=field(continuity,"Active-Plan");
const activeSegment=field(continuity,"Active-Segment");
const reasoningLayer=field(continuity,"Reasoning-Layer");
const reasoningAcceptance=field(continuity,"Reasoning-Acceptance");
const hostMode=field(continuity,"Host-Mode");
const integrityVerifier=field(continuity,"ProjectOps-Integrity-Verifier");
const lastReconciledHead=field(continuity,"Last-Reconciled-Host-Head");
if(reasoningLayer!=="system/ABOS_ADAPTIVE_REASONING_LAYER.md")fail(`unexpected Reasoning-Layer authority: ${reasoningLayer}`);
if(reasoningAcceptance!=="system/ABOS_ADAPTIVE_REASONING_ACCEPTANCE.md")fail(`unexpected Reasoning-Acceptance authority: ${reasoningAcceptance}`);
if(hostMode!=="system/PUBLIC_TRACKED_MATRIX.md")fail(`unexpected Host-Mode authority: ${hostMode}`);
if(integrityVerifier!=="scripts/projectops-integrity-verify.mjs")fail(`unexpected ProjectOps integrity verifier: ${integrityVerifier}`);
if(!/^[0-9a-f]{40}$/.test(lastReconciledHead))fail("Last-Reconciled-Host-Head must be an exact 40-character Git SHA");

const activeSegmentPath=`ProjectOps/${activeSegment}`;
const activePlanPath=`ProjectOps/plan/${activePlan}.md`;
requirePath(activeSegmentPath);
requirePath(activePlanPath);
const segment=read(activeSegmentPath);
requireText(segment,"State: ACTIVE","active continuity segment is not marked ACTIVE");
if(statSync(at(activeSegmentPath)).size>100*1024)fail(`${activeSegmentPath} exceeded 100 KiB rotation threshold`);
if(lineCount(segment)>1000)fail(`${activeSegmentPath} exceeded 1000-line rotation threshold`);

const plan=read(paths.plan);
const planRows=new Map();
for(const match of plan.matchAll(/^\|\s*(P-\d{3})\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|\s*(plan\/[^|\s]+\.md)\s*\|$/gm)){
  const [,id,title,state,dependencies,modulePath]=match;
  if(planRows.has(id))fail(`duplicate PLAN id: ${id}`);
  planRows.set(id,{title:title.trim(),state:state.trim(),dependencies:dependencies.trim(),modulePath});
  const full=`ProjectOps/${modulePath}`;
  requirePath(full);
  const actualState=moduleState(read(full));
  if(actualState!==state.trim())fail(`${id} manifest/module state mismatch: ${state.trim()} vs ${actualState}`);
}
for(let n=1;n<=5;n++){
  const id=`P-${String(n).padStart(3,"0")}`;
  if(!planRows.has(id))fail(`PLAN manifest missing ${id}`);
}
if(!planRows.has(activePlan))fail(`PLAN manifest does not contain active plan ${activePlan}`);
if(planRows.get("P-001").state!=="HECHO")fail("P-001 must be HECHO after identity audit");
if(planRows.get("P-002").state!=="HECHO")fail("P-002 must be HECHO after cutover");
if(planRows.get("P-003").state!=="PARCIAL")fail("P-003 must remain PARCIAL while PR #29 is open/unintegrated");

for(const [id,needle] of new Map([
  ["P-001","Reconstruir identidad, baseline, autoridades y plan ABOS"],
  ["P-002","PUBLIC_TRACKED_DOCUMENTARY_MATRIX"],
  ["P-003","child capital semantics"],
  ["P-004","documentación arquitectónica"],
  ["P-005","acceptance LIVE"],
])){
  const row=planRows.get(id);
  const body=read(`ProjectOps/${row.modulePath}`);
  requireText(body,needle,`${id} lost ABOS-specific identity: ${needle}`);
}

const activePlanModule=read(activePlanPath);
const requiredContextLines=activePlanModule.split(/\r?\n/);
const requiredContextIndex=requiredContextLines.findIndex(line=>line.trim()==="Required-Context:");
if(requiredContextIndex<0)fail(`${activePlanPath} has no Required-Context section`);
let requiredPathCount=0;
for(let index=requiredContextIndex+1;index<requiredContextLines.length;index++){
  const line=requiredContextLines[index];
  if(!line.trim()&&requiredPathCount>0)break;
  const match=line.match(/^\s*-\s+`([^`]+)`/);
  if(!match)continue;
  requiredPathCount++;
  requirePath(match[1]);
}
if(requiredPathCount===0)fail(`${activePlanPath} Required-Context contains no concrete local references`);

console.log("PROJECTOPS_INTEGRITY_VERIFY: PASS");
