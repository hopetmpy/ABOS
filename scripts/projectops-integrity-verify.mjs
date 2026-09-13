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
const gitBlobSha=content=>{const b=Buffer.from(content,"utf8");return createHash("sha1").update(Buffer.from(`blob ${b.length}\0`)).update(b).digest("hex")};
const requireBlob=(path,expected)=>{const actual=gitBlobSha(read(path));if(actual!==expected)fail(`${path} blob drift: expected ${expected}, got ${actual}`)};
const field=(content,name)=>{const m=content.match(new RegExp(`^${name}:\\s*(.+)$`,"m"));if(!m)fail(`manifest field missing: ${name}`);return m[1].trim()};
const stateOf=content=>{const m=content.match(/^State:\s*(.+)$/m);if(!m)fail("plan module missing State");return m[1].trim()};

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
for(const path of Object.values(p))requirePath(path);
forbidFile("CONTINUITY.md");
forbidFile("PLAN.md");

requireBlob(p.protocol,"ba0d546c704d7078fb1471107c29c7174379d134");
requireBlob(p.legacyContinuity,"6ee88dc560dc53ddb6e728fca9193fa62f6ee3a7");
requireBlob(p.legacyPlan,"8c52273bf1801958273a77474315c85e0903ee1d");

const agents=read(p.agents);
for(const needle of [
  "<!-- PROJECTOPS:ABOS-ROOT-ENTRYPOINT -->",
  "ProjectOps/system/ABOS_OPERATING_PROTOCOL.md",
  "ProjectOps/system/ABOS_ADAPTIVE_REASONING_LAYER.md",
  "ProjectOps/CONTINUITY.md",
  "ProjectOps/PROJECT.md",
  "Required-Context",
  "mínimo obligatorio, no un límite",
  "DECISION_READY",
  "NO_CHANGE",
  "Autonomous Business Operating System",
  "constitution.md",
  "funding no es balance",
  "PUBLIC_TRACKED_MATRIX.md",
  "~/.abos",
])requireText(agents,needle,`root AGENTS missing: ${needle}`);
const ai=agents.indexOf("ProjectOps/system/ABOS_OPERATING_PROTOCOL.md");
const ri=agents.indexOf("ProjectOps/system/ABOS_ADAPTIVE_REASONING_LAYER.md");
const ci=agents.indexOf("ProjectOps/CONTINUITY.md");
if(!(ai>=0&&ai<ri&&ri<ci))fail("root activation order must be protocol -> reasoning -> continuity");
if(statSync(at(p.agents)).size>12*1024)fail("root AGENTS exceeded 12 KiB compact-router budget");

const reasoning=read(p.reasoning);
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
])requireText(reasoning,needle,`reasoning layer missing: ${needle}`);
if(statSync(at(p.reasoning)).size>48*1024||lineCount(reasoning)>800)fail("reasoning layer exceeded mandatory-context budget");

const acceptance=read(p.acceptance);
for(const needle of ["Authority: ACCEPTANCE_CONTRACT","Suite: A–N","BEHAVIORAL_SUITE_NOT_YET_EXECUTED"])
  requireText(acceptance,needle,`acceptance missing: ${needle}`);
for(const letter of "ABCDEFGHIJKLMN")requireText(acceptance,`## ${letter} —`,`acceptance scenario ${letter} missing`);

const mode=read(p.mode);
requireText(mode,"Mode: PUBLIC_TRACKED_DOCUMENTARY_MATRIX","public ProjectOps host mode missing");
requireText(mode,"Repository-Visibility-Observed-At-Cutover: PUBLIC","public-host observation missing");
requireText(mode,"No equivale a una instalación privada del CLI ProjectOps","documentary/CLI boundary missing");

const project=read(p.project);
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
  "Children / replication",
  "parent authority != child wallet authority",
  "E0 — TARGET / NARRATIVE",
  "E5 — EXTERNAL AUTHENTICATED LIVE",
  "E6 — ECONOMIC LIVE",
  "E7 — SUSTAINED OPERATION",
  "PR #29",
  "Documentation drift",
])requireText(project,needle,`PROJECT baseline missing: ${needle}`);

const continuity=read(p.continuity);
const activePlan=field(continuity,"Active-Plan");
const activeSegment=field(continuity,"Active-Segment");
if(field(continuity,"Reasoning-Layer")!=="system/ABOS_ADAPTIVE_REASONING_LAYER.md")fail("Reasoning-Layer authority mismatch");
if(field(continuity,"Reasoning-Acceptance")!=="system/ABOS_ADAPTIVE_REASONING_ACCEPTANCE.md")fail("Reasoning-Acceptance authority mismatch");
if(field(continuity,"Host-Mode")!=="system/PUBLIC_TRACKED_MATRIX.md")fail("Host-Mode authority mismatch");
if(field(continuity,"ProjectOps-Integrity-Verifier")!=="scripts/projectops-integrity-verify.mjs")fail("integrity verifier authority mismatch");
if(!/^[0-9a-f]{40}$/.test(field(continuity,"Last-Reconciled-Host-Head")))fail("Last-Reconciled-Host-Head must be exact Git SHA");

const activeSegmentPath=`ProjectOps/${activeSegment}`;
const activePlanPath=`ProjectOps/plan/${activePlan}.md`;
requirePath(activeSegmentPath);
requirePath(activePlanPath);
const segment=read(activeSegmentPath);
requireText(segment,"State: ACTIVE","active continuity segment not ACTIVE");
if(statSync(at(activeSegmentPath)).size>100*1024||lineCount(segment)>1000)fail("active continuity segment exceeded rotation threshold");

const plan=read(p.plan);
const rows=new Map();
for(const m of plan.matchAll(/^\|\s*(P-\d{3})\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|\s*(plan\/[^|\s]+\.md)\s*\|$/gm)){
  const [,id,title,state,deps,modulePath]=m;
  if(rows.has(id))fail(`duplicate PLAN id: ${id}`);
  const full=`ProjectOps/${modulePath}`; requirePath(full);
  if(stateOf(read(full))!==state.trim())fail(`${id} manifest/module state mismatch`);
  rows.set(id,{title:title.trim(),state:state.trim(),deps:deps.trim(),modulePath});
}
for(let n=1;n<=5;n++){const id=`P-${String(n).padStart(3,"0")}`;if(!rows.has(id))fail(`PLAN missing ${id}`)}
if(!rows.has(activePlan))fail(`active plan ${activePlan} missing from PLAN`);
if(rows.get("P-001").state!=="HECHO"||rows.get("P-002").state!=="HECHO"||rows.get("P-003").state!=="PARCIAL")fail("P-001/P-002/P-003 state contract mismatch");

for(const [id,needle] of [
  ["P-001","Reconstruir identidad, baseline, autoridades y plan ABOS"],
  ["P-002","PUBLIC_TRACKED_DOCUMENTARY_MATRIX"],
  ["P-003","child capital semantics"],
  ["P-004","documentación arquitectónica"],
  ["P-005","acceptance LIVE"],
])requireText(read(`ProjectOps/${rows.get(id).modulePath}`),needle,`${id} lost ABOS-specific identity`);

const active=read(activePlanPath).split(/\r?\n/);
const rci=active.findIndex(line=>line.trim()==="Required-Context:");
if(rci<0)fail(`${activePlanPath} lacks Required-Context`);
let count=0;
for(let i=rci+1;i<active.length;i++){
  if(!active[i].trim()&&count>0)break;
  const m=active[i].match(/^\s*-\s+`([^`]+)`/); if(!m)continue;
  requirePath(m[1]); count++;
}
if(!count)fail(`${activePlanPath} Required-Context has no local paths`);

console.log("PROJECTOPS_INTEGRITY_VERIFY: PASS");
