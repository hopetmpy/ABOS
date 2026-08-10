import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { randomBytes, createHash } from "node:crypto";
import Database from "better-sqlite3";
import { privateKeyToAccount } from "viem/accounts";
import { RestrictedBaseRpcTransport, RestrictedChainReader } from "./chain-reader.js";
import { RestrictedLiveAudit } from "./audit.js";
import { BASE_CHAIN_ID, BASE_USDC_ADDRESS, LIVE_DRY_RUN, LIVE_PATHS, RESTRICTED_LIVE_MODE, RestrictedLiveViolation, initializeLiveRoot } from "./mode.js";
import { getRestrictedWalletPath, readRestrictedWalletInfo } from "./wallet.js";

export const X402SCAN_WALLET = "0x0B5c4E5c45D05FED683B8Aa27547c26006e9aD5e" as const;
export const X402SCAN_ROUTE = Object.freeze({
  origin: "https://www.x402scan.com", url: "https://www.x402scan.com/api/x402/buyers", method: "GET",
  x402Version: 2, scheme: "exact", network: "eip155:8453", chainId: BASE_CHAIN_ID,
  asset: BASE_USDC_ADDRESS, amount: "10000", amountBaseUnits: 10_000n,
  payTo: "0x2EC4545f96A24876764bF2B04D54E66A1351bE71" as const, maxTimeoutSeconds: 300,
  eip712Name: "USD Coin", eip712Version: "2",
});
const EXPECTED_FUNDING_BASE_UNITS = 5_000_000n;
const MINIMUM_RESERVE_BASE_UNITS = 4_000_000n;
const MAX_HOURLY_BASE_UNITS = 250_000n;
const MAX_DAILY_BASE_UNITS = 500_000n;

export interface PaymentRequirement { scheme: string; network: string; amount: string; asset: string; payTo: string; maxTimeoutSeconds: number; extra?: Record<string, unknown>; [key: string]: unknown }
export interface LiveChallenge { x402Version: number; resource: { url: string; method: string; [key: string]: unknown }; accepts: PaymentRequirement[]; [key: string]: unknown }
export interface Authorization { from: `0x${string}`; to: `0x${string}`; value: string; validAfter: string; validBefore: string; nonce: `0x${string}` }
export interface OneShotSigner { sign(authorization: Authorization): Promise<`0x${string}`> }
export interface OneShotDependencies {
  fetch: typeof fetch; getBalanceBaseUnits: () => Promise<bigint>; signer?: OneShotSigner;
  confirm?: (preview: string) => Promise<string>; now?: () => number; nonce?: () => `0x${string}`;
  sleep?: (ms: number) => Promise<void>; pollDelaysMs?: readonly number[];
  stateFile?: string; audit?: { record(event: string, metadata?: Record<string, unknown>): void };
  walletAddress?: `0x${string}`; getReceipt?: (txHash: string) => Promise<unknown>;
  getChainId?: () => Promise<number>;
  proposalId?: string;
}
export type IntentStatus = "RESERVED" | "SIGNED" | "SUBMITTED" | "UNCERTAIN" | "SETTLED" | "FAILED_NONREUSABLE";
export interface StoredIntent {
  idempotency_key: string; nonce: string; challenge_fingerprint: string; status: IntentStatus;
  created_at: number; updated_at: number; response_status: number | null; balance_after: string | null;
  pre_balance_base_units?: string | null; payment_amount_base_units?: string | null;
  reserved_at?: number | null; signed_at?: number | null; submitted_at?: number | null;
  response_received_at?: number | null; reconciled_at?: number | null; settled_at?: number | null;
  payment_response_header?: string | null; settlement_metadata?: string | null; settlement_tx_hash?: string | null;
  resource_response_metadata?: string | null; proposal_id?: string | null;
}

function fail(code: string, message: string): never { throw new RestrictedLiveViolation(code, message); }
function sameAddress(a: unknown, b: string): boolean { return typeof a === "string" && a.toLowerCase() === b.toLowerCase(); }
function formatUsdc(units: bigint): string { const whole=units/1_000_000n, fraction=(units%1_000_000n).toString().padStart(6,"0").replace(/0+$/,""); return fraction?`${whole}.${fraction}`:whole.toString(); }
function sha256(value: string): string { return createHash("sha256").update(value).digest("hex"); }

export async function decodeAndValidateChallenge(response: Response): Promise<{ challenge: LiveChallenge; requirement: PaymentRequirement; fingerprint: string }> {
  if (response.status !== 402) fail("CHALLENGE_MISMATCH", `Expected HTTP 402, received ${response.status}`);
  if (response.redirected || response.url && response.url !== X402SCAN_ROUTE.url) fail("REDIRECT_DENIED", "Redirected payment challenge denied");
  const encoded=response.headers.get("payment-required"); if(!encoded) fail("CHALLENGE_MISMATCH","Missing PAYMENT-REQUIRED header");
  let challenge: LiveChallenge; try{challenge=JSON.parse(Buffer.from(encoded,"base64").toString("utf8"));}catch{fail("CHALLENGE_MISMATCH","Invalid PAYMENT-REQUIRED header");}
  if(challenge.x402Version!==2||challenge.resource?.url!==X402SCAN_ROUTE.url||challenge.resource?.method!=="GET"||challenge.accepts?.length!==1) fail("CHALLENGE_MISMATCH","Pinned challenge envelope changed");
  const r=challenge.accepts[0], allowed=new Set(["scheme","network","amount","asset","payTo","maxTimeoutSeconds","extra"]);
  if(Object.keys(r).some(k=>!allowed.has(k))) fail("CHALLENGE_MISMATCH","Unexpected payment or calldata field");
  if(r.scheme!=="exact"||r.network!=="eip155:8453"||r.amount!=="10000"||!sameAddress(r.asset,BASE_USDC_ADDRESS)||!sameAddress(r.payTo,X402SCAN_ROUTE.payTo)||r.maxTimeoutSeconds!==300||r.extra?.name!=="USD Coin"||r.extra?.version!=="2"||(r.extra?.assetTransferMethod!==undefined&&r.extra.assetTransferMethod!=="eip3009")) fail("CHALLENGE_MISMATCH","Fresh challenge differs from pinned payment route");
  return {challenge,requirement:r,fingerprint:sha256(JSON.stringify(challenge))};
}

function columns(db: Database.Database): Set<string> { return new Set((db.prepare("PRAGMA table_info(x402_one_shot_intents)").all() as Array<{name:string}>).map(r=>r.name)); }
const MIGRATIONS: Record<string,string>={
  pre_balance_base_units:"TEXT",payment_amount_base_units:"TEXT",reserved_at:"INTEGER",signed_at:"INTEGER",submitted_at:"INTEGER",
  response_received_at:"INTEGER",reconciled_at:"INTEGER",settled_at:"INTEGER",payment_response_header:"TEXT",
  settlement_metadata:"TEXT",settlement_tx_hash:"TEXT",resource_response_metadata:"TEXT",proposal_id:"TEXT",
};
export class OneShotState {
  private readonly db: Database.Database;
  constructor(file:string){fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});this.db=new Database(file);fs.chmodSync(file,0o600);this.db.pragma("journal_mode = WAL");this.db.exec("CREATE TABLE IF NOT EXISTS x402_one_shot_intents (idempotency_key TEXT PRIMARY KEY, nonce TEXT UNIQUE NOT NULL, challenge_fingerprint TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, response_status INTEGER, balance_after TEXT)");const existing=columns(this.db);for(const [name,type] of Object.entries(MIGRATIONS))if(!existing.has(name))this.db.exec(`ALTER TABLE x402_one_shot_intents ADD COLUMN ${name} ${type}`);}
  close():void{this.db.close();}
  get(key?:string):StoredIntent|undefined{return this.db.prepare(key?"SELECT * FROM x402_one_shot_intents WHERE idempotency_key=?":"SELECT * FROM x402_one_shot_intents ORDER BY created_at DESC LIMIT 1").get(...(key?[key]:[])) as StoredIntent|undefined;}
  assertCanStart(proposalId?:string):void{const p=this.db.prepare("SELECT status FROM x402_one_shot_intents WHERE status!='SETTLED' LIMIT 1").get() as {status:IntentStatus}|undefined;if(p)fail("UNRESOLVED_PAYMENT",`Prior payment intent is ${p.status}`);if(proposalId&&this.db.prepare("SELECT 1 FROM x402_one_shot_intents WHERE proposal_id=? LIMIT 1").get(proposalId))fail("REPLAY_DENIED","Proposal already has a payment intent");}
  reserve(key:string,nonce:string,fingerprint:string,now:number,pre:bigint,proposalId?:string):void{const tx=this.db.transaction(()=>{this.assertCanStart(proposalId);this.db.prepare("INSERT INTO x402_one_shot_intents (idempotency_key,nonce,challenge_fingerprint,status,created_at,updated_at,pre_balance_base_units,payment_amount_base_units,reserved_at,proposal_id) VALUES (?,?,?,'RESERVED',?,?,?,?,?,?)").run(key,nonce,fingerprint,now,now,pre.toString(),X402SCAN_ROUTE.amount,now,proposalId??null);});try{tx.immediate();}catch(e){if(e instanceof RestrictedLiveViolation)throw e;fail("NONCE_STATE_INVALID","Could not reserve durable payment nonce");}}
  mark(key:string,status:IntentStatus,now:number,responseStatus?:number,balanceAfter?:bigint):void{const current=this.get(key);if(!current)fail("NONCE_STATE_INVALID","Payment intent state is inconsistent");if(current.status==="SETTLED"&&status!=="SETTLED")fail("STATE_TRANSITION_DENIED","SETTLED payment intent is terminal");const timestampColumn:Partial<Record<IntentStatus,string>>={SIGNED:"signed_at",SUBMITTED:"submitted_at",SETTLED:"settled_at"};const column=timestampColumn[status];const sql=`UPDATE x402_one_shot_intents SET status=?,updated_at=?,response_status=COALESCE(?,response_status),balance_after=COALESCE(?,balance_after)${column?`,${column}=COALESCE(${column},?)`:""} WHERE idempotency_key=?`;const args:unknown[]=[status,now,responseStatus??null,balanceAfter?.toString()??null];if(column)args.push(now);args.push(key);if(this.db.prepare(sql).run(...args).changes!==1)fail("NONCE_STATE_INVALID","Payment intent state is inconsistent");}
  recordResponse(key:string,response:Response,now:number,header:string|null,metadata:unknown,txHash:string|null,resourceMetadata:unknown):void{const result=this.db.prepare("UPDATE x402_one_shot_intents SET response_status=?,response_received_at=?,updated_at=?,payment_response_header=?,settlement_metadata=?,settlement_tx_hash=?,resource_response_metadata=? WHERE idempotency_key=?").run(response.status,now,now,header,metadata?JSON.stringify(metadata):null,txHash,JSON.stringify(resourceMetadata),key);if(result.changes!==1)fail("NONCE_STATE_INVALID","Could not persist paid response metadata");}
  settleUncertain(key:string,now:number,balance:bigint):void{const tx=this.db.transaction(()=>{const row=this.get(key);if(!row)fail("NONCE_STATE_INVALID","Payment intent changed during reconciliation");if(row.status==="SETTLED")return;if(row.status!=="UNCERTAIN")fail("RECOVERY_DENIED",`Cannot reconcile state ${row.status}`);const result=this.db.prepare("UPDATE x402_one_shot_intents SET status='SETTLED',updated_at=?,reconciled_at=?,settled_at=?,balance_after=? WHERE idempotency_key=? AND status='UNCERTAIN'").run(now,now,now,balance.toString(),key);if(result.changes!==1)fail("NONCE_STATE_INVALID","Atomic reconciliation transition failed");});tx.immediate();}
  spendBaseUnitsSince(cutoff:number):bigint{return (this.db.prepare("SELECT payment_amount_base_units FROM x402_one_shot_intents WHERE status='SETTLED' AND COALESCE(settled_at,updated_at)>=?").all(cutoff) as Array<{payment_amount_base_units:string|null}>).reduce((s,r)=>s+BigInt(r.payment_amount_base_units??X402SCAN_ROUTE.amount),0n);}
}

export function readIntentReadonly(file:string):StoredIntent|undefined{const db=new Database(file,{readonly:true,fileMustExist:true});try{return db.prepare("SELECT * FROM x402_one_shot_intents LIMIT 1").get() as StoredIntent|undefined;}finally{db.close();}}

export class PinnedEip3009Signer implements OneShotSigner {
  async sign(a:Authorization):Promise<`0x${string}`>{if(!RESTRICTED_LIVE_MODE)fail("MODE_REQUIRED","Restricted-live signing mode required");const info=readRestrictedWalletInfo();if(!sameAddress(a.from,info.address)||!sameAddress(a.to,X402SCAN_ROUTE.payTo)||a.value!=="10000"||a.validAfter!=="0"||!/^0x[0-9a-f]{64}$/i.test(a.nonce)||BigInt(a.validBefore)>BigInt(Math.floor(Date.now()/1000)+300)||BigInt(a.validBefore)<=BigInt(Math.floor(Date.now()/1000)))fail("SIGNING_DENIED","Authorization is outside the pinned EIP-3009 boundary");const file=getRestrictedWalletPath();if((fs.statSync(file).mode&0o777)!==0o600)fail("WALLET_PERMISSIONS","Dedicated wallet permissions must be 0600");let secret:`0x${string}`|undefined;try{const parsed=JSON.parse(fs.readFileSync(file,"utf8")) as {address?:string;privateKey?:`0x${string}`};if(!sameAddress(parsed.address,info.address)||!parsed.privateKey)fail("WALLET_INVALID","Dedicated wallet is invalid");secret=parsed.privateKey;return await privateKeyToAccount(secret).signTypedData({domain:{name:"USD Coin",version:"2",chainId:8453,verifyingContract:BASE_USDC_ADDRESS},types:{TransferWithAuthorization:[{name:"from",type:"address"},{name:"to",type:"address"},{name:"value",type:"uint256"},{name:"validAfter",type:"uint256"},{name:"validBefore",type:"uint256"},{name:"nonce",type:"bytes32"}]},primaryType:"TransferWithAuthorization",message:{...a,value:10000n,validAfter:0n,validBefore:BigInt(a.validBefore)}});}catch(e){if(e instanceof RestrictedLiveViolation)throw e;fail("SIGNING_FAILED","Pinned EIP-3009 signing failed");}finally{secret=undefined;}}
  signTransaction():never{return fail("SIGNING_DENIED","Transaction signing is disabled");} personalSign():never{return fail("SIGNING_DENIED","personal_sign is disabled");} ethSign():never{return fail("SIGNING_DENIED","eth_sign is disabled");}
}

export function formatPaymentPreview(balance:bigint,hourly:bigint,daily:bigint,expiry:number):string{return [`URL: ${X402SCAN_ROUTE.url}`,"Method: GET",`Recipient: ${X402SCAN_ROUTE.payTo}`,"Chain: Base / eip155:8453",`Token: ${BASE_USDC_ADDRESS}`,"Amount: 0.01 USDC",`Wallet balance before: ${formatUsdc(balance)} USDC`,`Projected balance after: ${formatUsdc(balance-10_000n)} USDC`,`Hourly spend: ${formatUsdc(hourly)} -> ${formatUsdc(hourly+10_000n)} USDC`,`Daily spend: ${formatUsdc(daily)} -> ${formatUsdc(daily+10_000n)} USDC`,`Authorization expiry: ${new Date(expiry*1000).toISOString()}`].join("\n");}
async function fetchFreshChallenge(fetcher:typeof fetch){return decodeAndValidateChallenge(await fetcher(X402SCAN_ROUTE.url,{method:"GET",headers:{accept:"application/json"},redirect:"manual",signal:AbortSignal.timeout(30_000)}));}

export interface SettlementMetadata { raw:Record<string,unknown>; txHash:string|null; status:unknown; network:unknown; payer:unknown; recipient:unknown; amount:unknown }
export function decodePaymentResponse(header:string|null):SettlementMetadata|null{if(!header)return null;let raw:Record<string,unknown>;try{const text=header.trim().startsWith("{")?header:Buffer.from(header,"base64").toString("utf8");raw=JSON.parse(text);}catch{fail("PAYMENT_RESPONSE_INVALID","Invalid PAYMENT-RESPONSE header");}const txHash=[raw.transaction,raw.transactionHash,raw.txHash].find(v=>typeof v==="string") as string|undefined;const result={raw,txHash:txHash??null,status:raw.status??raw.success,network:raw.network,payer:raw.payer??raw.from,recipient:raw.recipient??raw.to??raw.payTo,amount:raw.amount??raw.value};if(result.network!==undefined&&result.network!=="eip155:8453")fail("PAYMENT_RESPONSE_MISMATCH","Settlement network mismatch");if(result.payer!==undefined&&!sameAddress(result.payer,X402SCAN_WALLET))fail("PAYMENT_RESPONSE_MISMATCH","Settlement payer mismatch");if(result.recipient!==undefined&&!sameAddress(result.recipient,X402SCAN_ROUTE.payTo))fail("PAYMENT_RESPONSE_MISMATCH","Settlement recipient mismatch");if(result.amount!==undefined&&String(result.amount)!=="10000")fail("PAYMENT_RESPONSE_MISMATCH","Settlement amount mismatch");if(result.txHash!==null&&!/^0x[0-9a-f]{64}$/i.test(result.txHash))fail("PAYMENT_RESPONSE_INVALID","Invalid settlement transaction hash");return result;}

const TRANSFER_TOPIC="0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
export function validateReceipt(receipt:unknown):"SETTLED"|"FAILED"|"MISMATCH"{if(!receipt||typeof receipt!=="object")return "MISMATCH";const r=receipt as Record<string,unknown>;if(r.status==="0x0")return "FAILED";if(r.status!=="0x1")return "MISMATCH";const logs=Array.isArray(r.logs)?r.logs:[];const transfers=logs.filter(l=>{if(!l||typeof l!=="object")return false;const x=l as Record<string,unknown>,topics=x.topics as unknown[]|undefined;return sameAddress(x.address,BASE_USDC_ADDRESS)&&Array.isArray(topics)&&String(topics[0]).toLowerCase()===TRANSFER_TOPIC;});if(transfers.length===0)return "SETTLED";return transfers.some(l=>{const x=l as Record<string,unknown>,t=x.topics as string[];const from=`0x${t[1]?.slice(-40)}`,to=`0x${t[2]?.slice(-40)}`,amount=BigInt(String(x.data));return sameAddress(from,X402SCAN_WALLET)&&sameAddress(to,X402SCAN_ROUTE.payTo)&&amount===10_000n;})?"SETTLED":"MISMATCH";}

export interface ReconcileResult { classification:"SETTLED"|"FAILED"|"UNCERTAIN"; evidence:string; observedBalanceBaseUnits:bigint; txHash:string|null; transitioned:boolean }
export async function reconcileIntent(deps:OneShotDependencies,intent:StoredIntent):Promise<ReconcileResult>{
  if(deps.getChainId&&await deps.getChainId()!==8453)fail("CHAIN_DENIED","Reconciliation requires Base chain 8453");
  if(intent.status==="SETTLED")return{classification:"SETTLED",evidence:"journal already settled",observedBalanceBaseUnits:BigInt(intent.balance_after??"0"),txHash:intent.settlement_tx_hash??null,transitioned:false};
  if(intent.status!=="UNCERTAIN")fail("RECOVERY_DENIED",`Intent is not reconcilable: ${intent.status}`);
  const pre=BigInt(intent.pre_balance_base_units??EXPECTED_FUNDING_BASE_UNITS.toString()),amount=BigInt(intent.payment_amount_base_units??X402SCAN_ROUTE.amount),expected=pre-amount;
  const metadata=intent.settlement_metadata?JSON.parse(intent.settlement_metadata) as SettlementMetadata:null;const txHash=intent.settlement_tx_hash??metadata?.txHash??null;
  if(txHash&&deps.getReceipt){const receiptResult=validateReceipt(await deps.getReceipt(txHash));if(receiptResult==="SETTLED")return{classification:"SETTLED",evidence:"successful settlement receipt",observedBalanceBaseUnits:await deps.getBalanceBaseUnits(),txHash,transitioned:false};if(receiptResult==="FAILED")return{classification:"FAILED",evidence:"failed settlement receipt",observedBalanceBaseUnits:await deps.getBalanceBaseUnits(),txHash,transitioned:false};if(receiptResult==="MISMATCH")return{classification:"UNCERTAIN",evidence:"settlement receipt mismatch",observedBalanceBaseUnits:await deps.getBalanceBaseUnits(),txHash,transitioned:false};}
  const delays=deps.pollDelaysMs??[0,1000,2000,4000,8000],sleep=deps.sleep??(ms=>new Promise(r=>setTimeout(r,ms)));let observed=pre;
  for(const delay of delays){if(delay>0)await sleep(delay);observed=await deps.getBalanceBaseUnits();if(observed===expected)return{classification:"SETTLED",evidence:`exact balance delta ${pre}-${observed}=${amount}`,observedBalanceBaseUnits:observed,txHash,transitioned:false};if(observed!==pre)return{classification:"UNCERTAIN",evidence:observed>pre?"balance unexpectedly higher":"balance changed by wrong amount",observedBalanceBaseUnits:observed,txHash,transitioned:false};}
  return{classification:"UNCERTAIN",evidence:"settlement not visible within bounded polling window",observedBalanceBaseUnits:observed,txHash,transitioned:false};
}

export async function runX402scanPreview(deps:OneShotDependencies):Promise<{preview:string;fingerprint:string}>{if(!RESTRICTED_LIVE_MODE||!LIVE_DRY_RUN)fail("MODE_REQUIRED","Dry preview requires restricted-live dry-run mode");const{fingerprint}=await fetchFreshChallenge(deps.fetch),balance=await deps.getBalanceBaseUnits();if(balance>EXPECTED_FUNDING_BASE_UNITS||balance-10_000n<MINIMUM_RESERVE_BASE_UNITS)fail("BALANCE_DENIED","Wallet balance violates pinned limits");return{preview:formatPaymentPreview(balance,0n,0n,Math.floor((deps.now?.()??Date.now())/1000)+300),fingerprint};}
export async function runX402scanOnce(_deps:OneShotDependencies):Promise<never>{return fail("HUMAN_APPROVAL_REQUIRED","Direct payment execution is disabled; use --restricted-live-review-payment");}

export async function executeX402scanOnceForTest(deps:OneShotDependencies):Promise<{status:number;balanceAfterBaseUnits:bigint}>{
  initializeLiveRoot();const now=deps.now??Date.now,state=new OneShotState(deps.stateFile??path.join(LIVE_PATHS.state,"x402-one-shot.db")),audit=deps.audit??new RestrictedLiveAudit();
  try{state.assertCanStart(deps.proposalId);const{requirement,fingerprint}=await fetchFreshChallenge(deps.fetch),pre=await deps.getBalanceBaseUnits(),hourly=state.spendBaseUnitsSince(now()-3_600_000),daily=state.spendBaseUnitsSince(now()-86_400_000);if(pre>EXPECTED_FUNDING_BASE_UNITS||pre-10_000n<MINIMUM_RESERVE_BASE_UNITS||hourly+10_000n>MAX_HOURLY_BASE_UNITS||daily+10_000n>MAX_DAILY_BASE_UNITS)fail("BALANCE_DENIED","Balance, reserve, or spend budget check failed");const expiry=Math.floor(now()/1000)+300,answer=await(deps.confirm??terminalConfirm)(formatPaymentPreview(pre,hourly,daily,expiry));if(answer!=="PAY 0.01 USDC")fail("CONFIRMATION_DENIED","Exact payment confirmation not received");const nonce=(deps.nonce??(()=>`0x${randomBytes(32).toString("hex")}` as `0x${string}`))(),key=sha256(`${fingerprint}:${nonce}`);state.reserve(key,nonce,fingerprint,now(),pre,deps.proposalId);const authorization:Authorization={from:deps.walletAddress??readRestrictedWalletInfo().address as `0x${string}`,to:X402SCAN_ROUTE.payTo,value:"10000",validAfter:"0",validBefore:String(expiry),nonce};if(!deps.signer)fail("SIGNER_UNAVAILABLE","Pinned signer unavailable");const signature=await deps.signer.sign(authorization);state.mark(key,"SIGNED",now());const payload=Buffer.from(JSON.stringify({x402Version:2,accepted:requirement,payload:{authorization,signature}})).toString("base64");state.mark(key,"SUBMITTED",now());let response:Response;try{response=await deps.fetch(X402SCAN_ROUTE.url,{method:"GET",headers:{accept:"application/json","payment-signature":payload},redirect:"manual",signal:AbortSignal.timeout(30_000)});}catch{state.mark(key,"UNCERTAIN",now());fail("SETTLEMENT_UNCERTAIN","Paid request outcome is uncertain; reconcile read-only");}
    const header=response.headers.get("payment-response");let resourceMetadata:Record<string,unknown>={url:response.url||X402SCAN_ROUTE.url,status:response.status,contentType:response.headers.get("content-type")};try{const bytes=Buffer.from(await response.clone().arrayBuffer());resourceMetadata={...resourceMetadata,bodyBytes:bytes.length,bodySha256:sha256(bytes.toString("base64"))};}catch{}state.recordResponse(key,response,now(),header,null,null,resourceMetadata);let metadata:SettlementMetadata|null;try{metadata=decodePaymentResponse(header);}catch(e){state.mark(key,"UNCERTAIN",now(),response.status);throw e;}if(metadata)state.recordResponse(key,response,now(),header,metadata,metadata.txHash,resourceMetadata);
    if(response.status>=500||[402,408,429].includes(response.status)){state.mark(key,"UNCERTAIN",now(),response.status);fail("SETTLEMENT_UNCERTAIN",`Paid request returned ambiguous HTTP ${response.status}`);}if(response.status<200||response.status>=300||response.redirected||response.headers.has("location")||(response.url&&response.url!==X402SCAN_ROUTE.url)||!response.headers.get("content-type")?.toLowerCase().includes("application/json")){state.mark(key,"FAILED_NONREUSABLE",now(),response.status);fail("PAYMENT_FAILED",`Paid response did not match the pinned resource (HTTP ${response.status})`);}state.mark(key,"UNCERTAIN",now(),response.status);const intent=state.get()!;const result=await reconcileIntent(deps,intent);if(result.classification!=="SETTLED")fail("SETTLEMENT_UNCERTAIN",result.evidence);state.settleUncertain(key,now(),result.observedBalanceBaseUnits);audit.record("x402_one_shot_settled",{url:X402SCAN_ROUTE.url,amountBaseUnits:"10000",recipient:X402SCAN_ROUTE.payTo,challengeFingerprint:fingerprint,responseStatus:response.status,balanceAfterBaseUnits:result.observedBalanceBaseUnits.toString()});return{status:response.status,balanceAfterBaseUnits:result.observedBalanceBaseUnits};
  }finally{state.close();}
}

export async function runX402scanReconciliation(deps:OneShotDependencies):Promise<ReconcileResult>{if(!RESTRICTED_LIVE_MODE)fail("MODE_REQUIRED","Restricted-live reconciliation mode required");const file=deps.stateFile??path.join(LIVE_PATHS.state,"x402-one-shot.db"),initial=readIntentReadonly(file);if(!initial)fail("RECOVERY_DENIED","No payment intent exists");const result=await reconcileIntent(deps,initial);if(result.classification!=="SETTLED"||initial.status==="SETTLED")return result;const state=new OneShotState(file);try{state.settleUncertain(initial.idempotency_key,deps.now?.()??Date.now(),result.observedBalanceBaseUnits);return{...result,transitioned:true};}finally{state.close();}}

async function terminalConfirm(preview:string):Promise<string>{process.stdout.write(`${preview}\n\nType exactly: PAY 0.01 USDC\n> `);const rl=readline.createInterface({input:process.stdin,output:process.stdout});try{return await rl.question("");}finally{rl.close();}}
function liveReader(){const audit=new RestrictedLiveAudit(),rpc="https://mainnet.base.org",reader=new RestrictedChainReader(rpc,X402SCAN_WALLET,new RestrictedBaseRpcTransport(rpc,audit));return{audit,reader};}
export function createLivePreviewDependencies():OneShotDependencies{const{audit,reader}=liveReader();return{fetch,getBalanceBaseUnits:()=>reader.getOwnUsdcBalanceBaseUnits(),audit,walletAddress:X402SCAN_WALLET};}
export function createLiveDependencies():OneShotDependencies{return{...createLivePreviewDependencies(),signer:new PinnedEip3009Signer()};}
export function createLiveReconcileDependencies():OneShotDependencies{const{audit,reader}=liveReader();return{fetch:async()=>fail("NETWORK_DENIED","HTTP resource access is disabled during reconciliation"),getBalanceBaseUnits:()=>reader.getOwnUsdcBalanceBaseUnits(),getChainId:()=>reader.getChainId(),getReceipt:hash=>reader.request("eth_getTransactionReceipt",[hash]),audit,walletAddress:X402SCAN_WALLET};}
