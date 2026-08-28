/**
 * Email Deliverability Engine
 *
 * SPF/DKIM/DMARC validation, blacklist monitoring, spam scoring,
 * email verification, reputation scoring, domain rotation, throttling.
 */

import dns from "node:dns";
import net from "node:net";
import { promisify } from "node:util";
import crypto from "node:crypto";
import type BetterSqlite3 from "better-sqlite3";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("email.deliverability");
const resolveTxt = promisify(dns.resolveTxt);
const resolveMx = promisify(dns.resolveMx);
const resolve4 = promisify(dns.resolve4);
const reverse = promisify(dns.reverse);

function genId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(6).toString("hex")}`;
}

// ═══════════════════════════════════════════════════════════════
// 1. SPF / DKIM / DMARC VALIDATION
// ═══════════════════════════════════════════════════════════════

export interface DnsAuthResult {
  domain: string;
  spf: { found: boolean; record: string | null; valid: boolean };
  dkim: { found: boolean; record: string | null; valid: boolean; selector: string };
  dmarc: { found: boolean; record: string | null; policy: string | null };
  mx: { found: boolean; records: string[] };
  overallScore: number; // 0-100
  issues: string[];
  checkedAt: string;
}

export async function checkDnsAuth(domain: string, dkimSelector = "default"): Promise<DnsAuthResult> {
  const issues: string[] = [];
  let score = 0;

  // SPF
  let spf = { found: false, record: null as string | null, valid: false };
  try {
    const txtRecords = await resolveTxt(domain);
    const spfRecord = txtRecords.flat().find((r) => r.startsWith("v=spf1"));
    if (spfRecord) {
      spf = { found: true, record: spfRecord, valid: true };
      score += 25;
    } else {
      issues.push("No SPF record found. Add a TXT record starting with 'v=spf1' to your domain DNS.");
    }
  } catch {
    issues.push("Could not query SPF records for this domain.");
  }

  // DKIM
  let dkim = { found: false, record: null as string | null, valid: false, selector: dkimSelector };
  try {
    const dkimDomain = `${dkimSelector}._domainkey.${domain}`;
    const txtRecords = await resolveTxt(dkimDomain);
    const dkimRecord = txtRecords.flat().find((r) => r.includes("v=DKIM1"));
    if (dkimRecord) {
      dkim = { found: true, record: dkimRecord.slice(0, 200), valid: true, selector: dkimSelector };
      score += 25;
    } else {
      // Try common selectors
      for (const sel of ["google", "selector1", "selector2", "s1", "s2", "mail", "k1"]) {
        try {
          const altRecords = await resolveTxt(`${sel}._domainkey.${domain}`);
          const altDkim = altRecords.flat().find((r) => r.includes("v=DKIM1"));
          if (altDkim) {
            dkim = { found: true, record: altDkim.slice(0, 200), valid: true, selector: sel };
            score += 25;
            break;
          }
        } catch { /* continue trying selectors */ }
      }
      if (!dkim.found) {
        issues.push("No DKIM record found. Configure DKIM signing with your email provider.");
      }
    }
  } catch {
    issues.push("Could not query DKIM records.");
  }

  // DMARC
  let dmarc = { found: false, record: null as string | null, policy: null as string | null };
  try {
    const dmarcRecords = await resolveTxt(`_dmarc.${domain}`);
    const dmarcRecord = dmarcRecords.flat().find((r) => r.startsWith("v=DMARC1"));
    if (dmarcRecord) {
      const policyMatch = dmarcRecord.match(/p=(\w+)/);
      dmarc = { found: true, record: dmarcRecord, policy: policyMatch?.[1] || null };
      score += 25;
      if (dmarc.policy === "none") {
        issues.push("DMARC policy is 'none' (monitoring only). Consider upgrading to 'quarantine' or 'reject'.");
      }
    } else {
      issues.push("No DMARC record found. Add _dmarc.yourdomain.com TXT record with 'v=DMARC1; p=quarantine'.");
    }
  } catch {
    issues.push("Could not query DMARC records.");
  }

  // MX
  let mx = { found: false, records: [] as string[] };
  try {
    const mxRecords = await resolveMx(domain);
    if (mxRecords && mxRecords.length > 0) {
      mx = { found: true, records: mxRecords.map((r) => `${r.exchange} (priority ${r.priority})`) };
      score += 25;
    } else {
      issues.push("No MX records found. This domain cannot receive email.");
    }
  } catch {
    issues.push("Could not query MX records.");
  }

  return {
    domain,
    spf,
    dkim,
    dmarc,
    mx,
    overallScore: score,
    issues,
    checkedAt: new Date().toISOString(),
  };
}

// ═══════════════════════════════════════════════════════════════
// 2. DOMAIN ROTATION (round-robin)
// ═══════════════════════════════════════════════════════════════

export function getNextSendingAccount(db: BetterSqlite3.Database): { id: string; email_address: string; name: string } | null {
  // Round-robin: pick the active account with lowest sent_today relative to daily_limit
  try {
    const account = db.prepare(`
      SELECT id, email_address, name, sent_today, daily_limit
      FROM email_accounts
      WHERE status = 'active' AND sent_today < daily_limit
      ORDER BY (CAST(sent_today AS REAL) / MAX(daily_limit, 1)) ASC, RANDOM()
      LIMIT 1
    `).get() as { id: string; email_address: string; name: string } | undefined;
    return account || null;
  } catch {
    return null;
  }
}

export function getDomainRotationStats(db: BetterSqlite3.Database): Array<{
  id: string; name: string; email_address: string; sent_today: number;
  daily_limit: number; utilization: number; status: string;
}> {
  try {
    const accounts = db.prepare(
      "SELECT id, name, email_address, sent_today, daily_limit, status FROM email_accounts WHERE status = 'active' ORDER BY sent_today ASC",
    ).all() as Array<{ id: string; name: string; email_address: string; sent_today: number; daily_limit: number; status: string }>;
    return accounts.map((a) => ({
      ...a,
      utilization: a.daily_limit > 0 ? Math.round((a.sent_today / a.daily_limit) * 100) : 0,
    }));
  } catch {
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════
// 3. THROTTLING WITH EXPONENTIAL BACKOFF
// ═══════════════════════════════════════════════════════════════

const retryDelays = [60, 300, 900, 3600]; // 1min, 5min, 15min, 1hr (in seconds)

export function scheduleRetry(
  db: BetterSqlite3.Database,
  queueId: string,
  retryCount: number,
): { scheduled: boolean; nextRetryAt: string | null; retriesLeft: number } {
  if (retryCount >= retryDelays.length) {
    return { scheduled: false, nextRetryAt: null, retriesLeft: 0 };
  }

  const delaySec = retryDelays[retryCount];
  const nextRetryAt = new Date(Date.now() + delaySec * 1000).toISOString();

  try {
    db.prepare("UPDATE email_send_queue SET status = 'queued', scheduled_at = ?, error = NULL WHERE id = ?")
      .run(nextRetryAt, queueId);
  } catch { /* ignore */ }

  return {
    scheduled: true,
    nextRetryAt,
    retriesLeft: retryDelays.length - retryCount - 1,
  };
}

// ═══════════════════════════════════════════════════════════════
// 4. EMAIL VALIDATION (SMTP RCPT TO + catch-all detection)
// ═══════════════════════════════════════════════════════════════

export async function verifyEmailAddress(email: string): Promise<{
  valid: boolean;
  exists: boolean | null; // null = couldn't determine
  catchAll: boolean;
  mxHost: string | null;
  error?: string;
}> {
  const domain = email.split("@")[1];
  if (!domain) return { valid: false, exists: null, catchAll: false, mxHost: null, error: "Invalid email format" };

  // Get MX records
  let mxHost: string | null = null;
  try {
    const mxRecords = await resolveMx(domain);
    if (!mxRecords || mxRecords.length === 0) {
      return { valid: false, exists: null, catchAll: false, mxHost: null, error: "No MX records" };
    }
    mxRecords.sort((a, b) => a.priority - b.priority);
    mxHost = mxRecords[0].exchange;
  } catch {
    return { valid: false, exists: null, catchAll: false, mxHost: null, error: "DNS lookup failed" };
  }

  // SMTP RCPT TO check
  try {
    const result = await smtpCheck(mxHost, email);

    // Catch-all detection: try a random address
    let catchAll = false;
    if (result.exists) {
      const randomAddr = `verify_${crypto.randomBytes(8).toString("hex")}@${domain}`;
      const catchAllResult = await smtpCheck(mxHost, randomAddr);
      catchAll = catchAllResult.exists === true;
    }

    return { valid: true, exists: result.exists, catchAll, mxHost };
  } catch (err: any) {
    return { valid: true, exists: null, catchAll: false, mxHost, error: `SMTP check failed: ${err.message}` };
  }
}

function smtpCheck(host: string, email: string): Promise<{ exists: boolean | null }> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      socket.destroy();
      resolve({ exists: null });
    }, 10000);

    const socket = net.createConnection(25, host);
    let step = 0;
    let responseData = "";

    socket.on("data", (data) => {
      responseData += data.toString();
      const code = parseInt(responseData.slice(0, 3), 10);

      if (step === 0 && code === 220) {
        socket.write(`EHLO verify.local\r\n`);
        step = 1;
        responseData = "";
      } else if (step === 1 && (code === 250 || code === 220)) {
        socket.write(`MAIL FROM:<verify@verify.local>\r\n`);
        step = 2;
        responseData = "";
      } else if (step === 2 && code === 250) {
        socket.write(`RCPT TO:<${email}>\r\n`);
        step = 3;
        responseData = "";
      } else if (step === 3) {
        socket.write("QUIT\r\n");
        clearTimeout(timeout);
        socket.destroy();
        resolve({ exists: code === 250 });
      }
    });

    socket.on("error", () => {
      clearTimeout(timeout);
      resolve({ exists: null });
    });

    socket.on("timeout", () => {
      clearTimeout(timeout);
      socket.destroy();
      resolve({ exists: null });
    });
  });
}

// ═══════════════════════════════════════════════════════════════
// 5. SENDING REPUTATION SCORE
// ═══════════════════════════════════════════════════════════════

export interface ReputationScore {
  domain: string;
  score: number; // 0-100
  totalSent: number;
  bounceRate: number;
  complaintRate: number;
  openRate: number;
  replyRate: number;
  suppressedCount: number;
  grade: "excellent" | "good" | "fair" | "poor" | "critical";
}

export function calculateReputationScore(db: BetterSqlite3.Database, senderDomain?: string): ReputationScore[] {
  try {
    // Get unique sender domains
    const accounts = db.prepare("SELECT DISTINCT email_address FROM email_accounts").all() as Array<{ email_address: string }>;
    const domains = [...new Set(accounts.map((a) => a.email_address.split("@")[1]).filter(Boolean))];

    if (senderDomain) {
      return domains.includes(senderDomain) ? [calcDomainReputation(db, senderDomain)] : [];
    }

    return domains.map((d) => calcDomainReputation(db, d));
  } catch {
    return [];
  }
}

function calcDomainReputation(db: BetterSqlite3.Database, domain: string): ReputationScore {
  const accountIds = (db.prepare("SELECT id FROM email_accounts WHERE email_address LIKE ?").all(`%@${domain}`) as Array<{ id: string }>).map((r) => r.id);

  if (accountIds.length === 0) {
    return { domain, score: 0, totalSent: 0, bounceRate: 0, complaintRate: 0, openRate: 0, replyRate: 0, suppressedCount: 0, grade: "critical" };
  }

  const placeholders = accountIds.map(() => "?").join(",");

  const sent = (db.prepare(`SELECT COUNT(*) as c FROM email_send_queue WHERE account_id IN (${placeholders}) AND status = 'sent'`).get(...accountIds) as { c: number })?.c || 0;
  const bounced = (db.prepare(`SELECT COUNT(*) as c FROM email_send_queue WHERE account_id IN (${placeholders}) AND status = 'failed' AND bounce_type = 'hard'`).get(...accountIds) as { c: number })?.c || 0;

  // Events from email_events
  const opened = (db.prepare("SELECT COUNT(*) as c FROM email_events WHERE event_type = 'opened'").get() as { c: number })?.c || 0;
  const replied = (db.prepare("SELECT COUNT(*) as c FROM email_events WHERE event_type = 'replied'").get() as { c: number })?.c || 0;
  const complained = (db.prepare("SELECT COUNT(*) as c FROM email_events WHERE event_type = 'complained'").get() as { c: number })?.c || 0;

  // Suppressed for this domain
  const suppressed = (db.prepare(`SELECT COUNT(*) as c FROM email_suppressions WHERE email LIKE ?`).get(`%@${domain}`) as { c: number })?.c || 0;

  const bounceRate = sent > 0 ? (bounced / sent) * 100 : 0;
  const complaintRate = sent > 0 ? (complained / sent) * 100 : 0;
  const openRate = sent > 0 ? (opened / sent) * 100 : 0;
  const replyRate = sent > 0 ? (replied / sent) * 100 : 0;

  // Score: start at 100, deduct for bad signals
  let score = 100;
  score -= bounceRate * 10; // Each 1% bounce = -10
  score -= complaintRate * 20; // Each 1% complaint = -20
  if (openRate < 10 && sent > 50) score -= 15; // Low opens
  if (sent < 10) score -= 20; // Too few sends to judge
  score = Math.max(0, Math.min(100, Math.round(score)));

  const grade: ReputationScore["grade"] = score >= 90 ? "excellent" : score >= 70 ? "good" : score >= 50 ? "fair" : score >= 30 ? "poor" : "critical";

  return { domain, score, totalSent: sent, bounceRate: Math.round(bounceRate * 10) / 10, complaintRate: Math.round(complaintRate * 10) / 10, openRate: Math.round(openRate * 10) / 10, replyRate: Math.round(replyRate * 10) / 10, suppressedCount: suppressed, grade };
}

// ═══════════════════════════════════════════════════════════════
// 6. BLACKLIST MONITORING (DNSBL)
// ═══════════════════════════════════════════════════════════════

const DNSBL_SERVERS = [
  { name: "Spamhaus ZEN", host: "zen.spamhaus.org" },
  { name: "Barracuda", host: "b.barracudacentral.org" },
  { name: "SpamCop", host: "bl.spamcop.net" },
  { name: "SORBS", host: "dnsbl.sorbs.net" },
  { name: "UCEPROTECT L1", host: "dnsbl-1.uceprotect.net" },
];

export interface BlacklistResult {
  ip: string;
  listed: boolean;
  listings: Array<{ name: string; host: string; listed: boolean }>;
  checkedAt: string;
}

export async function checkBlacklists(ipOrDomain: string): Promise<BlacklistResult> {
  // Resolve domain to IP if needed
  let ip = ipOrDomain;
  if (!net.isIP(ipOrDomain)) {
    try {
      const ips = await resolve4(ipOrDomain);
      ip = ips[0] || ipOrDomain;
    } catch {
      return { ip: ipOrDomain, listed: false, listings: [], checkedAt: new Date().toISOString() };
    }
  }

  // Reverse IP for DNSBL lookup
  const reversedIp = ip.split(".").reverse().join(".");
  const listings: BlacklistResult["listings"] = [];

  for (const bl of DNSBL_SERVERS) {
    const lookupHost = `${reversedIp}.${bl.host}`;
    try {
      await resolve4(lookupHost);
      listings.push({ name: bl.name, host: bl.host, listed: true });
    } catch {
      listings.push({ name: bl.name, host: bl.host, listed: false });
    }
  }

  return {
    ip,
    listed: listings.some((l) => l.listed),
    listings,
    checkedAt: new Date().toISOString(),
  };
}

// ═══════════════════════════════════════════════════════════════
// 7. SPAM SCORE CHECK (content-based)
// ═══════════════════════════════════════════════════════════════

const SPAM_KEYWORDS = [
  { pattern: /\bfree\b/gi, weight: 1, reason: "Contains 'free'" },
  { pattern: /\bguarantee[d]?\b/gi, weight: 2, reason: "Contains 'guarantee'" },
  { pattern: /\bact now\b/gi, weight: 3, reason: "Contains 'act now'" },
  { pattern: /\blimited time\b/gi, weight: 2, reason: "Contains 'limited time'" },
  { pattern: /\burgent\b/gi, weight: 2, reason: "Contains 'urgent'" },
  { pattern: /\bcongratulations\b/gi, weight: 3, reason: "Contains 'congratulations'" },
  { pattern: /\bclick here\b/gi, weight: 2, reason: "Contains 'click here'" },
  { pattern: /\bbuy now\b/gi, weight: 3, reason: "Contains 'buy now'" },
  { pattern: /\bdiscount\b/gi, weight: 1, reason: "Contains 'discount'" },
  { pattern: /\boffer expires\b/gi, weight: 2, reason: "Contains 'offer expires'" },
  { pattern: /\bno obligation\b/gi, weight: 2, reason: "Contains 'no obligation'" },
  { pattern: /\brisk.?free\b/gi, weight: 2, reason: "Contains 'risk free'" },
  { pattern: /\$\d+/g, weight: 1, reason: "Contains dollar amounts" },
  { pattern: /!!+/g, weight: 2, reason: "Multiple exclamation marks" },
  { pattern: /ALL\s+CAPS\s+WORDS/g, weight: 2, reason: "Excessive caps" },
];

export interface SpamScoreResult {
  score: number; // 0-100 (0=clean, 100=definitely spam)
  grade: "clean" | "low_risk" | "medium_risk" | "high_risk" | "spam";
  triggers: Array<{ reason: string; weight: number }>;
  recommendations: string[];
}

export function checkSpamScore(subject: string, body: string): SpamScoreResult {
  const fullText = `${subject} ${body}`;
  const triggers: Array<{ reason: string; weight: number }> = [];
  let totalWeight = 0;

  // Check spam keywords
  for (const kw of SPAM_KEYWORDS) {
    const matches = fullText.match(kw.pattern);
    if (matches && matches.length > 0) {
      triggers.push({ reason: kw.reason, weight: kw.weight });
      totalWeight += kw.weight * matches.length;
    }
  }

  // Check structural issues
  const plainText = body.replace(/<[^>]*>/g, "");
  const linkCount = (body.match(/<a\s/gi) || []).length + (body.match(/https?:\/\//gi) || []).length;
  const imageCount = (body.match(/<img/gi) || []).length;
  const textLength = plainText.length;

  if (linkCount > 5) { triggers.push({ reason: `Too many links (${linkCount})`, weight: 3 }); totalWeight += 3; }
  if (imageCount > 3 && textLength < 200) { triggers.push({ reason: "High image-to-text ratio", weight: 3 }); totalWeight += 3; }
  if (textLength < 50) { triggers.push({ reason: "Very short email body", weight: 2 }); totalWeight += 2; }
  if (subject.length > 100) { triggers.push({ reason: "Subject line too long", weight: 1 }); totalWeight += 1; }
  if (subject === subject.toUpperCase() && subject.length > 5) { triggers.push({ reason: "ALL CAPS subject line", weight: 4 }); totalWeight += 4; }

  // Normalize to 0-100
  const score = Math.min(100, Math.round(totalWeight * 5));
  const grade: SpamScoreResult["grade"] = score <= 10 ? "clean" : score <= 25 ? "low_risk" : score <= 50 ? "medium_risk" : score <= 75 ? "high_risk" : "spam";

  const recommendations: string[] = [];
  if (score > 25) recommendations.push("Remove spam trigger words");
  if (linkCount > 3) recommendations.push("Reduce number of links (max 2-3)");
  if (subject === subject.toUpperCase()) recommendations.push("Don't use ALL CAPS in subject");
  if (textLength < 100) recommendations.push("Add more text content");
  if (score <= 10) recommendations.push("Content looks clean. Good to send.");

  return { score, grade, triggers, recommendations };
}
