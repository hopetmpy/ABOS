/**
 * P-031 / P-018 — supplier DNS configuration observation (not verified DNS
 * propagation). This consumer reuses the existing supplier-owned inventory
 * authority and never infers usability or money from a provider status.
 *
 * Source: Conway Domains documented authenticated GET /domains/:domain/dns,
 * where source is live/cache/stale. This is a fixed-origin read-only request.
 */
import { domainToASCII } from "node:url";
import { observeConwayDomainsOwnedResources } from "./domains-owned-inventory.js";

type DnsSource = "live" | "cache" | "stale";
export interface ConwayOwnedDnsObservation {
  provider: "conway-domains";
  domain: string | null;
  status: "observed" | "partial" | "unavailable" | "not_in_inventory";
  providerAccountId: string | null;
  inventoryStatus: string | null;
  dnsSource: DnsSource | null;
  records: Array<{ id: string; type: string; host: string; value: string; ttl: number }> | null;
  independentDnsPropagationVerified: false;
  resourceUsable: false;
  purchaseAuthority: "not_established";
  financialSettlementEstablished: false;
  evidence: string[];
}

const TYPE = new Set(["A","AAAA","CNAME","MX","TXT","SRV","CAA","NS"]);
function bounded(s: unknown,max=128): s is string {
  return typeof s === "string" && s.length>0 && s.length<=max &&
    /^[\x20-\x7e]+$/.test(s);
}
function normalizeDomain(input: unknown): string | null {
  if (!bounded(input,253) || input!==input.toLowerCase()) return null;
  const value=domainToASCII(input);
  const labels=value.split(".");
  if(value!==input || labels.length<2 || labels.some(label=>
    label.length<1 || label.length>63 ||
    !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) return null;
  return value;
}
function parseDns(body: unknown): {source:DnsSource;records:NonNullable<ConwayOwnedDnsObservation["records"]>} | null {
  if(!body || typeof body!=="object" || Array.isArray(body)) return null;
  const o=body as Record<string,unknown>;
  if(o.source!=="live" && o.source!=="cache" && o.source!=="stale") return null;
  if(!Array.isArray(o.records) || o.records.length>200) return null;
  const records:NonNullable<ConwayOwnedDnsObservation["records"]>=[];
  const ids=new Set<string>();
  for(const raw of o.records) {
    if(!raw || typeof raw!=="object" || Array.isArray(raw)) return null;
    const r=raw as Record<string,unknown>;
    if(!bounded(r.recordId) || ids.has(r.recordId) ||
        !bounded(r.type,8) || !TYPE.has(r.type) ||
        !bounded(r.host,253) || !bounded(r.value,1024) ||
        !Number.isInteger(r.ttl) || (r.ttl as number)<300 ||
        (r.ttl as number)>86400) return null;
    ids.add(r.recordId);
    records.push({id:r.recordId,type:r.type,host:r.host,value:r.value,ttl:r.ttl as number});
  }
  return {source:o.source,records};
}

/** Trusted host JWT callback only; model never supplies this secret. */
export async function observeConwayOwnedDomainDns(
  getTrustedSessionToken:()=>Promise<string|null>,
  expectedWalletAddress:string,
  expectedWalletType:"evm"|"solana",
  domain:unknown,
):Promise<ConwayOwnedDnsObservation>{
  const name=normalizeDomain(domain);
  const base:ConwayOwnedDnsObservation={
    provider:"conway-domains",domain:name,status:"unavailable",
    providerAccountId:null,inventoryStatus:null,dnsSource:null,records:null,
    independentDnsPropagationVerified:false,resourceUsable:false,
    purchaseAuthority:"not_established",financialSettlementEstablished:false,
    evidence:[
      "Supplier DNS state cannot establish public authoritative DNS propagation, application reachability or resource usability.",
      "No domain acquisition, paid POST, ledger settlement or P-010 authority is performed by this observer.",
    ],
  };
  if(!name || typeof getTrustedSessionToken!=="function")return base;
  try{
    // One JWT is captured once in host memory, used only with the pinned origin.
    const jwt=await getTrustedSessionToken();
    if(!jwt)return base;
    const snapshot=await observeConwayDomainsOwnedResources(
      async()=>jwt,expectedWalletAddress,expectedWalletType,
    );
    if(snapshot.account.status!=="wallet_match" ||
        !snapshot.domains)return base;
    const account=snapshot.account.providerAccountId;
    const owned=snapshot.domains.find(x=>x.domain===name);
    if(!owned) return {
      ...base,status:"not_in_inventory",providerAccountId:account,
      evidence:[...base.evidence,"Authenticated provider inventory did not list this domain at observation time; do not infer permanent nonownership."],
    };
    const response=await fetch(`https://api.conway.domains/domains/${encodeURIComponent(name)}/dns`,{
      method:"GET",redirect:"error",cache:"no-store",
      headers:{
        Authorization:`Bearer ${jwt}`,
        Accept:"application/json",
        "Cache-Control":"no-store",
      },
      signal:AbortSignal.timeout(10000),
    });
    if(!response.ok)return {...base,status:"partial",providerAccountId:account,inventoryStatus:owned.status};
    const parsed=parseDns(await response.json());
    if(!parsed)return {...base,status:"partial",providerAccountId:account,inventoryStatus:owned.status};
    return {
      ...base,status:parsed.source==="stale"?"partial":"observed",
      providerAccountId:account,inventoryStatus:owned.status,
      dnsSource:parsed.source,records:parsed.records,
      evidence:[...base.evidence,
        "Domain ownership and DNS records reported by the same authenticated supplier account; an independent DNS or application reachability observation is still required.",
        parsed.source==="stale"
          ?"Supplier explicitly reports stale DNS data; freshness unresolved."
          :"Supplier reports DNS data from live/cache; caching does not prove external propagation.",
      ],
    };
  }catch{return base;}
}
