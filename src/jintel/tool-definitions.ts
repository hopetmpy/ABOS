// @ts-nocheck
/**
 * Jintel agent tools — ported from YojinHQ/yojin (`src/jintel/tools.ts`).
 *
 * Wraps a JintelClient for agent use. The client is built per-call from the
 * automaton's wallet via `createJintelClient` so x402 payments use the
 * existing treasury policy / spend cap path.
 *
 * Differences from upstream:
 *  - signal-ingestion is a no-op (the automaton has no SignalIngestor)
 *  - portfolio-snapshot tools (enrich_position, enrich_snapshot) are dropped
 *  - ToolDefinition / ToolResult are local minimal types — adapted to
 *    AutomatonTool by `src/jintel/agent-tools.ts`.
 */

import {
  type AnalystConsensus,
  type ArraySubGraphOptions,
  type ClinicalTrial,
  type ClinicalTrialFilterOptions,
  type DerivativesData,
  type EarningsPressRelease,
  type EconomicDataPoint,
  type EnrichOptions,
  type EnrichmentField,
  type Entity,
  type EntityType,
  EntityTypeSchema,
  type FactorDataPoint,
  type FamaFrenchSeries,
  FamaFrenchSeriesSchema,
  type FdaEvent,
  type FdaEventFilterOptions,
  type FdaEventType,
  type FilingType,
  GDP,
  type GdpType,
  GdpTypeSchema,
  type GovernmentContract,
  type GovernmentContractFilterOptions,
  type HackerNewsStory,
  INFLATION,
  INTEREST_RATES,
  type InsiderTrade,
  type InstitutionalHolding,
  JintelAuthError,
  type JintelClient,
  type JintelResult,
  type LitigationCase,
  type LitigationFilterOptions,
  MACRO_SERIES,
  MACRO_SERIES_BATCH,
  type MacroSeries,
  type MarketQuote,
  type NewsArticle,
  type OptionType,
  type OptionsChainSort,
  type OwnershipBreakdown,
  type PredictionMarket,
  type ResearchResult,
  type RiskSignal,
  type RiskSignalType,
  type SP500DataPoint,
  type SP500Series,
  SP500SeriesSchema,
  SP500_MULTIPLES,
  type SanctionsFilterOptions,
  type SanctionsMatch,
  type SegmentRevenue,
  type Severity,
  type ShortInterestReport,
  type Social,
  type SocialSentiment,
  type TickerPriceHistory,
  type TopHolder,
  type USMarketStatus,
  buildEnrichQuery,
} from '@yojinhq/jintel-client';
import { z } from 'zod';

import { formatAssetLabel } from './format-label.js';
import { isShortInterestFresh } from './freshness.js';
import type { FinancialStatements, KeyExecutive } from './jintel-types.js';

// Locally defined tool shape — adapted to AutomatonTool in agent-tools.ts.
export interface ToolResult {
  content: string;
  isError?: boolean;
}
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: z.ZodTypeAny;
  execute: (params: any) => Promise<ToolResult>;
}

// Reddit comments aren't first-class in the upstream Social sub-graph; the
// upstream Yojin code defines a local shape only used by signal mapping.
// We don't ingest signals here, so a minimal stub is enough to keep types happy.
interface RedditComment {
  id: string;
  subreddit: string;
  body: string;
  score: number;
  date?: string | null;
  parentId?: string;
}

function formatUsd(value: number): string {
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
}

// ── Options ──────────────────────────────────────────────────────────────

export interface JintelToolOptions {
  client?: JintelClient;
}

// ── Constants ────────────────────────────────────────────────────────────

const NOT_CONFIGURED_MSG =
  'Jintel client is not configured. The automaton needs an EVM wallet for x402 pay-per-query.';

const AUTH_ERROR_MSG =
  'Jintel rejected the request (401). Wallet authentication failed.';

const FALLBACK_SUFFIX = '';

const JINTEL_QUERY_KIND = z.enum([
  'quote',
  'market',
  'fundamentals',
  'history',
  'news',
  'research',
  'sentiment',
  'technicals',
  'derivatives',
  'risk',
  'regulatory',
  'short_interest',
  'financials',
  'executives',
  'institutional_holdings',
  'ownership',
  'top_holders',
  'insider_trades',
  'earnings_press_releases',
  'segmented_revenue',
  'earnings_calendar',
  'periodic_filing',
  'analyst_consensus',
  'market_status',
]);

type JintelQueryKind = z.infer<typeof JINTEL_QUERY_KIND>;

const ENRICHMENT_FIELDS = z.enum([
  'market',
  'risk',
  'regulatory',
  'technicals',
  'derivatives',
  'news',
  'research',
  'sentiment',
  'analyst',
  // Costly fields — only request when explicitly needed
  'social',
  'predictions',
  'discussions',
  'financials',
  'executives',
  'institutionalHoldings',
  'ownership',
  'topHolders',
  'insiderTrades',
  'earningsPressReleases',
  'segmentedRevenue',
  'earnings',
  'periodicFilings',
  'clinicalTrials',
  'fdaEvents',
  'litigation',
  'governmentContracts',
  'subsidiaries',
  'concentration',
  'relationships',
]);

// Local z.enum mirrors of jintel-client schemas (re-declared to avoid cross-package Zod version conflicts).
const OPTION_TYPE = z.enum(['CALL', 'PUT']);
const OPTIONS_CHAIN_SORT = z.enum([
  'EXPIRATION_ASC',
  'EXPIRATION_DESC',
  'STRIKE_ASC',
  'STRIKE_DESC',
  'VOLUME_DESC',
  'OPEN_INTEREST_DESC',
]);
const FILING_TYPE = z.enum(['FILING_10K', 'FILING_10Q', 'FILING_8K', 'ANNUAL_REPORT', 'OTHER']);
const SEVERITY = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
const RISK_SIGNAL_TYPE = z.enum(['SANCTIONS', 'LITIGATION', 'REGULATORY_ACTION', 'ADVERSE_MEDIA', 'PEP']);
const FDA_EVENT_TYPE = z.enum(['DRUG_ADVERSE', 'DEVICE_ADVERSE', 'DRUG_RECALL']);

// ── Helpers ──────────────────────────────────────────────────────────────

function notConfigured(): ToolResult {
  return { content: NOT_CONFIGURED_MSG, isError: true };
}

function authError(): ToolResult {
  return { content: AUTH_ERROR_MSG, isError: true };
}

function failureResult(error: string): ToolResult {
  return { content: error + FALLBACK_SUFFIX, isError: true };
}

type HandleResult<T> = { ok: true; data: T } | { ok: false; toolResult: ToolResult };

function handleResult<T>(result: JintelResult<T>): HandleResult<T> {
  if (!result.success) return { ok: false, toolResult: failureResult(result.error) };
  return { ok: true, data: result.data };
}

/** Wraps an async client call with typed error handling. */
async function safeCall<T>(
  fn: () => Promise<T>,
): Promise<{ ok: true; data: T } | { ok: false; toolResult: ToolResult }> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    if (err instanceof JintelAuthError) return { ok: false, toolResult: authError() };
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, toolResult: failureResult(msg) };
  }
}

/** Minimum severity required for SANCTIONS risk signals. Filters out fuzzy false positives. */
const MIN_SANCTIONS_SEVERITY: Set<string> = new Set(['HIGH', 'CRITICAL']);

/** Build ArraySubGraphOptions and the matching $filter variable from optional since/limit params. */
function buildFilter(since?: string, limit?: number): { opts: ArraySubGraphOptions; vars: Record<string, unknown> } {
  const opts: ArraySubGraphOptions = { sort: 'DESC', ...(since ? { since } : {}), ...(limit ? { limit } : {}) };
  const vars: Record<string, unknown> = { sort: 'DESC' };
  if (since) vars.since = since;
  if (limit) vars.limit = limit;
  return { opts, vars };
}


// ── Formatters ───────────────────────────────────────────────────────────

function formatEntities(entities: Entity[]): string {
  if (entities.length === 0) return 'No entities found.';
  return entities
    .map((e) => {
      const parts = [`- **${e.name}** (${e.type})`];
      if (e.tickers?.length) parts.push(`  Tickers: ${e.tickers.join(', ')}`);
      if (e.country) parts.push(`  Country: ${e.country}`);
      if (e.domain) parts.push(`  Domain: ${e.domain}`);
      return parts.join('\n');
    })
    .join('\n');
}

function formatEnrichment(entity: Entity): string {
  const sections: string[] = [`# ${entity.name} (${entity.type})`];

  if (entity.market) {
    const { quote, fundamentals } = entity.market;
    if (quote) {
      const dir = quote.change >= 0 ? '↑' : '↓';
      sections.push(
        `## Market\n${quote.ticker}: $${quote.price.toFixed(2)} ${dir} ${quote.changePercent.toFixed(2)}% | Vol: ${formatNumber(quote.volume)}`,
      );
    }
    if (fundamentals) {
      const lines: string[] = [];
      if (fundamentals.marketCap != null) lines.push(`Market Cap: $${formatNumber(fundamentals.marketCap)}`);
      if (fundamentals.peRatio != null) lines.push(`P/E: ${fundamentals.peRatio.toFixed(1)}`);
      if (fundamentals.eps != null) lines.push(`EPS: $${fundamentals.eps.toFixed(2)}`);
      if (fundamentals.sector) lines.push(`Sector: ${fundamentals.sector}`);
      if (lines.length) sections.push(`## Fundamentals\n${lines.join('\n')}`);
    }
  }

  if (entity.risk) {
    const { overallScore, signals } = entity.risk;
    // Filter out low-severity SANCTIONS (fuzzy false positives) from agent-facing output too
    const filtered = signals.filter((s) => !(s.type === 'SANCTIONS' && !MIN_SANCTIONS_SEVERITY.has(s.severity)));
    if (filtered.length) {
      const signalLines = filtered.map((s) => `- [${s.severity}] ${s.type}: ${s.description}`);
      sections.push(`## Risk (score: ${overallScore})\n${signalLines.join('\n')}`);
    }
  }

  if (entity.regulatory) {
    const parts: string[] = [];
    if (entity.regulatory.sanctions.length) {
      parts.push(`Sanctions matches: ${entity.regulatory.sanctions.length}`);
    }
    if (entity.regulatory.filings.length) {
      const filingLines = entity.regulatory.filings.map((f) => `- ${f.type} (${f.date})`);
      parts.push(`Filings:\n${filingLines.join('\n')}`);
    }
    if (parts.length) sections.push(`## Regulatory\n${parts.join('\n')}`);
  }

  if (entity.technicals) {
    const t = entity.technicals;
    const lines: string[] = [];
    if (t.rsi != null) lines.push(`RSI(14): ${t.rsi.toFixed(1)}`);
    if (t.macd)
      lines.push(
        `MACD: ${t.macd.macd.toFixed(3)} | Signal: ${t.macd.signal.toFixed(3)} | Histogram: ${t.macd.histogram.toFixed(3)}`,
      );
    if (t.bollingerBands)
      lines.push(
        `Bollinger Bands: Lower ${t.bollingerBands.lower.toFixed(2)} | Middle ${t.bollingerBands.middle.toFixed(2)} | Upper ${t.bollingerBands.upper.toFixed(2)}`,
      );
    if (t.ema != null) lines.push(`EMA(10): ${t.ema.toFixed(2)}`);
    if (t.ema50 != null) lines.push(`EMA(50): ${t.ema50.toFixed(2)}`);
    if (t.ema200 != null) lines.push(`EMA(200): ${t.ema200.toFixed(2)}`);
    if (t.sma != null) lines.push(`SMA(50): ${t.sma.toFixed(2)}`);
    if (t.sma20 != null) lines.push(`SMA(20): ${t.sma20.toFixed(2)}`);
    if (t.sma200 != null) lines.push(`SMA(200): ${t.sma200.toFixed(2)}`);
    if (t.wma52 != null) lines.push(`52-WMA: ${t.wma52.toFixed(2)}`);
    if (t.atr != null) lines.push(`ATR(14): ${t.atr.toFixed(2)}`);
    if (t.vwma != null) lines.push(`VWMA(20): ${t.vwma.toFixed(2)}`);
    if (t.vwap != null) lines.push(`VWAP: ${t.vwap.toFixed(2)}`);
    if (t.mfi != null) lines.push(`MFI(14): ${t.mfi.toFixed(1)}`);
    if (t.adx != null) lines.push(`ADX: ${t.adx.toFixed(1)}`);
    if (t.stochastic) lines.push(`Stochastic: %K ${t.stochastic.k.toFixed(1)} | %D ${t.stochastic.d.toFixed(1)}`);
    if (t.obv != null) lines.push(`OBV: ${t.obv.toLocaleString()}`);
    if (t.parabolicSar != null) lines.push(`Parabolic SAR: ${t.parabolicSar.toFixed(2)}`);
    if (t.bollingerBandsWidth != null) lines.push(`BB Width: ${t.bollingerBandsWidth.toFixed(4)}`);
    if (t.williamsR != null) lines.push(`Williams %R: ${t.williamsR.toFixed(1)}`);
    if (t.crossovers) {
      const cx = t.crossovers;
      if (cx.goldenCross) lines.push(`⚠ Golden Cross (SMA 50 > SMA 200)`);
      if (cx.deathCross) lines.push(`⚠ Death Cross (SMA 50 < SMA 200)`);
      if (cx.emaCross) lines.push(`EMA Cross: EMA(50) > EMA(200) (bullish)`);
      else if (t.ema50 != null && t.ema200 != null) lines.push(`EMA Cross: EMA(50) < EMA(200) (bearish)`);
    }
    if (lines.length) sections.push(`## Technicals\n${lines.join('\n')}`);
  }

  if (entity.news?.length) {
    const newsLines = entity.news.map((n) => `- [${n.source}] ${n.title} (${n.date})${n.link ? `\n  ${n.link}` : ''}`);
    sections.push(`## News\n${newsLines.join('\n')}`);
  }

  if (entity.research?.length) {
    const resLines = entity.research.map(
      (r) =>
        `- ${r.title}${r.author ? ` — ${r.author}` : ''}${r.publishedDate ? ` (${r.publishedDate})` : ''}${r.url ? `\n  ${r.url}` : ''}`,
    );
    sections.push(`## Research\n${resLines.join('\n')}`);
  }

  if (entity.sentiment) {
    const s = entity.sentiment;
    const rankDelta = s.rank24hAgo - s.rank;
    const rankDir = rankDelta > 0 ? `↑${rankDelta}` : rankDelta < 0 ? `↓${Math.abs(rankDelta)}` : '→';
    const mentionDelta = s.mentions - s.mentions24hAgo;
    const mentionDir = mentionDelta > 0 ? `+${mentionDelta}` : `${mentionDelta}`;
    sections.push(
      `## Social Sentiment\nRank: #${s.rank} (${rankDir} in 24h) | Mentions: ${s.mentions} (${mentionDir}) | Upvotes: ${s.upvotes}`,
    );
  }

  if (entity.market?.keyEvents?.length) {
    const lines = entity.market.keyEvents.map(
      (e) =>
        `- [${e.type}] ${e.date}: ${e.description} (${e.changePercent >= 0 ? '+' : ''}${e.changePercent.toFixed(1)}%, close $${e.close.toFixed(2)})`,
    );
    sections.push(`## Key Price Events\n${lines.join('\n')}`);
  }

  if (entity.market?.shortInterest?.length) {
    const si = entity.market.shortInterest[0];
    const parts: string[] = [];
    if (si.shortInterest != null) parts.push(`Shares short: ${formatNumber(si.shortInterest)}`);
    if (si.daysToCover != null) parts.push(`Days to cover: ${si.daysToCover.toFixed(1)}`);
    if (si.change != null) parts.push(`Change: ${si.change >= 0 ? '+' : ''}${formatNumber(si.change)}`);
    if (parts.length) sections.push(`## Short Interest (${si.reportDate})\n${parts.join(' | ')}`);
  }

  if (entity.social) {
    sections.push(`## Social Posts\n${formatSocial(entity.social)}`);
  }

  if (entity.predictions?.length) {
    sections.push(`## Prediction Markets\n${formatPredictions(entity.predictions)}`);
  }

  if (entity.discussions?.length) {
    sections.push(`## Discussions\n${formatDiscussions(entity.discussions)}`);
  }

  if (entity.institutionalHoldings?.length) {
    sections.push(`## Institutional Holdings (13F)\n${formatInstitutionalHoldings(entity.institutionalHoldings)}`);
  }

  if (entity.ownership) {
    sections.push(`## Ownership Breakdown\n${formatOwnership(entity.ownership)}`);
  }

  if (entity.topHolders?.length) {
    sections.push(`## Top Institutional Holders\n${formatTopHolders(entity.topHolders)}`);
  }

  if (entity.insiderTrades?.length) {
    sections.push(`## Insider Trades (Form 4)\n${formatInsiderTrades(entity.insiderTrades)}`);
  }

  if (entity.earningsPressReleases?.length) {
    sections.push(`## Earnings Press Releases (8-K)\n${formatEarningsPressReleases(entity.earningsPressReleases)}`);
  }

  if (entity.segmentedRevenue?.length) {
    sections.push(`## Segmented Revenue\n${formatSegmentedRevenue(entity.segmentedRevenue)}`);
  }

  if (entity.earnings?.length) {
    sections.push(`## Earnings Calendar\n${formatEarningsCalendar(entity.earnings)}`);
  }

  if (entity.periodicFilings?.length) {
    sections.push(`## Periodic Filings (10-K / 10-Q)\n${formatPeriodicFilings(entity.periodicFilings)}`);
  }

  // financials & executives are planned jintel-client fields (not yet in Entity type).
  // Access via cast until the client ships these as first-class enrichment fields.
  const ext = entity as Entity & { financials?: FinancialStatements; executives?: KeyExecutive[] };
  if (ext.financials) {
    sections.push(`## Financial Statements\n${formatFinancials(ext.financials)}`);
  }

  if (ext.executives?.length) {
    sections.push(`## Key Executives\n${formatExecutives(ext.executives)}`);
  }

  return sections.join('\n\n');
}

function formatQuotes(quotes: MarketQuote[]): string {
  if (quotes.length === 0) return 'No quotes available.';
  return quotes
    .map((q) => {
      const dir = q.change >= 0 ? '↑' : '↓';
      return `${q.ticker}: $${q.price.toFixed(2)} ${dir} ${q.changePercent.toFixed(2)}% | Vol: ${formatNumber(q.volume)}`;
    })
    .join('\n');
}

function formatSanctions(matches: SanctionsMatch[]): string {
  if (matches.length === 0) return 'No sanctions matches found.';
  return matches
    .map(
      (m) =>
        `⚠ WARNING: Match on **${m.listName}**\n  Matched name: ${m.matchedName} (score: ${m.score.toFixed(2)})${m.details ? `\n  ${m.details}` : ''}`,
    )
    .join('\n\n');
}

/** Macro queries are standalone constants — sort defensively to ensure newest-first. */
function formatEconomicData(data: EconomicDataPoint[], label: string): string {
  if (data.length === 0) return `No ${label} data available.`;
  const sorted = [...data].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const recent = sorted.slice(0, 20);
  const lines = recent.map(
    (d) => `${d.date}: ${d.value != null ? d.value.toFixed(2) : 'N/A'}${d.country ? ` (${d.country})` : ''}`,
  );
  return `# ${label}\n${lines.join('\n')}${sorted.length > 20 ? `\n\n... and ${sorted.length - 20} more data points` : ''}`;
}

/** Macro queries are standalone constants — sort defensively to ensure newest-first. */
function formatSP500Data(data: SP500DataPoint[]): string {
  if (data.length === 0) return 'No S&P 500 data available.';
  const sorted = [...data].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const recent = sorted.slice(0, 20);
  const lines = recent.map((d) => `${d.date}: ${d.value.toFixed(2)}`);
  return `# S&P 500 — ${sorted[0]?.name ?? 'Multiples'}\n${lines.join('\n')}${sorted.length > 20 ? `\n\n... and ${sorted.length - 20} more data points` : ''}`;
}

function formatPriceHistory(data: TickerPriceHistory[]): string {
  if (data.length === 0) return 'No price history available.';
  return data
    .map((th) => {
      if (th.history.length === 0) return `## ${th.ticker}\nNo data points.`;
      const lines = th.history.map(
        (h) =>
          `${h.date} | O:${h.open.toFixed(2)} H:${h.high.toFixed(2)} L:${h.low.toFixed(2)} C:${h.close.toFixed(2)} V:${formatNumber(h.volume)}`,
      );
      const first = th.history[0];
      const last = th.history[th.history.length - 1];
      const changePct = first.close !== 0 ? ((last.close - first.close) / first.close) * 100 : 0;
      const dir = changePct >= 0 ? '↑' : '↓';
      return (
        `## ${th.ticker} (${th.history.length} candles)\n` +
        `Period change: ${dir} ${changePct.toFixed(2)}% ($${first.close.toFixed(2)} → $${last.close.toFixed(2)})\n\n` +
        lines.join('\n')
      );
    })
    .join('\n\n');
}

function formatNews(articles: NewsArticle[]): string {
  if (articles.length === 0) return 'No news articles found.';
  return articles
    .map((a) => {
      const parts = [`- **${a.title}**`];
      parts.push(`  Source: ${a.source}${a.date ? ` | ${a.date}` : ''}`);
      if (a.snippet) parts.push(`  ${a.snippet}`);
      if (a.link) parts.push(`  ${a.link}`);
      return parts.join('\n');
    })
    .join('\n');
}

function formatResearch(reports: ResearchResult[]): string {
  if (reports.length === 0) return 'No research reports found.';
  return reports
    .map((r) => {
      const parts = [`- **${r.title}**${r.score ? ` (relevance: ${r.score.toFixed(2)})` : ''}`];
      if (r.author || r.publishedDate) {
        parts.push(`  ${[r.author, r.publishedDate].filter(Boolean).join(' — ')}`);
      }
      if (r.text) {
        const preview = r.text.length > 300 ? r.text.slice(0, 297) + '…' : r.text;
        parts.push(`  ${preview}`);
      }
      if (r.url) parts.push(`  ${r.url}`);
      return parts.join('\n');
    })
    .join('\n');
}

function formatSentiment(s: SocialSentiment): string {
  const rankDelta = s.rank24hAgo - s.rank;
  const rankDir = rankDelta > 0 ? `↑${rankDelta}` : rankDelta < 0 ? `↓${Math.abs(rankDelta)}` : '→';
  const mentionDelta = s.mentions - s.mentions24hAgo;
  const mentionDir = mentionDelta > 0 ? `+${mentionDelta}` : `${mentionDelta}`;

  const lines = [
    `# ${formatAssetLabel(s.name, s.ticker)} — Social Sentiment`,
    `Rank: #${s.rank} (${rankDir} in 24h)`,
    `Mentions: ${s.mentions} (${mentionDir} in 24h)`,
    `Upvotes: ${s.upvotes}`,
  ];

  // Momentum interpretation
  if (rankDelta > 5) lines.push('\n📈 Strong upward momentum — rapidly gaining social attention');
  else if (rankDelta > 0) lines.push('\n📈 Positive momentum — gaining social attention');
  else if (rankDelta < -5) lines.push('\n📉 Declining momentum — losing social attention');
  else if (rankDelta < 0) lines.push('\n📉 Slight decline in social attention');

  return lines.join('\n');
}

function formatShortInterest(reports: ShortInterestReport[]): string {
  if (reports.length === 0) return 'No short interest data available.';
  return reports
    .map((r) => {
      const parts = [`${r.ticker} (${r.reportDate})`];
      if (r.shortInterest != null) parts.push(`Shares short: ${formatNumber(r.shortInterest)}`);
      if (r.daysToCover != null) parts.push(`Days to cover: ${r.daysToCover.toFixed(1)}`);
      if (r.change != null) parts.push(`Change: ${r.change >= 0 ? '+' : ''}${formatNumber(r.change)}`);
      return parts.join(' | ');
    })
    .join('\n');
}

function formatInstitutionalHoldings(holdings: InstitutionalHolding[]): string {
  if (holdings.length === 0) return 'No institutional holdings data available.';
  return holdings
    .map((h) => {
      const parts = [`${h.issuerName} (${h.titleOfClass})`];
      parts.push(`CUSIP: ${h.cusip}`);
      parts.push(`Value: $${formatNumber(h.value * 1000)}`);
      parts.push(`Shares: ${formatNumber(h.shares)}`);
      parts.push(`Discretion: ${h.investmentDiscretion}`);
      parts.push(`Report: ${h.reportDate} | Filed: ${h.filingDate}`);
      return parts.join(' | ');
    })
    .join('\n');
}

function formatOwnership(o: OwnershipBreakdown): string {
  const lines: string[] = [`Symbol: ${o.symbol}`];
  if (o.insiderOwnership != null) lines.push(`Insider ownership: ${(o.insiderOwnership * 100).toFixed(2)}%`);
  if (o.institutionOwnership != null)
    lines.push(`Institution ownership: ${(o.institutionOwnership * 100).toFixed(2)}%`);
  if (o.institutionFloatOwnership != null)
    lines.push(`Institution float ownership: ${(o.institutionFloatOwnership * 100).toFixed(2)}%`);
  if (o.institutionsCount != null) lines.push(`Institutions: ${o.institutionsCount}`);
  if (o.outstandingShares != null) lines.push(`Outstanding shares: ${formatNumber(o.outstandingShares)}`);
  if (o.floatShares != null) lines.push(`Float shares: ${formatNumber(o.floatShares)}`);
  if (isShortInterestFresh(o.shortInterestDate)) {
    const asOf = ` (as of ${o.shortInterestDate})`;
    if (o.shortInterest != null) lines.push(`Short interest: ${formatNumber(o.shortInterest)}${asOf}`);
    if (o.shortPercentOfFloat != null)
      lines.push(`Short % of float: ${(o.shortPercentOfFloat * 100).toFixed(2)}%${asOf}`);
    if (o.daysToCover != null) lines.push(`Days to cover: ${o.daysToCover.toFixed(1)}${asOf}`);
    if (o.shortInterestPrevMonth != null)
      lines.push(`Short interest prev month: ${formatNumber(o.shortInterestPrevMonth)}${asOf}`);
  }
  return lines.join('\n');
}

function formatTopHolders(holders: TopHolder[]): string {
  if (holders.length === 0) return 'No top holders data available.';
  return holders
    .map((h) => {
      const parts = [h.filerName];
      parts.push(`CIK: ${h.cik}`);
      parts.push(`Value: $${formatNumber(h.value * 1000)}`);
      parts.push(`Shares: ${formatNumber(h.shares)}`);
      parts.push(`Report: ${h.reportDate} | Filed: ${h.filingDate}`);
      return parts.join(' | ');
    })
    .join('\n');
}

function formatInsiderTrades(trades: InsiderTrade[]): string {
  if (trades.length === 0) return 'No insider trades available.';
  return trades
    .map((t) => {
      const action =
        t.acquiredDisposed === 'A' ? 'ACQUIRED' : t.acquiredDisposed === 'D' ? 'DISPOSED' : t.acquiredDisposed;
      const role =
        [t.isOfficer ? 'Officer' : null, t.isDirector ? 'Director' : null, t.isTenPercentOwner ? '10% Owner' : null]
          .filter(Boolean)
          .join(', ') || 'Insider';
      const parts = [`${t.transactionDate} ${action} ${formatNumber(t.shares)} × ${t.securityTitle}`];
      if (t.pricePerShare != null) parts.push(`@$${t.pricePerShare.toFixed(2)}`);
      if (t.transactionValue != null) parts.push(`value $${formatNumber(t.transactionValue)}`);
      parts.push(`by ${t.reporterName} (${role}${t.officerTitle ? ` — ${t.officerTitle}` : ''})`);
      parts.push(`code ${t.transactionCode}`);
      if (t.isUnder10b5One) parts.push('10b5-1 plan');
      if (t.isDerivative) parts.push('derivative');
      parts.push(`ownership ${t.ownershipType === 'D' ? 'direct' : 'indirect'}`);
      parts.push(`after: ${formatNumber(t.sharesOwnedFollowingTransaction)} shares`);
      return `- ${parts.join(' | ')}\n  Filed ${t.filingDate} — ${t.filingUrl}`;
    })
    .join('\n');
}

function formatEarningsPressReleases(releases: EarningsPressRelease[]): string {
  if (releases.length === 0) return 'No earnings press releases available.';
  return releases
    .map((r) => {
      const parts = [`- Report ${r.reportDate} (filed ${r.filingDate}, items ${r.items})`];
      if (r.excerpt) parts.push(`  ${r.excerpt}`);
      parts.push(`  Body length: ${formatNumber(r.bodyLength)} chars`);
      if (r.pressReleaseUrl) parts.push(`  Press release: ${r.pressReleaseUrl}`);
      parts.push(`  Filing: ${r.filingUrl}`);
      return parts.join('\n');
    })
    .join('\n');
}

function formatSegmentedRevenue(rows: SegmentRevenue[]): string {
  if (rows.length === 0) return 'No segmented revenue data available.';
  const byDimension = new Map<string, SegmentRevenue[]>();
  for (const row of rows) {
    const key = `${row.dimension} — ${row.reportDate} (${row.form})`;
    const bucket = byDimension.get(key) ?? [];
    bucket.push(row);
    byDimension.set(key, bucket);
  }
  const sections: string[] = [];
  for (const [key, bucket] of byDimension) {
    const sorted = [...bucket].sort((a, b) => b.value - a.value);
    const lines = sorted.map((s) => {
      const period = s.startDate && s.endDate ? `${s.startDate}→${s.endDate}` : s.reportDate;
      return `  ${s.segment}: $${formatNumber(s.value)} (${period})`;
    });
    sections.push(`### ${key}\n${lines.join('\n')}`);
  }
  return sections.join('\n\n');
}

function formatClinicalTrials(trials: ClinicalTrial[]): string {
  if (trials.length === 0) return 'No clinical trials found.';
  return trials
    .map((t) => {
      const header = `- **${t.title}** (${t.nctId})`;
      const meta: string[] = [];
      if (t.phase) meta.push(`Phase: ${t.phase}`);
      if (t.status) meta.push(`Status: ${t.status}`);
      if (t.startDate) meta.push(`Start: ${t.startDate}`);
      if (t.completionDate) meta.push(`Completion: ${t.completionDate}`);
      if (t.enrollment != null) meta.push(`Enrollment: ${formatNumber(t.enrollment)}`);
      const parts = [header];
      if (meta.length) parts.push(`  ${meta.join(' | ')}`);
      if (t.sponsor) parts.push(`  Sponsor: ${t.sponsor}`);
      if (t.conditions.length) parts.push(`  Conditions: ${t.conditions.join(', ')}`);
      if (t.interventions.length) parts.push(`  Interventions: ${t.interventions.join(', ')}`);
      parts.push(`  https://clinicaltrials.gov/study/${t.nctId}`);
      return parts.join('\n');
    })
    .join('\n');
}

function formatFdaEvents(events: FdaEvent[]): string {
  if (events.length === 0) return 'No FDA events found.';
  return events
    .map((e) => {
      const header = `- [${e.type}]${e.severity ? ` (${e.severity})` : ''}${e.reportDate ? ` — ${e.reportDate}` : ''}`;
      const parts = [header];
      if (e.product) parts.push(`  Product: ${e.product}`);
      if (e.summary) parts.push(`  ${e.summary}`);
      parts.push(`  ID: ${e.id}`);
      return parts.join('\n');
    })
    .join('\n');
}

function formatLitigation(cases: LitigationCase[]): string {
  if (cases.length === 0) return 'No litigation cases found.';
  return cases
    .map((c) => {
      const active = c.dateTerminated ? 'closed' : 'active';
      const dates = [c.dateFiled && `filed ${c.dateFiled}`, c.dateTerminated && `terminated ${c.dateTerminated}`]
        .filter(Boolean)
        .join(', ');
      const parts = [`- **${c.caseName}** (${active})`];
      const meta: string[] = [];
      if (c.docketNumber) meta.push(`Docket: ${c.docketNumber}`);
      if (c.court) meta.push(`Court: ${c.court}`);
      if (dates) meta.push(dates);
      if (meta.length) parts.push(`  ${meta.join(' | ')}`);
      if (c.natureOfSuit) parts.push(`  Nature: ${c.natureOfSuit}`);
      if (c.absoluteUrl) parts.push(`  ${c.absoluteUrl}`);
      return parts.join('\n');
    })
    .join('\n');
}

function formatGovernmentContracts(contracts: GovernmentContract[]): string {
  if (contracts.length === 0) return 'No government contracts found.';
  const total = contracts.reduce((sum, c) => sum + (c.amount ?? 0), 0);
  const lines = contracts.map((c) => {
    const parts = [`- ${c.awardId} — ${c.recipient}`];
    const meta: string[] = [];
    if (c.amount != null) meta.push(formatUsd(c.amount));
    if (c.actionDate) meta.push(c.actionDate);
    if (c.agency) meta.push(c.agency);
    if (c.awardType) meta.push(c.awardType);
    if (meta.length) parts.push(`  ${meta.join(' | ')}`);
    if (c.description) parts.push(`  ${c.description}`);
    return parts.join('\n');
  });
  const header = `Total across ${contracts.length} award${contracts.length === 1 ? '' : 's'}: ${formatUsd(total)}`;
  return `${header}\n\n${lines.join('\n')}`;
}

function formatMacroSeries(series: MacroSeries): string {
  const headerParts: string[] = [`# Macro Series — ${series.title ?? series.id} (${series.id})`];
  const meta: string[] = [];
  if (series.units) meta.push(`Units: ${series.units}`);
  if (series.frequency) meta.push(`Frequency: ${series.frequency}`);
  if (series.lastUpdated) meta.push(`Last updated: ${series.lastUpdated}`);
  if (meta.length) headerParts.push(meta.join(' | '));

  const observations = series.observations ?? [];
  if (observations.length === 0) {
    headerParts.push('No observations returned.');
    return headerParts.join('\n');
  }
  const sorted = [...observations].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const recent = sorted.slice(0, 20);
  const lines = recent.map((o) => `${o.date}: ${o.value != null ? o.value.toFixed(4) : 'N/A'}`);
  headerParts.push(lines.join('\n'));
  if (sorted.length > 20) headerParts.push(`\n... and ${sorted.length - 20} more observations`);
  return headerParts.join('\n');
}

type EarningsReport = NonNullable<Entity['earnings']>[number];
type PeriodicFiling = NonNullable<Entity['periodicFilings']>[number];

function formatEarningsCalendar(reports: EarningsReport[]): string {
  if (reports.length === 0) return 'No earnings reports available.';
  const sorted = [...reports].sort((a, b) => (a.reportDate < b.reportDate ? 1 : -1));
  return sorted
    .map((r) => {
      const quarter = r.quarter && r.year ? `Q${r.quarter} ${r.year}` : r.period;
      const parts = [`- ${r.reportDate} — ${quarter}`];
      if (r.hour) parts.push(`(${r.hour.toUpperCase()})`);
      const metrics: string[] = [];
      if (r.epsActual != null && r.epsEstimate != null) {
        const surprise =
          r.surprisePercent != null ? ` (${r.surprisePercent >= 0 ? '+' : ''}${r.surprisePercent.toFixed(1)}%)` : '';
        metrics.push(`EPS $${r.epsActual.toFixed(2)} vs est $${r.epsEstimate.toFixed(2)}${surprise}`);
      } else if (r.epsEstimate != null) {
        metrics.push(`EPS est $${r.epsEstimate.toFixed(2)} (not yet reported)`);
      }
      if (r.revenueActual != null && r.revenueEstimate != null) {
        const surprise =
          r.revenueSurprisePercent != null
            ? ` (${r.revenueSurprisePercent >= 0 ? '+' : ''}${r.revenueSurprisePercent.toFixed(1)}%)`
            : '';
        metrics.push(`Rev $${formatNumber(r.revenueActual)} vs est $${formatNumber(r.revenueEstimate)}${surprise}`);
      } else if (r.revenueEstimate != null) {
        metrics.push(`Rev est $${formatNumber(r.revenueEstimate)}`);
      }
      return metrics.length ? `${parts.join(' ')}\n  ${metrics.join(' | ')}` : parts.join(' ');
    })
    .join('\n');
}

function formatPeriodicFilings(filings: PeriodicFiling[], itemFilter?: string[], fullBody?: boolean): string {
  if (filings.length === 0) return 'No periodic filings available.';
  const wantedItems = itemFilter?.length ? new Set(itemFilter.map((i) => i.toUpperCase())) : null;
  return filings
    .map((f) => {
      const header = `## ${f.form} — filed ${f.filingDate} (report ${f.reportDate})`;
      const sectionsFiltered = wantedItems
        ? f.sections.filter((s) => wantedItems.has(s.item.toUpperCase()))
        : f.sections;
      if (sectionsFiltered.length === 0) {
        return `${header}\n  No matching sections.\n  ${f.filingUrl}`;
      }
      const sectionBlocks = sectionsFiltered.map((s) => {
        const body = fullBody ? s.body : s.excerpt;
        return `### Item ${s.item} — ${s.title} (${formatNumber(s.bodyLength)} chars)\n${body}`;
      });
      return `${header}\n${sectionBlocks.join('\n\n')}\n\n  Filing: ${f.filingUrl}\n  Document: ${f.documentUrl}`;
    })
    .join('\n\n---\n\n');
}

function formatFactorData(data: FactorDataPoint[], series: string): string {
  if (data.length === 0) return 'No factor data available.';
  const sorted = [...data].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const recent = sorted.slice(0, 20);
  const lines = recent.map((d) => {
    const parts = [d.date];
    if (d.mktRf != null) parts.push(`Mkt-RF: ${(d.mktRf * 100).toFixed(3)}%`);
    if (d.smb != null) parts.push(`SMB: ${(d.smb * 100).toFixed(3)}%`);
    if (d.hml != null) parts.push(`HML: ${(d.hml * 100).toFixed(3)}%`);
    if (d.rmw != null) parts.push(`RMW: ${(d.rmw * 100).toFixed(3)}%`);
    if (d.cma != null) parts.push(`CMA: ${(d.cma * 100).toFixed(3)}%`);
    if (d.rf != null) parts.push(`RF: ${(d.rf * 100).toFixed(3)}%`);
    return parts.join(' | ');
  });
  return `# Fama-French Factors — ${series}\n${lines.join('\n')}${sorted.length > 20 ? `\n\n... and ${sorted.length - 20} more data points` : ''}`;
}

function formatSocial(s: Social): string {
  const sections: string[] = [];
  if (s.reddit?.length) {
    const lines = s.reddit.map(
      (r) =>
        `r/${r.subreddit} — ${r.title}\n  Score: ${r.score} | ${r.numComments} comments${r.url ? `\n  ${r.url}` : ''}`,
    );
    sections.push(`### Reddit (${s.reddit.length})\n${lines.join('\n')}`);
  }
  // redditComments is a planned jintel-client field (not yet in Social type).
  const extSocial = s as Social & { redditComments?: RedditComment[] };
  if (extSocial.redditComments?.length) {
    const lines = extSocial.redditComments.map(
      (c) => `r/${c.subreddit} — ${c.body.slice(0, 200)}${c.body.length > 200 ? '…' : ''}\n  Score: ${c.score}`,
    );
    sections.push(`### Reddit Comments (${extSocial.redditComments.length})\n${lines.join('\n')}`);
  }
  return sections.length > 0 ? sections.join('\n\n') : 'No social posts found.';
}

function formatFinancials(f: FinancialStatements): string {
  const inc = f.income[0];
  const bs = f.balanceSheet[0];
  const cf = f.cashFlow[0];
  const periodSrc = inc ?? bs ?? cf;
  if (!periodSrc) return 'No financial statement data available.';
  const lines: string[] = [];
  const period = periodSrc.periodType
    ? `${periodSrc.periodType} ending ${periodSrc.periodEnding}`
    : periodSrc.periodEnding;
  lines.push(`Period: ${period}`);
  // Income statement
  if (inc?.totalRevenue != null) lines.push(`Revenue: $${formatNumber(inc.totalRevenue)}`);
  if (inc?.grossProfit != null) lines.push(`Gross Profit: $${formatNumber(inc.grossProfit)}`);
  if (inc?.operatingIncome != null) lines.push(`Operating Income: $${formatNumber(inc.operatingIncome)}`);
  if (inc?.ebitda != null) lines.push(`EBITDA: $${formatNumber(inc.ebitda)}`);
  if (inc?.netIncome != null) lines.push(`Net Income: $${formatNumber(inc.netIncome)}`);
  if (inc?.dilutedEps != null) lines.push(`Diluted EPS: $${inc.dilutedEps.toFixed(2)}`);
  // Cash flow
  if (cf?.freeCashFlow != null) lines.push(`Free Cash Flow: $${formatNumber(cf.freeCashFlow)}`);
  if (cf?.operatingCashFlow != null) lines.push(`Operating Cash Flow: $${formatNumber(cf.operatingCashFlow)}`);
  // Balance sheet
  if (bs?.totalDebt != null) lines.push(`Total Debt: $${formatNumber(bs.totalDebt)}`);
  if (bs?.cashAndEquivalents != null) lines.push(`Cash & Equivalents: $${formatNumber(bs.cashAndEquivalents)}`);
  if (bs?.totalEquity != null) lines.push(`Total Equity: $${formatNumber(bs.totalEquity)}`);
  return lines.join('\n');
}

function formatExecutives(executives: KeyExecutive[]): string {
  if (executives.length === 0) return 'No executive data available.';
  return executives
    .map((e) => {
      let line = `${e.title}: ${e.name}`;
      if (e.age != null) line += ` (age ${e.age})`;
      if (e.pay != null) line += ` | pay: $${formatNumber(e.pay)}`;
      return line;
    })
    .join('\n');
}

function formatAnalystConsensus(a: AnalystConsensus, currentPrice?: number): string {
  const lines: string[] = [];
  if (a.recommendation) {
    const mean =
      a.recommendationMean != null ? ` (mean ${a.recommendationMean.toFixed(2)}/5, lower = more bullish)` : '';
    lines.push(`Recommendation: ${a.recommendation}${mean}`);
  }
  if (a.numberOfAnalysts != null) lines.push(`Analysts covering: ${a.numberOfAnalysts}`);

  const upside = (target: number | null | undefined): string =>
    target != null && currentPrice != null && currentPrice > 0
      ? ` (${(((target - currentPrice) / currentPrice) * 100).toFixed(1)}% vs $${currentPrice.toFixed(2)})`
      : '';

  if (a.targetMean != null) lines.push(`Target mean: $${a.targetMean.toFixed(2)}${upside(a.targetMean)}`);
  if (a.targetMedian != null) lines.push(`Target median: $${a.targetMedian.toFixed(2)}${upside(a.targetMedian)}`);
  if (a.targetHigh != null) lines.push(`Target high: $${a.targetHigh.toFixed(2)}${upside(a.targetHigh)}`);
  if (a.targetLow != null) lines.push(`Target low: $${a.targetLow.toFixed(2)}${upside(a.targetLow)}`);
  return lines.length ? lines.join('\n') : 'No analyst consensus fields populated.';
}

function formatMarketStatus(s: USMarketStatus): string {
  const lines = [
    `Date: ${s.date}`,
    `Trading day: ${s.isTradingDay ? 'yes' : 'no'}`,
    `Open: ${s.isOpen ? 'yes' : 'no'}`,
    `Session: ${s.session}`,
  ];
  if (s.holiday) lines.push(`Holiday: ${s.holiday}`);
  return `# US Market Status\n\n${lines.join('\n')}`;
}

function formatPredictions(markets: PredictionMarket[]): string {
  if (markets.length === 0) return 'No prediction markets found.';
  return markets
    .map((m) => {
      const parts = [`**${m.title}**`];
      if (m.outcomes?.length) {
        const outcomeLines = m.outcomes.map((o) => `  ${o.name}: ${(o.probability * 100).toFixed(1)}%`);
        parts.push(outcomeLines.join('\n'));
      }
      if (m.volume24hr != null) parts.push(`  24h volume: $${formatNumber(m.volume24hr)}`);
      if (m.endDate) parts.push(`  Ends: ${m.endDate}`);
      if (m.url) parts.push(`  ${m.url}`);
      return parts.join('\n');
    })
    .join('\n\n');
}

function formatDiscussions(stories: HackerNewsStory[]): string {
  if (stories.length === 0) return 'No discussions found.';
  return stories
    .map((s) => {
      const parts = [`**${s.title}** (${s.points} pts, ${s.numComments} comments)`];
      if (s.url) parts.push(`  ${s.url}`);
      if (s.hnUrl) parts.push(`  HN: ${s.hnUrl}`);
      if (s.topComments?.length) {
        const commentLines = s.topComments
          .slice(0, 2)
          .map((c) => `  > ${c.text.slice(0, 150)}${c.text.length > 150 ? '…' : ''}`);
        parts.push(commentLines.join('\n'));
      }
      return parts.join('\n');
    })
    .join('\n\n');
}

function formatDerivatives(d: DerivativesData, ticker: string): string {
  const sections: string[] = [`# ${ticker} — Derivatives`];

  if (d.futures.length > 0) {
    const futureLines = d.futures.map(
      (f) => `  ${f.expiration}${f.price != null ? `: $${f.price.toFixed(2)}` : ''}${f.date ? ` (${f.date})` : ''}`,
    );
    sections.push(`## Futures Curve (${d.futures.length} contracts)\n${futureLines.join('\n')}`);
  }

  if (d.options.length > 0) {
    const calls = d.options.filter((o) => o.optionType === 'CALL');
    const puts = d.options.filter((o) => o.optionType === 'PUT');

    const formatOption = (o: DerivativesData['options'][number]) => {
      const parts = [`  $${o.strike.toFixed(2)} ${o.expiration}`];
      if (o.lastTradePrice != null) parts.push(`Last: $${o.lastTradePrice.toFixed(2)}`);
      if (o.bid != null && o.ask != null) parts.push(`Bid/Ask: $${o.bid.toFixed(2)}/$${o.ask.toFixed(2)}`);
      if (o.impliedVolatility != null) parts.push(`IV: ${(o.impliedVolatility * 100).toFixed(1)}%`);
      if (o.openInterest != null) parts.push(`OI: ${formatNumber(o.openInterest)}`);
      if (o.delta != null) parts.push(`Δ:${o.delta.toFixed(3)}`);
      return parts.join(' | ');
    };

    if (calls.length > 0) {
      sections.push(`## Calls (${calls.length})\n${calls.map(formatOption).join('\n')}`);
    }
    if (puts.length > 0) {
      sections.push(`## Puts (${puts.length})\n${puts.map(formatOption).join('\n')}`);
    }
  }

  if (d.futures.length === 0 && d.options.length === 0) {
    sections.push('No derivatives data available.');
  }

  return sections.join('\n\n');
}

export function formatNumber(n: number): string {
  if (n >= 1e12) return `${(n / 1e12).toFixed(1)}T`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toString();
}

// ── Tool Factory ─────────────────────────────────────────────────────────

export function createJintelTools(options: JintelToolOptions): ToolDefinition[] {
  const searchEntities: ToolDefinition = {
    name: 'search_entities',
    description:
      'Search for companies, people, crypto assets, commodities, or indices by name or keyword. ' +
      'Returns a list of matching entities with basic info.',
    parameters: z.object({
      query: z.string().describe('Search query (company name, ticker, person, etc.)'),
      type: EntityTypeSchema.optional().describe('Filter by entity type'),
      limit: z.number().int().min(1).max(50).optional().describe('Max results (default 10)'),
    }),
    async execute(params: { query: string; type?: EntityType; limit?: number }): Promise<ToolResult> {
      if (!options.client) return notConfigured();
      const result = await options.client.searchEntities(params.query, {
        type: params.type,
        limit: params.limit,
      });
      const handled = handleResult(result);
      if (!handled.ok) return handled.toolResult;
      return { content: formatEntities(handled.data as Entity[]) };
    },
  };

  const enrichEntity: ToolDefinition = {
    name: 'enrich_entity',
    description:
      'Get detailed enrichment data for an entity by ticker. Includes market data, ' +
      'risk profile, and regulatory filings. Select specific fields or get all.',
    parameters: z.object({
      ticker: z.string().describe('Entity ticker or ID (e.g. AAPL, BTC)'),
      fields: z.array(ENRICHMENT_FIELDS).optional().describe('Specific enrichment fields to fetch (default: all)'),
    }),
    async execute(params: { ticker: string; fields?: EnrichmentField[] }): Promise<ToolResult> {
      if (!options.client) return notConfigured();
      const result = await options.client.enrichEntity(params.ticker, params.fields);
      const handled = handleResult(result);
      if (!handled.ok) return handled.toolResult;

      const entity = handled.data as Entity;
      const content = formatEnrichment(entity);
      return { content };
    },
  };

  const marketQuotes: ToolDefinition = {
    name: 'market_quotes',
    description: 'Get real-time market quotes for one or more tickers.',
    parameters: z.object({
      tickers: z.array(z.string()).min(1).describe('List of ticker symbols'),
    }),
    async execute(params: { tickers: string[] }): Promise<ToolResult> {
      if (!options.client) return notConfigured();
      const result = await options.client.quotes(params.tickers);
      const handled = handleResult(result);
      if (!handled.ok) return handled.toolResult;
      return { content: formatQuotes(handled.data) };
    },
  };

  const batchEnrich: ToolDefinition = {
    name: 'batch_enrich',
    description:
      'Enrich multiple tickers in a SINGLE API call. Returns market data (quote + fundamentals) ' +
      'and risk profiles for all tickers at once. Much more efficient than calling enrich_entity ' +
      'per ticker — use this when analyzing 2+ tickers.',
    parameters: z.object({
      tickers: z.array(z.string()).min(1).max(20).describe('List of ticker symbols (max 20)'),
      fields: z
        .array(ENRICHMENT_FIELDS)
        .optional()
        .describe("Specific enrichment fields to fetch (default: ['market', 'risk'])"),
    }),
    async execute(params: { tickers: string[]; fields?: EnrichmentField[] }): Promise<ToolResult> {
      if (!options.client) return notConfigured();
      const fields = params.fields ?? ['market', 'risk'];

      const result = await options.client.batchEnrich(params.tickers, fields);
      const handled = handleResult(result);
      if (!handled.ok) return handled.toolResult;

      const entities = handled.data as Entity[];
      if (entities.length === 0) {
        return failureResult(`Batch enrich returned no data for ${params.tickers.join(', ')}`);
      }

      const sections = entities.map((entity) => formatEnrichment(entity));
      return { content: sections.join('\n\n---\n\n') };
    },
  };

  const sanctionsScreen: ToolDefinition = {
    name: 'sanctions_screen',
    description:
      'Screen a person or entity name against global sanctions lists (OFAC SDN and related). ' +
      'Shows matches with severity warnings. Narrow by minScore (0–100 fuzzy match), restrict to specific SDN ' +
      "listNames (e.g. ['SDN']) or sanctions programs (e.g. ['SDGT', 'IRAN']), cap rows with limit, " +
      'or flip sort (default DESC — best match first).',
    parameters: z.object({
      name: z.string().describe('Name to screen'),
      country: z.string().optional().describe('Country filter (ISO code)'),
      minScore: z.number().min(0).max(100).optional().describe('Only return matches with score >= this value (0-100)'),
      listNames: z.array(z.string()).optional().describe("Restrict to SDN list names (e.g. ['SDN'])"),
      programs: z.array(z.string()).optional().describe("Restrict to sanctions programs (e.g. ['SDGT', 'IRAN'])"),
      limit: z.number().int().min(1).max(100).optional().describe('Max matches to return (default 20)'),
      sort: z.enum(['ASC', 'DESC']).optional().describe('Sort direction by score (default DESC)'),
    }),
    async execute(params: {
      name: string;
      country?: string;
      minScore?: number;
      listNames?: string[];
      programs?: string[];
      limit?: number;
      sort?: 'ASC' | 'DESC';
    }): Promise<ToolResult> {
      if (!options.client) return notConfigured();
      const filter: Record<string, unknown> = {};
      if (params.minScore != null) filter.minScore = params.minScore;
      if (params.listNames?.length) filter.listNames = params.listNames;
      if (params.programs?.length) filter.programs = params.programs;
      if (params.limit != null) filter.limit = params.limit;
      if (params.sort) filter.sort = params.sort;
      const result = await options.client.sanctionsScreen(
        params.name,
        params.country,
        Object.keys(filter).length ? (filter as SanctionsFilterOptions) : undefined,
      );
      const handled = handleResult(result);
      if (!handled.ok) return handled.toolResult;
      return { content: formatSanctions(handled.data) };
    },
  };

  const runTechnical: ToolDefinition = {
    name: 'run_technical',
    description:
      'Fetch technical indicators for a ticker via Jintel technicals sub-graph. ' +
      'Returns RSI, MACD, Bollinger Bands (+ width), EMA (10/50/200), SMA (20/50/200), 52-WMA, ' +
      'ATR, VWMA, VWAP, MFI, ADX, Stochastic, OBV, Parabolic SAR, Williams %R, and crossover flags.\n\n' +
      'Interpretation guide:\n' +
      '- RSI > 70 = overbought, < 30 = oversold, 40-60 = neutral\n' +
      '- MACD histogram > 0 = bullish momentum, < 0 = bearish; crossover of MACD/signal line = trend change\n' +
      '- Price near BB upper = overbought/strong trend, near BB lower = oversold/weak; BB squeeze (narrow width) = breakout imminent\n' +
      '- Price > SMA(200) = long-term uptrend; golden cross (SMA 50 > 200) = bullish, death cross = bearish\n' +
      '- EMA(50)/EMA(200) crossover = faster-reacting trend signal than SMA cross\n' +
      '- 52-WMA = weekly trend filter, smooths daily noise\n' +
      '- ATR rising = increasing volatility; ATR falling = consolidation\n' +
      '- MFI > 80 = overbought (with volume confirmation), < 20 = oversold\n' +
      '- VWMA > SMA = buying pressure, VWMA < SMA = selling pressure\n' +
      '- VWAP = institutional reference price; price above VWAP = bullish intraday bias\n' +
      '- ADX > 25 = strong trend, < 20 = sideways/ranging market\n' +
      '- Stochastic %K > 80 = overbought, < 20 = oversold; %K crossing %D = signal\n' +
      '- OBV rising + price rising = volume-confirmed trend; divergence = warning\n' +
      '- Parabolic SAR below price = uptrend, above = downtrend; flip = reversal signal\n' +
      '- Williams %R > -20 = overbought, < -80 = oversold',
    parameters: z.object({
      ticker: z.string().min(1).describe('Ticker symbol (e.g. AAPL, BTC, ETH)'),
    }),
    async execute(params: { ticker: string }): Promise<ToolResult> {
      if (!options.client) return notConfigured();
      const result = await options.client.enrichEntity(params.ticker, ['technicals'] as EnrichmentField[]);
      const handled = handleResult(result);
      if (!handled.ok) return handled.toolResult;

      const entity = handled.data as Entity;
      if (!entity.technicals) {
        return { content: `No technical indicators available for ${params.ticker}.` };
      }

      const t = entity.technicals;
      const lines: string[] = [`# ${formatAssetLabel(entity.name, params.ticker)} — Technical Indicators`];

      if (t.rsi != null) {
        const zone = t.rsi > 70 ? ' (OVERBOUGHT)' : t.rsi < 30 ? ' (OVERSOLD)' : '';
        lines.push(`RSI(14): ${t.rsi.toFixed(1)}${zone}`);
      }
      if (t.macd) {
        const momentum = t.macd.histogram >= 0 ? 'bullish' : 'bearish';
        lines.push(
          `MACD: ${t.macd.macd.toFixed(3)} | Signal: ${t.macd.signal.toFixed(3)} | Histogram: ${t.macd.histogram.toFixed(3)} (${momentum})`,
        );
      }
      if (t.bollingerBands) {
        lines.push(
          `Bollinger Bands: Lower ${t.bollingerBands.lower.toFixed(2)} | Middle ${t.bollingerBands.middle.toFixed(2)} | Upper ${t.bollingerBands.upper.toFixed(2)}`,
        );
      }
      if (t.ema != null) lines.push(`EMA(10): ${t.ema.toFixed(2)}`);
      if (t.ema50 != null) lines.push(`EMA(50): ${t.ema50.toFixed(2)}`);
      if (t.ema200 != null) lines.push(`EMA(200): ${t.ema200.toFixed(2)}`);
      if (t.sma != null) {
        const trend = entity.market?.quote
          ? entity.market.quote.price > t.sma
            ? 'above (uptrend)'
            : 'below (downtrend)'
          : '';
        lines.push(`SMA(50): ${t.sma.toFixed(2)}${trend ? ` — price ${trend}` : ''}`);
      }
      if (t.sma20 != null) lines.push(`SMA(20): ${t.sma20.toFixed(2)}`);
      if (t.sma200 != null) {
        const trend = entity.market?.quote
          ? entity.market.quote.price > t.sma200
            ? 'above (long-term uptrend)'
            : 'below (long-term downtrend)'
          : '';
        lines.push(`SMA(200): ${t.sma200.toFixed(2)}${trend ? ` — price ${trend}` : ''}`);
      }
      if (t.wma52 != null) lines.push(`52-WMA: ${t.wma52.toFixed(2)}`);
      if (t.atr != null) lines.push(`ATR(14): ${t.atr.toFixed(2)}`);
      if (t.vwma != null) lines.push(`VWMA(20): ${t.vwma.toFixed(2)}`);
      if (t.vwap != null) {
        const bias = entity.market?.quote
          ? entity.market.quote.price > t.vwap
            ? ' — price above (bullish bias)'
            : ' — price below (bearish bias)'
          : '';
        lines.push(`VWAP: ${t.vwap.toFixed(2)}${bias}`);
      }
      if (t.mfi != null) {
        const zone = t.mfi > 80 ? ' (OVERBOUGHT)' : t.mfi < 20 ? ' (OVERSOLD)' : '';
        lines.push(`MFI(14): ${t.mfi.toFixed(1)}${zone}`);
      }
      if (t.adx != null) {
        const strength = t.adx > 25 ? ' (strong trend)' : t.adx < 20 ? ' (weak/ranging)' : '';
        lines.push(`ADX: ${t.adx.toFixed(1)}${strength}`);
      }
      if (t.stochastic) {
        const zone = t.stochastic.k > 80 ? ' (OVERBOUGHT)' : t.stochastic.k < 20 ? ' (OVERSOLD)' : '';
        lines.push(`Stochastic: %K ${t.stochastic.k.toFixed(1)} | %D ${t.stochastic.d.toFixed(1)}${zone}`);
      }
      if (t.obv != null) lines.push(`OBV: ${t.obv.toLocaleString()}`);
      if (t.parabolicSar != null) {
        const trend = entity.market?.quote
          ? entity.market.quote.price > t.parabolicSar
            ? ' (uptrend — SAR below price)'
            : ' (downtrend — SAR above price)'
          : '';
        lines.push(`Parabolic SAR: ${t.parabolicSar.toFixed(2)}${trend}`);
      }
      if (t.bollingerBandsWidth != null) {
        const squeeze = t.bollingerBandsWidth < 0.05 ? ' (SQUEEZE — breakout imminent)' : '';
        lines.push(`BB Width: ${t.bollingerBandsWidth.toFixed(4)}${squeeze}`);
      }
      if (t.williamsR != null) {
        const zone = t.williamsR > -20 ? ' (OVERBOUGHT)' : t.williamsR < -80 ? ' (OVERSOLD)' : '';
        lines.push(`Williams %R: ${t.williamsR.toFixed(1)}${zone}`);
      }
      if (t.crossovers) {
        const cx = t.crossovers;
        const flags: string[] = [];
        if (cx.goldenCross) flags.push('GOLDEN CROSS (SMA 50 > SMA 200) — bullish');
        if (cx.deathCross) flags.push('DEATH CROSS (SMA 50 < SMA 200) — bearish');
        if (cx.emaCross) flags.push('EMA CROSS: EMA(50) > EMA(200) — bullish');
        else if (t.ema50 != null && t.ema200 != null) flags.push('EMA CROSS: EMA(50) < EMA(200) — bearish');
        if (flags.length) lines.push(`\nCrossovers:\n${flags.map((f) => `  ${f}`).join('\n')}`);
      }

      return { content: lines.join('\n') };
    },
  };

  // ── Economy tools ──────────────────────────────────────────────────────

  const getGdp: ToolDefinition = {
    name: 'get_gdp',
    description:
      'Get GDP data for a country. Returns time series of GDP values. ' +
      'Useful for macro context when analyzing market conditions or country risk.',
    parameters: z.object({
      country: z.string().describe('Country name or ISO code (e.g. "United States", "US", "Germany")'),
      type: GdpTypeSchema.optional().describe('GDP type: REAL, NOMINAL, or FORECAST (default: REAL)'),
    }),
    async execute(params: { country: string; type?: GdpType }): Promise<ToolResult> {
      if (!options.client) return notConfigured();
      const client = options.client;
      const result = await safeCall(() =>
        client.request<EconomicDataPoint[]>(GDP, {
          country: params.country,
          type: params.type,
        }),
      );
      if (!result.ok) return result.toolResult;
      return { content: formatEconomicData(result.data, `GDP — ${params.country}`) };
    },
  };

  const getInflation: ToolDefinition = {
    name: 'get_inflation',
    description:
      'Get inflation (CPI) data for a country. Returns time series of inflation values. ' +
      'Critical for understanding real returns and central bank policy direction.',
    parameters: z.object({
      country: z.string().describe('Country name or ISO code (e.g. "United States", "UK")'),
    }),
    async execute(params: { country: string }): Promise<ToolResult> {
      if (!options.client) return notConfigured();
      const client = options.client;
      const result = await safeCall(() => client.request<EconomicDataPoint[]>(INFLATION, { country: params.country }));
      if (!result.ok) return result.toolResult;
      return { content: formatEconomicData(result.data, `Inflation — ${params.country}`) };
    },
  };

  const getInterestRates: ToolDefinition = {
    name: 'get_interest_rates',
    description:
      'Get central bank interest rate data for a country. Returns time series of rate decisions. ' +
      'Key for understanding monetary policy and its impact on equity/bond valuations.',
    parameters: z.object({
      country: z.string().describe('Country name or ISO code (e.g. "United States", "EU")'),
    }),
    async execute(params: { country: string }): Promise<ToolResult> {
      if (!options.client) return notConfigured();
      const client = options.client;
      const result = await safeCall(() =>
        client.request<EconomicDataPoint[]>(INTEREST_RATES, { country: params.country }),
      );
      if (!result.ok) return result.toolResult;
      return { content: formatEconomicData(result.data, `Interest Rates — ${params.country}`) };
    },
  };

  const getSP500Multiples: ToolDefinition = {
    name: 'get_sp500_multiples',
    description:
      'Get S&P 500 valuation multiples over time. Available series:\n' +
      '- PE_MONTH: trailing P/E ratio\n' +
      '- SHILLER_PE_MONTH: cyclically-adjusted P/E (CAPE/Shiller PE)\n' +
      '- DIVIDEND_YIELD_MONTH: dividend yield\n' +
      '- EARNINGS_YIELD_MONTH: earnings yield (inverse of P/E)\n\n' +
      'Useful for gauging broad market valuation relative to historical norms.',
    parameters: z.object({
      series: SP500SeriesSchema.describe('Which valuation series to fetch'),
    }),
    async execute(params: { series: SP500Series }): Promise<ToolResult> {
      if (!options.client) return notConfigured();
      const client = options.client;
      const result = await safeCall(() => client.request<SP500DataPoint[]>(SP500_MULTIPLES, { series: params.series }));
      if (!result.ok) return result.toolResult;
      return { content: formatSP500Data(result.data) };
    },
  };

  const priceHistory: ToolDefinition = {
    name: 'price_history',
    description:
      'Get historical OHLCV (open/high/low/close/volume) price data for one or more tickers.\n\n' +
      'Ranges: 1d, 5d, 1m, 3m, 6m, 1y, 2y, 5y, max\n' +
      'Intervals: 1m, 2m, 5m, 15m, 30m, 60m, 90m, 1h, 1d, 5d, 1W, 1M, 1Q\n\n' +
      'Use for price trend analysis, chart patterns, support/resistance levels, or comparing ' +
      'price performance across assets over a time period.',
    parameters: z.object({
      tickers: z
        .array(z.string())
        .min(1)
        .max(10)
        .describe('Ticker symbols to fetch history for (e.g. ["AAPL", "NVDA"])'),
      range: z.string().optional().describe('Time range (default "1y"). Options: 1d, 5d, 1m, 3m, 6m, 1y, 2y, 5y, max'),
      interval: z
        .string()
        .optional()
        .describe('Candle interval (default "1d"). Options: 1m, 2m, 5m, 15m, 30m, 60m, 90m, 1h, 1d, 5d, 1W, 1M, 1Q'),
    }),
    async execute(params: { tickers: string[]; range?: string; interval?: string }): Promise<ToolResult> {
      if (!options.client) return notConfigured();
      const client = options.client;
      const result = await safeCall(() =>
        client.priceHistory(
          params.tickers.map((t) => t.toUpperCase()),
          params.range ?? '1y',
          params.interval,
        ),
      );
      if (!result.ok) return result.toolResult;
      const handled = handleResult(result.data);
      if (!handled.ok) return handled.toolResult;
      return { content: formatPriceHistory(handled.data) };
    },
  };

  const marketStatus: ToolDefinition = {
    name: 'market_status',
    description:
      'Get the current US equity market status — whether the market is open, the session ' +
      '(PRE_MARKET, OPEN, AFTER_HOURS, CLOSED), whether today is a trading day, and any holiday name. ' +
      'Use before placing orders or when timing matters for a recommendation.',
    parameters: z.object({}),
    async execute(): Promise<ToolResult> {
      if (!options.client) return notConfigured();
      const client = options.client;
      const result = await safeCall(() => client.marketStatus());
      if (!result.ok) return result.toolResult;
      const handled = handleResult(result.data);
      if (!handled.ok) return handled.toolResult;
      return { content: formatMarketStatus(handled.data) };
    },
  };

  const getNews: ToolDefinition = {
    name: 'get_news',
    description:
      'Get recent news articles for a ticker. Returns headlines, sources, snippets, and links.\n\n' +
      'Use when the user asks about recent news, events, or headlines for a specific stock or crypto asset. ' +
      'Narrow by `sources` (e.g. ["CNBC", "Reuters"]) or by `minSentiment`/`maxSentiment` (-1 to +1) to ' +
      'focus on bullish/bearish coverage.',
    parameters: z.object({
      ticker: z.string().min(1).describe('Ticker symbol (e.g. AAPL, BTC, TSLA)'),
      since: z
        .string()
        .optional()
        .describe('ISO timestamp — only return articles published after this date (e.g. "2026-04-01T00:00:00Z")'),
      until: z.string().optional().describe('ISO timestamp — only return articles published before this date'),
      limit: z.number().int().min(1).max(50).optional().describe('Max articles to return (default 20)'),
      sources: z
        .array(z.string())
        .optional()
        .describe('Restrict to these source names (case-insensitive exact match, e.g. ["CNBC", "Reuters"])'),
      minSentiment: z
        .number()
        .min(-1)
        .max(1)
        .optional()
        .describe('Only articles with sentimentScore >= this value (-1 to +1)'),
      maxSentiment: z
        .number()
        .min(-1)
        .max(1)
        .optional()
        .describe('Only articles with sentimentScore <= this value (-1 to +1)'),
    }),
    async execute(params: {
      ticker: string;
      since?: string;
      until?: string;
      limit?: number;
      sources?: string[];
      minSentiment?: number;
      maxSentiment?: number;
    }): Promise<ToolResult> {
      if (!options.client) return notConfigured();
      const client = options.client;
      const newsFilter: Record<string, unknown> = { sort: 'DESC' };
      if (params.since) newsFilter.since = params.since;
      if (params.until) newsFilter.until = params.until;
      if (params.limit) newsFilter.limit = params.limit;
      if (params.sources?.length) newsFilter.sources = params.sources;
      if (params.minSentiment != null) newsFilter.minSentiment = params.minSentiment;
      if (params.maxSentiment != null) newsFilter.maxSentiment = params.maxSentiment;
      const query = buildEnrichQuery(['news'] as EnrichmentField[], {
        newsFilter: newsFilter as EnrichOptions['newsFilter'],
      });
      const result = await safeCall(() =>
        client.request<Entity>(query, { id: params.ticker.toUpperCase(), newsFilter }),
      );
      if (!result.ok) return result.toolResult;

      const entity = result.data;
      if (!entity.news?.length) {
        return { content: `No recent news found for ${params.ticker}.` };
      }

      return { content: `# ${formatAssetLabel(entity.name, params.ticker)} — News\n\n${formatNews(entity.news)}` };
    },
  };

  const getResearch: ToolDefinition = {
    name: 'get_research',
    description:
      'Get analyst research reports for a ticker. Returns report titles, authors, publication dates, ' +
      'full text excerpts, relevance scores, and URLs.\n\n' +
      'Use when the user asks about analyst opinions, research coverage, or deep-dive analysis for an asset.',
    parameters: z.object({
      ticker: z.string().min(1).describe('Ticker symbol (e.g. AAPL, BTC, NVDA)'),
      since: z
        .string()
        .optional()
        .describe('ISO timestamp — only return reports published after this date (e.g. "2026-04-01T00:00:00Z")'),
      limit: z.number().int().min(1).max(50).optional().describe('Max reports to return (default 20)'),
    }),
    async execute(params: { ticker: string; since?: string; limit?: number }): Promise<ToolResult> {
      if (!options.client) return notConfigured();
      const client = options.client;
      const { opts, vars } = buildFilter(params.since, params.limit);
      const query = buildEnrichQuery(['research'] as EnrichmentField[], opts);
      const result = await safeCall(() =>
        client.request<Entity>(query, { id: params.ticker.toUpperCase(), filter: vars }),
      );
      if (!result.ok) return result.toolResult;

      const entity = result.data;
      if (!entity.research?.length) {
        return { content: `No research reports found for ${params.ticker}.` };
      }

      return {
        content: `# ${formatAssetLabel(entity.name, params.ticker)} — Research\n\n${formatResearch(entity.research)}`,
      };
    },
  };

  const getSentiment: ToolDefinition = {
    name: 'get_sentiment',
    description:
      'Get social sentiment metrics for a ticker. Returns social rank, mention count, upvotes, ' +
      'and 24-hour momentum.\n\n' +
      'Use when the user asks about social buzz, community sentiment, trending status, or ' +
      'retail investor attention for a stock or crypto.',
    parameters: z.object({
      ticker: z.string().min(1).describe('Ticker symbol (e.g. AAPL, BTC, GME)'),
    }),
    async execute(params: { ticker: string }): Promise<ToolResult> {
      if (!options.client) return notConfigured();
      const client = options.client;
      const result = await safeCall(() =>
        client.enrichEntity(params.ticker.toUpperCase(), ['sentiment'] as EnrichmentField[]),
      );
      if (!result.ok) return result.toolResult;
      const handled = handleResult(result.data);
      if (!handled.ok) return handled.toolResult;

      const entity = handled.data as Entity;
      if (!entity.sentiment) {
        return { content: `No sentiment data available for ${params.ticker}.` };
      }

      return { content: formatSentiment(entity.sentiment) };
    },
  };

  const getDerivatives: ToolDefinition = {
    name: 'get_derivatives',
    description:
      'Get derivatives data (futures curve + options chain) for a ticker. Returns futures ' +
      'expiration/price and options with strike, type, delta, implied volatility, open interest, ' +
      'and bid/ask.\n\n' +
      'Primarily available for crypto assets. Use when the user asks about options flow, ' +
      'futures contango/backwardation, implied volatility, or derivatives positioning.\n\n' +
      'Options chains can exceed 5000 rows — narrow with optionType/strikeMin/strikeMax/minOpenInterest.',
    parameters: z.object({
      ticker: z.string().min(1).describe('Ticker symbol (e.g. BTC, ETH)'),
      optionType: OPTION_TYPE.optional().describe('Restrict options to CALL or PUT only'),
      strikeMin: z.number().positive().optional().describe('Minimum strike price (inclusive)'),
      strikeMax: z.number().positive().optional().describe('Maximum strike price (inclusive)'),
      minOpenInterest: z.number().int().nonnegative().optional().describe('Drop contracts with OI below this'),
      minVolume: z.number().int().nonnegative().optional().describe('Drop contracts with volume below this'),
      optionsLimit: z
        .number()
        .int()
        .min(1)
        .max(500)
        .optional()
        .describe('Max options contracts to return (default 100)'),
      optionsSort: OPTIONS_CHAIN_SORT.optional().describe('Options sort order (default EXPIRATION_ASC)'),
      futuresLimit: z
        .number()
        .int()
        .min(1)
        .max(200)
        .optional()
        .describe('Max futures contracts to return (default 50)'),
    }),
    async execute(params: {
      ticker: string;
      optionType?: OptionType;
      strikeMin?: number;
      strikeMax?: number;
      minOpenInterest?: number;
      minVolume?: number;
      optionsLimit?: number;
      optionsSort?: OptionsChainSort;
      futuresLimit?: number;
    }): Promise<ToolResult> {
      if (!options.client) return notConfigured();
      const client = options.client;

      const optionsFilter = {
        ...(params.optionType ? { optionType: params.optionType } : {}),
        ...(params.strikeMin != null ? { strikeMin: params.strikeMin } : {}),
        ...(params.strikeMax != null ? { strikeMax: params.strikeMax } : {}),
        ...(params.minOpenInterest != null ? { minOpenInterest: params.minOpenInterest } : {}),
        ...(params.minVolume != null ? { minVolume: params.minVolume } : {}),
        ...(params.optionsLimit != null ? { limit: params.optionsLimit } : {}),
        ...(params.optionsSort ? { sort: params.optionsSort } : {}),
      };
      const futuresFilter = params.futuresLimit != null ? { limit: params.futuresLimit } : undefined;
      const enrichOpts: EnrichOptions = {
        ...(Object.keys(optionsFilter).length > 0 ? { optionsFilter } : {}),
        ...(futuresFilter ? { futuresFilter } : {}),
      };
      const query = buildEnrichQuery(['derivatives'] as EnrichmentField[], enrichOpts);
      const variables: Record<string, unknown> = { id: params.ticker.toUpperCase() };
      if (Object.keys(optionsFilter).length > 0) variables.optionsFilter = optionsFilter;
      if (futuresFilter) variables.futuresFilter = futuresFilter;

      const result = await safeCall(() => client.request<Entity>(query, variables));
      if (!result.ok) return result.toolResult;

      const entity = result.data;
      if (!entity.derivatives) {
        return { content: `No derivatives data available for ${params.ticker}.` };
      }

      return { content: formatDerivatives(entity.derivatives, formatAssetLabel(entity.name, params.ticker)) };
    },
  };

  const getFilings: ToolDefinition = {
    name: 'get_filings',
    description:
      'Get SEC regulatory filings for a ticker, narrowed by form type. Returns filing type, date, ' +
      'description, and URL.\n\n' +
      'Use when the user asks about 10-K/10-Q/8-K filings, annual reports, or material regulatory events. ' +
      'Filter by `types` to limit to material filings and avoid noise from Form 3/4/5 and prospectuses.',
    parameters: z.object({
      ticker: z.string().min(1).describe('Ticker symbol (e.g. AAPL, TSLA)'),
      types: z
        .array(FILING_TYPE)
        .optional()
        .describe('Restrict to form types (e.g. ["FILING_10K", "FILING_10Q", "FILING_8K", "ANNUAL_REPORT"])'),
      since: z.string().optional().describe('ISO timestamp — only filings on/after this date'),
      until: z.string().optional().describe('ISO timestamp — only filings on/before this date'),
      limit: z.number().int().min(1).max(100).optional().describe('Max filings to return (default 20)'),
    }),
    async execute(params: {
      ticker: string;
      types?: FilingType[];
      since?: string;
      until?: string;
      limit?: number;
    }): Promise<ToolResult> {
      if (!options.client) return notConfigured();
      const client = options.client;

      const filingsFilter: Record<string, unknown> = { sort: 'DESC' };
      if (params.types?.length) filingsFilter.types = params.types;
      if (params.since) filingsFilter.since = params.since;
      if (params.until) filingsFilter.until = params.until;
      if (params.limit) filingsFilter.limit = params.limit;

      const query = buildEnrichQuery(['regulatory'] as EnrichmentField[], {
        filingsFilter: filingsFilter as EnrichOptions['filingsFilter'],
      });
      const result = await safeCall(() =>
        client.request<Entity>(query, { id: params.ticker.toUpperCase(), filingsFilter }),
      );
      if (!result.ok) return result.toolResult;

      const entity = result.data;
      const filings = entity.regulatory?.filings ?? [];
      if (filings.length === 0) {
        return { content: `No filings found for ${params.ticker}.` };
      }

      const lines = filings.map((f) => {
        const parts = [`- **${f.type}** — ${f.date}`];
        if (f.description) parts.push(`  ${f.description}`);
        if (f.url) parts.push(`  ${f.url}`);
        return parts.join('\n');
      });
      return {
        content: `# ${formatAssetLabel(entity.name, params.ticker)} — Filings (${filings.length})\n\n${lines.join('\n')}`,
      };
    },
  };

  const getRiskSignals: ToolDefinition = {
    name: 'get_risk_signals',
    description:
      'Get risk signals for a ticker (sanctions, litigation, regulatory actions, adverse media, PEP). ' +
      'Returns signal type, severity, description, source, and date.\n\n' +
      'Use when the user asks about legal/regulatory risk, sanctions exposure, or material adverse events. ' +
      'Filter by `severities` (e.g. ["HIGH", "CRITICAL"]) to drop low-severity noise and fuzzy false positives.',
    parameters: z.object({
      ticker: z.string().min(1).describe('Ticker symbol (e.g. AAPL, Gazprom)'),
      severities: z
        .array(SEVERITY)
        .optional()
        .describe('Restrict to these severities (e.g. ["MEDIUM", "HIGH", "CRITICAL"])'),
      types: z
        .array(RISK_SIGNAL_TYPE)
        .optional()
        .describe('Restrict to these risk types (e.g. ["SANCTIONS", "LITIGATION"])'),
      since: z.string().optional().describe('ISO timestamp — only signals on/after this date'),
      limit: z.number().int().min(1).max(100).optional().describe('Max signals to return (default 20)'),
    }),
    async execute(params: {
      ticker: string;
      severities?: Severity[];
      types?: RiskSignalType[];
      since?: string;
      limit?: number;
    }): Promise<ToolResult> {
      if (!options.client) return notConfigured();
      const client = options.client;

      const riskSignalFilter: Record<string, unknown> = { sort: 'DESC' };
      if (params.severities?.length) riskSignalFilter.severities = params.severities;
      if (params.types?.length) riskSignalFilter.types = params.types;
      if (params.since) riskSignalFilter.since = params.since;
      if (params.limit) riskSignalFilter.limit = params.limit;

      const query = buildEnrichQuery(['risk'] as EnrichmentField[], {
        riskSignalFilter: riskSignalFilter as EnrichOptions['riskSignalFilter'],
      });
      const result = await safeCall(() =>
        client.request<Entity>(query, { id: params.ticker.toUpperCase(), riskSignalFilter }),
      );
      if (!result.ok) return result.toolResult;

      const entity = result.data;
      const signals = entity.risk?.signals ?? [];
      if (signals.length === 0) {
        return { content: `No risk signals found for ${params.ticker}.` };
      }

      const lines = signals.map((s) => {
        const parts = [`- [${s.severity}] **${s.type}**: ${s.description}`];
        if (s.source) parts.push(`  Source: ${s.source}`);
        if (s.date) parts.push(`  Date: ${s.date}`);
        return parts.join('\n');
      });
      const score = entity.risk?.overallScore;
      const header = `# ${formatAssetLabel(entity.name, params.ticker)} — Risk Signals${score != null ? ` (score: ${score})` : ''}`;
      return { content: `${header}\n\n${lines.join('\n')}` };
    },
  };

  const getShortInterest: ToolDefinition = {
    name: 'get_short_interest',
    description:
      'Get short interest data for a ticker. Returns shares short, days-to-cover ratio, and change since last report.\n\n' +
      'High short interest + high days-to-cover = potential short squeeze setup. ' +
      'Use when the user asks about short sellers, bearish positioning, or squeeze potential.',
    parameters: z.object({
      ticker: z.string().min(1).describe('Ticker symbol (e.g. GME, TSLA, AMC)'),
      since: z.string().optional().describe('ISO date — only include reports on/after this date'),
      until: z.string().optional().describe('ISO date — only include reports on/before this date'),
      limit: z.number().int().min(1).max(100).optional().describe('Max reports to return (default 20)'),
    }),
    async execute(params: { ticker: string; since?: string; until?: string; limit?: number }): Promise<ToolResult> {
      if (!options.client) return notConfigured();
      const client = options.client;
      const filter: ArraySubGraphOptions = { sort: 'DESC' };
      if (params.since) filter.since = params.since;
      if (params.until) filter.until = params.until;
      if (params.limit) filter.limit = params.limit;
      const result = await safeCall(() => client.shortInterest(params.ticker.toUpperCase(), filter));
      if (!result.ok) return result.toolResult;
      const handled = handleResult(result.data);
      if (!handled.ok) return handled.toolResult;
      const reports = handled.data as ShortInterestReport[];
      return { content: `# ${params.ticker.toUpperCase()} — Short Interest\n\n${formatShortInterest(reports)}` };
    },
  };

  const getInstitutionalHoldings: ToolDefinition = {
    name: 'get_institutional_holdings',
    description:
      'Get 13F institutional holdings for a filer by SEC CIK number. Returns the latest 13F-HR filing portfolio ' +
      'showing all equity positions reported to the SEC.\n\n' +
      'Use when the user asks about what a fund/institution holds, e.g. "What does Berkshire Hathaway own?" ' +
      'or "Show me Bridgewater\'s portfolio". Requires the filer\'s CIK (Central Index Key) from SEC EDGAR.',
    parameters: z.object({
      cik: z.string().min(1).describe('SEC CIK number of the filer (e.g. "0001067983" for Berkshire Hathaway)'),
      since: z.string().optional().describe('ISO timestamp — only return holdings from filings after this date'),
      until: z.string().optional().describe('ISO timestamp — only return holdings from filings before this date'),
      limit: z.number().int().min(1).max(200).optional().describe('Max holdings to return (default: all)'),
      offset: z.number().int().nonnegative().optional().describe('Rows to skip for pagination (default 0)'),
      minValue: z
        .number()
        .positive()
        .optional()
        .describe('Only include holdings with position value >= this amount (thousands of USD)'),
      cusip: z.string().optional().describe('Filter to a single CUSIP — useful to track one security across filers'),
    }),
    async execute(params: {
      cik: string;
      since?: string;
      until?: string;
      limit?: number;
      offset?: number;
      minValue?: number;
      cusip?: string;
    }): Promise<ToolResult> {
      if (!options.client) return notConfigured();
      const client = options.client;
      const filter: NonNullable<EnrichOptions['institutionalHoldingsFilter']> = { sort: 'DESC' };
      if (params.since) filter.since = params.since;
      if (params.until) filter.until = params.until;
      if (params.limit) filter.limit = params.limit;
      if (params.offset != null) filter.offset = params.offset;
      if (params.minValue != null) filter.minValue = params.minValue;
      if (params.cusip) filter.cusip = params.cusip;
      const result = await safeCall(() => client.institutionalHoldings(params.cik, filter));
      if (!result.ok) return result.toolResult;
      const handled = handleResult(result.data);
      if (!handled.ok) return handled.toolResult;
      const holdings = handled.data as InstitutionalHolding[];
      return {
        content: `# Institutional Holdings (13F) — CIK ${params.cik}\n\n${formatInstitutionalHoldings(holdings)}`,
      };
    },
  };

  const getOwnership: ToolDefinition = {
    name: 'get_ownership',
    description:
      'Get ownership breakdown for a ticker — insider vs institutional ownership percentages, shares outstanding, ' +
      'float, short interest, and days to cover.\n\n' +
      'Use when the user asks about who owns a stock, insider ownership, institutional ownership, or float analysis.',
    parameters: z.object({
      ticker: z.string().min(1).describe('Ticker symbol (e.g. AAPL, TSLA, NVDA)'),
    }),
    async execute(params: { ticker: string }): Promise<ToolResult> {
      if (!options.client) return notConfigured();
      const client = options.client;
      const ticker = params.ticker.toUpperCase();
      const result = await safeCall(() => client.enrichEntity(ticker, ['ownership'] as EnrichmentField[]));
      if (!result.ok) return result.toolResult;
      const handled = handleResult(result.data);
      if (!handled.ok) return handled.toolResult;
      const entity = handled.data as Entity;
      if (!entity.ownership) {
        return { content: `No ownership data available for ${ticker}.` };
      }
      return {
        content: `# ${formatAssetLabel(entity.name, ticker)} — Ownership Breakdown\n\n${formatOwnership(entity.ownership)}`,
      };
    },
  };

  const getTopHolders: ToolDefinition = {
    name: 'get_top_holders',
    description:
      'Get top institutional holders of a ticker from 13F filings. Returns the largest institutional positions ' +
      'with filer name, CIK, value, shares, and filing dates.\n\n' +
      'Use when the user asks "who are the biggest holders of X?", "which institutions own Y?", or ' +
      '"show me the top shareholders".',
    parameters: z.object({
      ticker: z.string().min(1).describe('Ticker symbol (e.g. AAPL, TSLA, NVDA)'),
      limit: z.number().int().min(1).max(100).optional().describe('Max holders to return (default 20)'),
      offset: z.number().int().nonnegative().optional().describe('Number of holders to skip (for pagination)'),
      minValue: z
        .number()
        .positive()
        .optional()
        .describe('Minimum position value in thousands of USD (drops small holders)'),
      since: z.string().optional().describe('ISO date — only filings on/after this date'),
      until: z.string().optional().describe('ISO date — only filings on/before this date'),
    }),
    async execute(params: {
      ticker: string;
      limit?: number;
      offset?: number;
      minValue?: number;
      since?: string;
      until?: string;
    }): Promise<ToolResult> {
      if (!options.client) return notConfigured();
      const client = options.client;
      const ticker = params.ticker.toUpperCase();
      // Only build a filter when the caller passes something — otherwise let the server default apply.
      const hasFilter =
        params.limit != null ||
        params.offset != null ||
        params.minValue != null ||
        params.since != null ||
        params.until != null;
      const topHoldersFilter: Record<string, unknown> | undefined = hasFilter ? {} : undefined;
      if (topHoldersFilter) {
        if (params.limit) topHoldersFilter.limit = params.limit;
        if (params.offset != null) topHoldersFilter.offset = params.offset;
        if (params.minValue != null) topHoldersFilter.minValue = params.minValue;
        if (params.since) topHoldersFilter.since = params.since;
        if (params.until) topHoldersFilter.until = params.until;
      }
      const query = buildEnrichQuery(['topHolders'] as EnrichmentField[], {
        topHoldersFilter: topHoldersFilter as EnrichOptions['topHoldersFilter'],
      });
      const vars: Record<string, unknown> = { id: ticker };
      if (topHoldersFilter) vars.topHoldersFilter = topHoldersFilter;
      const result = await safeCall(() => client.request<Entity>(query, vars));
      if (!result.ok) return result.toolResult;
      const entity = result.data;
      if (!entity.topHolders?.length) {
        return { content: `No top holders data available for ${ticker}.` };
      }
      return {
        content: `# ${formatAssetLabel(entity.name, ticker)} — Top Institutional Holders\n\n${formatTopHolders(entity.topHolders)}`,
      };
    },
  };

  const getFamaFrench: ToolDefinition = {
    name: 'get_fama_french',
    description:
      'Get Fama-French factor data for risk decomposition and asset pricing analysis.\n\n' +
      'Available series:\n' +
      '- THREE_FACTOR_DAILY / THREE_FACTOR_MONTHLY: market risk premium (Mkt-RF), size (SMB), value (HML)\n' +
      '- FIVE_FACTOR_DAILY / FIVE_FACTOR_MONTHLY: adds profitability (RMW) and investment (CMA)\n\n' +
      'Use when the user asks about factor exposure, risk decomposition, value vs growth tilt, or ' +
      'academic factor-based analysis of a portfolio.',
    parameters: z.object({
      series: FamaFrenchSeriesSchema.describe('Factor series to fetch'),
      range: z.string().optional().describe('Date range filter (e.g. "1y", "6m"). Leave empty for full history.'),
      since: z.string().optional().describe('ISO date — only include factors on/after this date'),
      until: z.string().optional().describe('ISO date — only include factors on/before this date'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(10000)
        .optional()
        .describe(
          'Max data points to return (default 20). Daily series can emit thousands — set explicitly for wide windows.',
        ),
    }),
    async execute(params: {
      series: FamaFrenchSeries;
      range?: string;
      since?: string;
      until?: string;
      limit?: number;
    }): Promise<ToolResult> {
      if (!options.client) return notConfigured();
      const client = options.client;
      const filter: ArraySubGraphOptions = { sort: 'DESC' };
      if (params.since) filter.since = params.since;
      if (params.until) filter.until = params.until;
      if (params.limit) filter.limit = params.limit;
      const result = await safeCall(() => client.famaFrenchFactors(params.series, params.range, filter));
      if (!result.ok) return result.toolResult;
      const handled = handleResult(result.data);
      if (!handled.ok) return handled.toolResult;
      return { content: formatFactorData(handled.data as FactorDataPoint[], params.series) };
    },
  };

  const getAnalystConsensus: ToolDefinition = {
    name: 'get_analyst_consensus',
    description:
      'Get sell-side analyst price targets and recommendation consensus for an equity ticker. ' +
      'Returns targetHigh / targetLow / targetMean / targetMedian (USD), recommendation (buy/hold/sell), ' +
      'recommendationMean (1 = strong buy, 5 = strong sell), and numberOfAnalysts.\n\n' +
      'Equity-only: returns no data for crypto. Use when the user asks about Wall Street consensus, ' +
      'price targets, upside/downside to target, or analyst ratings.',
    parameters: z.object({
      ticker: z.string().min(1).describe('Equity ticker symbol (e.g. AAPL, NVDA, MSFT)'),
    }),
    async execute(params: { ticker: string }): Promise<ToolResult> {
      if (!options.client) return notConfigured();
      const result = await options.client.enrichEntity(params.ticker, ['analyst'] as EnrichmentField[]);
      const handled = handleResult(result);
      if (!handled.ok) return handled.toolResult;
      const entity = handled.data as Entity;
      if (!entity.analyst) {
        return {
          content: `No analyst consensus available for ${params.ticker}. (Equity-only field — not available for crypto.)`,
        };
      }
      return {
        content: `# ${formatAssetLabel(entity.name, params.ticker)} — Analyst Consensus\n\n${formatAnalystConsensus(entity.analyst, entity.market?.quote?.price)}`,
      };
    },
  };

  const getSocial: ToolDefinition = {
    name: 'get_social',
    description:
      'Get Reddit posts and comments mentioning a ticker. Returns recent posts with engagement metrics.\n\n' +
      'NOTE: This is a costly query — only use when the user explicitly asks about social media ' +
      'posts, community discussion, or social chatter for a specific asset.',
    parameters: z.object({
      ticker: z.string().min(1).describe('Ticker symbol (e.g. TSLA, BTC, NVDA)'),
      since: z
        .string()
        .optional()
        .describe('ISO timestamp — only return posts published after this date (e.g. "2026-04-01T00:00:00Z")'),
      limit: z.number().int().min(1).max(50).optional().describe('Max posts to return per sub-feed (default 20)'),
    }),
    async execute(params: { ticker: string; since?: string; limit?: number }): Promise<ToolResult> {
      if (!options.client) return notConfigured();
      const client = options.client;
      const { opts, vars } = buildFilter(params.since, params.limit);
      const query = buildEnrichQuery(['social'] as EnrichmentField[], opts);
      const result = await safeCall(() =>
        client.request<Entity>(query, { id: params.ticker.toUpperCase(), filter: vars }),
      );
      if (!result.ok) return result.toolResult;
      const entity = result.data;
      if (!entity.social) {
        return { content: `No social media data available for ${params.ticker}.` };
      }
      return {
        content: `# ${formatAssetLabel(entity.name, params.ticker)} — Social Posts\n\n${formatSocial(entity.social)}`,
      };
    },
  };

  const getPredictions: ToolDefinition = {
    name: 'get_predictions',
    description:
      'Get prediction market data related to a ticker (e.g. Polymarket contracts on earnings outcomes, ' +
      'regulatory decisions, price targets).\n\n' +
      'NOTE: This is a costly query — only use when the user explicitly asks about prediction ' +
      'markets, event probabilities, or market-implied odds for a specific asset.',
    parameters: z.object({
      ticker: z.string().min(1).describe('Ticker symbol (e.g. AAPL, BTC)'),
      since: z.string().optional().describe('ISO date — only include events created on/after this date'),
      until: z.string().optional().describe('ISO date — only include events created on/before this date'),
      limit: z.number().int().min(1).max(100).optional().describe('Max events to return (default 20)'),
      offset: z.number().int().nonnegative().optional().describe('Rows to skip for pagination (default 0)'),
      minVolume24hr: z
        .number()
        .nonnegative()
        .optional()
        .describe('Only include events with 24-hour USD volume >= this amount'),
      minLiquidity: z.number().nonnegative().optional().describe('Only include events with liquidity >= this amount'),
      onlyOpen: z
        .boolean()
        .optional()
        .describe('If true, exclude resolved events — only return events with unresolved outcomes'),
    }),
    async execute(params: {
      ticker: string;
      since?: string;
      until?: string;
      limit?: number;
      offset?: number;
      minVolume24hr?: number;
      minLiquidity?: number;
      onlyOpen?: boolean;
    }): Promise<ToolResult> {
      if (!options.client) return notConfigured();
      const client = options.client;
      const predictionsFilter: NonNullable<EnrichOptions['predictionsFilter']> = { sort: 'DESC' };
      if (params.since) predictionsFilter.since = params.since;
      if (params.until) predictionsFilter.until = params.until;
      if (params.limit) predictionsFilter.limit = params.limit;
      if (params.offset != null) predictionsFilter.offset = params.offset;
      if (params.minVolume24hr != null) predictionsFilter.minVolume24hr = params.minVolume24hr;
      if (params.minLiquidity != null) predictionsFilter.minLiquidity = params.minLiquidity;
      if (params.onlyOpen != null) predictionsFilter.onlyOpen = params.onlyOpen;
      const query = buildEnrichQuery(['predictions'] as EnrichmentField[], { predictionsFilter });
      const result = await safeCall(() =>
        client.request<Entity>(query, { id: params.ticker.toUpperCase(), predictionsFilter }),
      );
      if (!result.ok) return result.toolResult;
      const entity = result.data;
      if (!entity.predictions?.length) {
        return { content: `No prediction markets found for ${params.ticker}.` };
      }
      return {
        content: `# ${formatAssetLabel(entity.name, params.ticker)} — Prediction Markets\n\n${formatPredictions(entity.predictions as PredictionMarket[])}`,
      };
    },
  };

  const getDiscussions: ToolDefinition = {
    name: 'get_discussions',
    description:
      'Get Hacker News discussions related to a ticker or company. Returns top stories with ' +
      'points, comment count, and top comments.\n\n' +
      'NOTE: This is a costly query — only use when the user explicitly asks about tech community ' +
      'discussion, HN sentiment, or developer/investor commentary for a specific asset.',
    parameters: z.object({
      ticker: z.string().min(1).describe('Ticker symbol (e.g. NVDA, MSFT, AAPL)'),
      since: z
        .string()
        .optional()
        .describe('ISO timestamp — only return stories published after this date (e.g. "2026-04-01T00:00:00Z")'),
      until: z.string().optional().describe('ISO timestamp — only return stories published before this date'),
      limit: z.number().int().min(1).max(50).optional().describe('Max stories to return (default 20)'),
      offset: z.number().int().nonnegative().optional().describe('Rows to skip for pagination (default 0)'),
      minPoints: z.number().int().nonnegative().optional().describe('Only include stories with points >= this value'),
      minComments: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe('Only include stories with comment count >= this value'),
    }),
    async execute(params: {
      ticker: string;
      since?: string;
      until?: string;
      limit?: number;
      offset?: number;
      minPoints?: number;
      minComments?: number;
    }): Promise<ToolResult> {
      if (!options.client) return notConfigured();
      const client = options.client;
      const discussionsFilter: NonNullable<EnrichOptions['discussionsFilter']> = { sort: 'DESC' };
      if (params.since) discussionsFilter.since = params.since;
      if (params.until) discussionsFilter.until = params.until;
      if (params.limit) discussionsFilter.limit = params.limit;
      if (params.offset != null) discussionsFilter.offset = params.offset;
      if (params.minPoints != null) discussionsFilter.minPoints = params.minPoints;
      if (params.minComments != null) discussionsFilter.minComments = params.minComments;
      const query = buildEnrichQuery(['discussions'] as EnrichmentField[], { discussionsFilter });
      const result = await safeCall(() =>
        client.request<Entity>(query, { id: params.ticker.toUpperCase(), discussionsFilter }),
      );
      if (!result.ok) return result.toolResult;
      const entity = result.data;
      if (!entity.discussions?.length) {
        return { content: `No Hacker News discussions found for ${params.ticker}.` };
      }
      return {
        content: `# ${formatAssetLabel(entity.name, params.ticker)} — Discussions\n\n${formatDiscussions(entity.discussions as HackerNewsStory[])}`,
      };
    },
  };

  const getFinancials: ToolDefinition = {
    name: 'get_financials',
    description:
      'Get financial statements for an equity ticker — income statement, balance sheet, and cash flow. ' +
      'Returns revenue, net income, EPS, EBITDA, free cash flow, debt, equity, and more.\n\n' +
      'Equity-only: returns no data for crypto or ETFs. Use for valuation analysis, earnings quality, ' +
      'balance sheet health, or comparing periods. Narrow by period with periodTypes ' +
      "(e.g. ['12M'] for annual, ['3M'] for quarterly), or cap rows with limit.",
    parameters: z.object({
      ticker: z.string().min(1).describe('Equity ticker symbol (e.g. AAPL, NVDA, MSFT)'),
      periodTypes: z
        .array(z.string())
        .optional()
        .describe("Restrict to period-type codes (e.g. ['12M'] for annual only, ['3M'] for quarterly only)"),
      since: z.string().optional().describe('ISO date — only include periods ending on/after this date'),
      until: z.string().optional().describe('ISO date — only include periods ending on/before this date'),
      limit: z.number().int().min(1).max(40).optional().describe('Max periods per statement (server default applies)'),
    }),
    async execute(params: {
      ticker: string;
      periodTypes?: string[];
      since?: string;
      until?: string;
      limit?: number;
    }): Promise<ToolResult> {
      if (!options.client) return notConfigured();
      const client = options.client;
      const ticker = params.ticker.toUpperCase();
      const financialStatementsFilter: Record<string, unknown> = { sort: 'DESC' };
      if (params.limit != null) financialStatementsFilter.limit = params.limit;
      if (params.periodTypes?.length) financialStatementsFilter.periodTypes = params.periodTypes;
      if (params.since) financialStatementsFilter.since = params.since;
      if (params.until) financialStatementsFilter.until = params.until;
      const query = buildEnrichQuery(['financials'] as EnrichmentField[], {
        financialStatementsFilter: financialStatementsFilter as EnrichOptions['financialStatementsFilter'],
      });
      const result = await safeCall(() => client.request<Entity>(query, { id: ticker, financialStatementsFilter }));
      if (!result.ok) return result.toolResult;
      const entity = result.data;
      if (!entity.financials) {
        return {
          content: `No financial statement data available for ${params.ticker}. (Equity-only field — not available for crypto or ETFs.)`,
        };
      }
      return {
        content: `# ${formatAssetLabel(entity.name, params.ticker)} — Financial Statements\n\n${formatFinancials(entity.financials)}`,
      };
    },
  };

  const getExecutives: ToolDefinition = {
    name: 'get_executives',
    description:
      'Get key executives and officers for an equity ticker — names, titles, compensation, and age.\n\n' +
      'Equity-only: returns no data for crypto or ETFs. Use when the user asks about management, ' +
      'leadership, CEO, board composition, or executive compensation. Narrow by minPay, cap rows with limit, ' +
      'or reorder with sortBy (PAY_DESC | PAY_ASC | NAME_ASC | NAME_DESC).',
    parameters: z.object({
      ticker: z.string().min(1).describe('Equity ticker symbol (e.g. AAPL, TSLA, NVDA)'),
      minPay: z.number().positive().optional().describe('Only include executives with annual pay >= this USD amount'),
      limit: z.number().int().min(1).max(50).optional().describe('Max executives to return (default 20)'),
      sortBy: z
        .enum(['PAY_DESC', 'PAY_ASC', 'NAME_ASC', 'NAME_DESC'])
        .optional()
        .describe('Sort order (default PAY_DESC)'),
    }),
    async execute(params: {
      ticker: string;
      minPay?: number;
      limit?: number;
      sortBy?: 'PAY_DESC' | 'PAY_ASC' | 'NAME_ASC' | 'NAME_DESC';
    }): Promise<ToolResult> {
      if (!options.client) return notConfigured();
      const client = options.client;
      const ticker = params.ticker.toUpperCase();
      const executivesFilter: Record<string, unknown> = {};
      if (params.minPay != null) executivesFilter.minPay = params.minPay;
      if (params.limit != null) executivesFilter.limit = params.limit;
      if (params.sortBy) executivesFilter.sortBy = params.sortBy;
      const query = buildEnrichQuery(['executives'] as EnrichmentField[], {
        executivesFilter: executivesFilter as EnrichOptions['executivesFilter'],
      });
      const result = await safeCall(() => client.request<Entity>(query, { id: ticker, executivesFilter }));
      if (!result.ok) return result.toolResult;
      const entity = result.data;
      if (!entity.executives?.length) {
        return {
          content: `No executive data available for ${params.ticker}. (Equity-only field — not available for crypto or ETFs.)`,
        };
      }
      return {
        content: `# ${formatAssetLabel(entity.name, params.ticker)} — Key Executives\n\n${formatExecutives(entity.executives)}`,
      };
    },
  };

  const getInsiderTrades: ToolDefinition = {
    name: 'get_insider_trades',
    description:
      'Get recent insider trades (SEC Form 4) for an equity ticker — officers, directors, and 10% owners ' +
      'reporting share acquisitions/dispositions with transaction codes, prices, and 10b5-1 plan flags.\n\n' +
      'Equity-only: returns no data for crypto or ETFs. Use when the user asks about insider buying/selling, ' +
      'CEO/CFO transactions, Form 4 filings, or tracking insider sentiment on a specific stock. Narrow by ' +
      'role flags (isOfficer/isDirector/isTenPercentOwner), acquiredDisposed (A/D), transactionCodes ' +
      '(P=open-market buy, S=open-market sale, F=tax withholding, etc.), onlyUnder10b5One, or minValue.',
    parameters: z.object({
      ticker: z.string().min(1).describe('Equity ticker symbol (e.g. AAPL, NVDA, MSFT)'),
      since: z.string().optional().describe('ISO date — only include transactions filed on/after this date'),
      until: z.string().optional().describe('ISO date — only include transactions filed on/before this date'),
      limit: z.number().int().min(1).max(200).optional().describe('Max trades to return (default 20)'),
      isOfficer: z.boolean().optional().describe('Only include transactions by officers'),
      isDirector: z.boolean().optional().describe('Only include transactions by directors'),
      isTenPercentOwner: z.boolean().optional().describe('Only include transactions by 10% owners'),
      onlyUnder10b5One: z.boolean().optional().describe('Only include transactions under a Rule 10b5-1 plan'),
      transactionCodes: z
        .array(z.string())
        .optional()
        .describe('Restrict to Form 4 transaction codes (P, S, A, F, M, G, J, D)'),
      acquiredDisposed: z.enum(['ACQUIRED', 'DISPOSED']).optional().describe('Restrict to acquisitions or disposals'),
      minValue: z
        .number()
        .positive()
        .optional()
        .describe('Only include transactions with transactionValue >= this USD amount'),
    }),
    async execute(params: {
      ticker: string;
      since?: string;
      until?: string;
      limit?: number;
      isOfficer?: boolean;
      isDirector?: boolean;
      isTenPercentOwner?: boolean;
      onlyUnder10b5One?: boolean;
      transactionCodes?: string[];
      acquiredDisposed?: 'ACQUIRED' | 'DISPOSED';
      minValue?: number;
    }): Promise<ToolResult> {
      if (!options.client) return notConfigured();
      const client = options.client;
      const ticker = params.ticker.toUpperCase();
      const insiderTradesFilter: Record<string, unknown> = { sort: 'DESC' };
      if (params.since) insiderTradesFilter.since = params.since;
      if (params.until) insiderTradesFilter.until = params.until;
      if (params.limit) insiderTradesFilter.limit = params.limit;
      if (params.isOfficer != null) insiderTradesFilter.isOfficer = params.isOfficer;
      if (params.isDirector != null) insiderTradesFilter.isDirector = params.isDirector;
      if (params.isTenPercentOwner != null) insiderTradesFilter.isTenPercentOwner = params.isTenPercentOwner;
      if (params.onlyUnder10b5One != null) insiderTradesFilter.onlyUnder10b5One = params.onlyUnder10b5One;
      if (params.transactionCodes?.length) insiderTradesFilter.transactionCodes = params.transactionCodes;
      if (params.acquiredDisposed) insiderTradesFilter.acquiredDisposed = params.acquiredDisposed;
      if (params.minValue != null) insiderTradesFilter.minValue = params.minValue;
      const query = buildEnrichQuery(['insiderTrades'] as EnrichmentField[], {
        insiderTradesFilter: insiderTradesFilter as EnrichOptions['insiderTradesFilter'],
      });
      const result = await safeCall(() => client.request<Entity>(query, { id: ticker, insiderTradesFilter }));
      if (!result.ok) return result.toolResult;
      const entity = result.data;
      if (!entity.insiderTrades?.length) {
        return {
          content: `No insider trades available for ${ticker}. (Equity-only field — not available for crypto or ETFs.)`,
        };
      }
      return {
        content: `# ${formatAssetLabel(entity.name, ticker)} — Insider Trades (Form 4)\n\n${formatInsiderTrades(entity.insiderTrades)}`,
      };
    },
  };

  const getEarningsPressReleases: ToolDefinition = {
    name: 'get_earnings_press_releases',
    description:
      'Get recent earnings press releases (8-K filings with item 2.02) for an equity ticker — filing dates, ' +
      'excerpts, body length, and links to the EX-99.1 press release attachment.\n\n' +
      'Equity-only: returns no data for crypto or ETFs. Use when the user asks about the latest earnings release, ' +
      '8-K filings, earnings announcements, or wants to read the actual press release text.',
    parameters: z.object({
      ticker: z.string().min(1).describe('Equity ticker symbol (e.g. AAPL, NVDA, MSFT)'),
      since: z.string().optional().describe('ISO date — only include releases filed on/after this date'),
      until: z.string().optional().describe('ISO date — only include releases filed on/before this date'),
      limit: z.number().int().min(1).max(50).optional().describe('Max releases to return (default 8)'),
    }),
    async execute(params: { ticker: string; since?: string; until?: string; limit?: number }): Promise<ToolResult> {
      if (!options.client) return notConfigured();
      const client = options.client;
      const ticker = params.ticker.toUpperCase();
      const { opts } = buildFilter(params.since, params.limit);
      if (params.until) opts.until = params.until;
      const query = buildEnrichQuery(['earningsPressReleases'] as EnrichmentField[], opts);
      const vars: Record<string, unknown> = { id: ticker, filter: opts };
      const result = await safeCall(() => client.request<Entity>(query, vars));
      if (!result.ok) return result.toolResult;
      const entity = result.data;
      if (!entity.earningsPressReleases?.length) {
        return {
          content: `No earnings press releases available for ${ticker}. (Equity-only field — not available for crypto or ETFs.)`,
        };
      }
      return {
        content: `# ${formatAssetLabel(entity.name, ticker)} — Earnings Press Releases\n\n${formatEarningsPressReleases(entity.earningsPressReleases)}`,
      };
    },
  };

  const getSegmentedRevenue: ToolDefinition = {
    name: 'get_segmented_revenue',
    description:
      'Get revenue broken down by product, segment, or geography for an equity ticker — parsed from XBRL data ' +
      'in 10-K/10-Q filings. Returns the segment label, period, and dollar value per dimension.\n\n' +
      'Equity-only: returns no data for crypto or ETFs. Use when the user asks about revenue mix, product-line ' +
      'performance, geographic concentration, or segment-by-segment revenue breakdowns. Narrow with ' +
      '`dimensions` (PRODUCT, SEGMENT, GEOGRAPHY) or `minValue` (USD) to focus on material segments.',
    parameters: z.object({
      ticker: z.string().min(1).describe('Equity ticker symbol (e.g. AAPL, NVDA, MSFT)'),
      since: z.string().optional().describe('ISO date — only include filings on/after this date'),
      until: z.string().optional().describe('ISO date — only include filings on/before this date'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(500)
        .optional()
        .describe('Max segment rows to return (default 100 — one filing can emit many rows)'),
      dimensions: z
        .array(z.enum(['PRODUCT', 'SEGMENT', 'GEOGRAPHY']))
        .optional()
        .describe('Restrict to one or more breakdown dimensions'),
      minValue: z.number().positive().optional().describe('Only include rows with value >= this USD amount'),
    }),
    async execute(params: {
      ticker: string;
      since?: string;
      until?: string;
      limit?: number;
      dimensions?: Array<'PRODUCT' | 'SEGMENT' | 'GEOGRAPHY'>;
      minValue?: number;
    }): Promise<ToolResult> {
      if (!options.client) return notConfigured();
      const client = options.client;
      const ticker = params.ticker.toUpperCase();
      const segmentedRevenueFilter: Record<string, unknown> = { sort: 'DESC' };
      if (params.since) segmentedRevenueFilter.since = params.since;
      if (params.until) segmentedRevenueFilter.until = params.until;
      if (params.limit) segmentedRevenueFilter.limit = params.limit;
      if (params.dimensions?.length) segmentedRevenueFilter.dimensions = params.dimensions;
      if (params.minValue != null) segmentedRevenueFilter.minValue = params.minValue;
      const query = buildEnrichQuery(['segmentedRevenue'] as EnrichmentField[], {
        segmentedRevenueFilter: segmentedRevenueFilter as EnrichOptions['segmentedRevenueFilter'],
      });
      const result = await safeCall(() => client.request<Entity>(query, { id: ticker, segmentedRevenueFilter }));
      if (!result.ok) return result.toolResult;
      const entity = result.data;
      if (!entity.segmentedRevenue?.length) {
        return {
          content: `No segmented revenue data available for ${ticker}. (Equity-only field — not available for crypto or ETFs.)`,
        };
      }
      return {
        content: `# ${formatAssetLabel(entity.name, ticker)} — Segmented Revenue\n\n${formatSegmentedRevenue(entity.segmentedRevenue)}`,
      };
    },
  };

  const getEarningsCalendar: ToolDefinition = {
    name: 'get_earnings_calendar',
    description:
      'Get forward earnings calendar + recent reports for an equity ticker. Returns reportDate, fiscal quarter/year, ' +
      'actual vs estimate EPS and revenue (with surprise %), and release timing (BMO = before market open, ' +
      'AMC = after market close, DMH = during market hours).\n\n' +
      'Equity-only: returns no data for crypto or ETFs. Use when the user asks "when does X report earnings?", ' +
      '"what was the EPS surprise last quarter?", or needs to check upcoming earnings timing for event-risk positioning. ' +
      'Narrow with `onlyReported`/`onlyUpcoming`, `minSurprisePercent` (absolute EPS surprise), or `year`.',
    parameters: z.object({
      ticker: z.string().min(1).describe('Equity ticker symbol (e.g. AAPL, NVDA, MSFT)'),
      since: z.string().optional().describe('ISO date — only include reports on/after this date'),
      until: z.string().optional().describe('ISO date — only include reports on/before this date'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(40)
        .optional()
        .describe('Max reports to return (default 8 — ~2 years of quarters)'),
      onlyReported: z.boolean().optional().describe('Only include periods already reported (epsActual is set)'),
      onlyUpcoming: z.boolean().optional().describe('Only include forward-looking periods not yet reported'),
      minSurprisePercent: z
        .number()
        .nonnegative()
        .optional()
        .describe('Only reported periods with absolute EPS surprise >= this percent'),
      year: z.number().int().optional().describe('Restrict to a single fiscal year'),
    }),
    async execute(params: {
      ticker: string;
      since?: string;
      until?: string;
      limit?: number;
      onlyReported?: boolean;
      onlyUpcoming?: boolean;
      minSurprisePercent?: number;
      year?: number;
    }): Promise<ToolResult> {
      if (!options.client) return notConfigured();
      const client = options.client;
      const ticker = params.ticker.toUpperCase();
      const earningsFilter: Record<string, unknown> = { sort: 'DESC', limit: params.limit ?? 8 };
      if (params.since) earningsFilter.since = params.since;
      if (params.until) earningsFilter.until = params.until;
      if (params.onlyReported != null) earningsFilter.onlyReported = params.onlyReported;
      if (params.onlyUpcoming != null) earningsFilter.onlyUpcoming = params.onlyUpcoming;
      if (params.minSurprisePercent != null) earningsFilter.minSurprisePercent = params.minSurprisePercent;
      if (params.year != null) earningsFilter.year = params.year;
      const query = buildEnrichQuery(['earnings'] as EnrichmentField[], {
        earningsFilter: earningsFilter as EnrichOptions['earningsFilter'],
      });
      const result = await safeCall(() => client.request<Entity>(query, { id: ticker, earningsFilter }));
      if (!result.ok) return result.toolResult;
      const entity = result.data;
      if (!entity.earnings?.length) {
        return {
          content: `No earnings calendar data available for ${ticker}. (Equity-only field — not available for crypto or ETFs.)`,
        };
      }
      return {
        content: `# ${formatAssetLabel(entity.name, ticker)} — Earnings Calendar\n\n${formatEarningsCalendar(entity.earnings)}`,
      };
    },
  };

  const getPeriodicFiling: ToolDefinition = {
    name: 'get_periodic_filing',
    description:
      'Get parsed sections from recent 10-K and 10-Q filings (Risk Factors, MD&A, etc.) for an equity ticker. ' +
      'Each section is extracted from the raw SEC filing with HTML stripped. By default returns 300-char excerpts ' +
      'per section — pass `fullBody: true` for the complete text (up to 50K chars per section).\n\n' +
      'Common section items: "1A" = Risk Factors, "7" = Management Discussion & Analysis (MD&A), ' +
      '"7A" = Quantitative & Qualitative Market Risk (10-K), "II-1A" = Part II Item 1A update (10-Q).\n\n' +
      'Equity-only: returns no data for crypto or ETFs. Use when the user asks "what are the risk factors for X?", ' +
      '"summarize management\'s discussion from the latest 10-K", or needs deep qualitative research from filings.',
    parameters: z.object({
      ticker: z.string().min(1).describe('Equity ticker symbol (e.g. AAPL, NVDA, MSFT)'),
      items: z
        .array(z.string())
        .optional()
        .describe('Restrict to specific section items (e.g. ["1A", "7"]). Omit for all sections.'),
      fullBody: z
        .boolean()
        .optional()
        .describe('Return full section bodies (up to 50K chars each) instead of 300-char excerpts. Default: false.'),
      since: z.string().optional().describe('ISO date — only include filings on/after this date'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(10)
        .optional()
        .describe('Max filings to return (default 2 — latest 10-K + 10-Q)'),
    }),
    async execute(params: {
      ticker: string;
      items?: string[];
      fullBody?: boolean;
      since?: string;
      limit?: number;
    }): Promise<ToolResult> {
      if (!options.client) return notConfigured();
      const client = options.client;
      const ticker = params.ticker.toUpperCase();
      const { opts } = buildFilter(params.since, params.limit ?? 2);
      const query = buildEnrichQuery(['periodicFilings'] as EnrichmentField[], opts);
      const vars: Record<string, unknown> = { id: ticker, filter: opts };
      const result = await safeCall(() => client.request<Entity>(query, vars));
      if (!result.ok) return result.toolResult;
      const entity = result.data;
      if (!entity.periodicFilings?.length) {
        return {
          content: `No periodic filings (10-K/10-Q) available for ${ticker}. (Equity-only field — not available for crypto or ETFs.)`,
        };
      }
      return {
        content: `# ${formatAssetLabel(entity.name, ticker)} — Periodic Filings (10-K / 10-Q)\n\n${formatPeriodicFilings(entity.periodicFilings, params.items, params.fullBody)}`,
      };
    },
  };

  const jintelQuery: ToolDefinition = {
    name: 'jintel_query',
    description:
      'Generic Jintel query tool for quotes, fundamentals, market data, history, news, research, sentiment, ' +
      'technicals, derivatives, risk, regulatory, short_interest, financials, executives, institutional_holdings, ' +
      'ownership, top_holders, insider_trades, earnings_press_releases, segmented_revenue, earnings_calendar, ' +
      'periodic_filing, analyst_consensus, or market_status. Use this when you want one Jintel-backed entry point ' +
      'instead of choosing a more specialized tool.',
    parameters: z.object({
      kind: JINTEL_QUERY_KIND.describe(
        'What to fetch: quote, market, fundamentals, history, news, research, sentiment, technicals, derivatives, risk, regulatory, short_interest, financials, executives, institutional_holdings, ownership, top_holders, insider_trades, earnings_press_releases, segmented_revenue, earnings_calendar, periodic_filing, analyst_consensus, or market_status',
      ),
      ticker: z
        .string()
        .optional()
        .describe('Single ticker symbol (e.g. AAPL, BTC, NVDA) or CIK for institutional_holdings'),
      tickers: z.array(z.string()).optional().describe('Ticker batch for quote/history queries'),
      range: z.string().optional().describe('History range for history queries (default "1y")'),
      interval: z.string().optional().describe('History interval for history queries (default "1d")'),
    }),
    async execute(params: {
      kind: JintelQueryKind;
      ticker?: string;
      tickers?: string[];
      range?: string;
      interval?: string;
    }): Promise<ToolResult> {
      if (!options.client) return notConfigured();

      const normalizedTickers =
        params.tickers?.map((ticker) => ticker.toUpperCase()) ?? (params.ticker ? [params.ticker.toUpperCase()] : []);
      const singleTicker = normalizedTickers[0];

      if ((params.kind === 'quote' || params.kind === 'history') && normalizedTickers.length === 0) {
        return { content: `jintel_query kind "${params.kind}" requires "ticker" or "tickers".`, isError: true };
      }

      const kindRequiresNoTicker = params.kind === 'market_status';
      if (
        !kindRequiresNoTicker &&
        params.kind !== 'quote' &&
        params.kind !== 'history' &&
        (!singleTicker || normalizedTickers.length !== 1)
      ) {
        return { content: `jintel_query kind "${params.kind}" requires exactly one ticker.`, isError: true };
      }

      switch (params.kind) {
        case 'quote':
          return marketQuotes.execute({ tickers: normalizedTickers });
        case 'history':
          return priceHistory.execute({
            tickers: normalizedTickers,
            range: params.range,
            interval: params.interval,
          });
        case 'market':
        case 'fundamentals':
          return enrichEntity.execute({ ticker: singleTicker, fields: ['market'] });
        case 'risk':
          return enrichEntity.execute({ ticker: singleTicker, fields: ['risk'] });
        case 'regulatory':
          return enrichEntity.execute({ ticker: singleTicker, fields: ['regulatory'] });
        case 'news':
          return getNews.execute({ ticker: singleTicker });
        case 'research':
          return getResearch.execute({ ticker: singleTicker });
        case 'sentiment':
          return getSentiment.execute({ ticker: singleTicker });
        case 'technicals':
          return runTechnical.execute({ ticker: singleTicker });
        case 'derivatives':
          return getDerivatives.execute({ ticker: singleTicker });
        case 'short_interest':
          return getShortInterest.execute({ ticker: singleTicker });
        case 'financials':
          return getFinancials.execute({ ticker: singleTicker });
        case 'executives':
          return getExecutives.execute({ ticker: singleTicker });
        case 'institutional_holdings':
          return getInstitutionalHoldings.execute({ cik: singleTicker });
        case 'ownership':
          return getOwnership.execute({ ticker: singleTicker });
        case 'top_holders':
          return getTopHolders.execute({ ticker: singleTicker });
        case 'insider_trades':
          return getInsiderTrades.execute({ ticker: singleTicker });
        case 'earnings_press_releases':
          return getEarningsPressReleases.execute({ ticker: singleTicker });
        case 'segmented_revenue':
          return getSegmentedRevenue.execute({ ticker: singleTicker });
        case 'earnings_calendar':
          return getEarningsCalendar.execute({ ticker: singleTicker });
        case 'periodic_filing':
          return getPeriodicFiling.execute({ ticker: singleTicker });
        case 'analyst_consensus':
          return getAnalystConsensus.execute({ ticker: singleTicker });
        case 'market_status':
          return marketStatus.execute({});
      }

      return { content: `Unsupported Jintel query kind: ${params.kind}`, isError: true };
    },
  };

  const getClinicalTrials: ToolDefinition = {
    name: 'get_clinical_trials',
    description:
      'Get ClinicalTrials.gov studies where the ticker is the lead sponsor or collaborator. Returns NCT id, ' +
      'phase, status, conditions, interventions, dates, and enrollment count.\n\n' +
      'Use for biotech/pharma/medical-device tickers when the user asks about pipeline, trial phase progression, ' +
      'readouts, or catalysts. Filter by `phase` (e.g. "PHASE3") or `status` (e.g. "RECRUITING", "COMPLETED") ' +
      'to narrow to late-stage or active studies.',
    parameters: z.object({
      ticker: z.string().min(1).describe('Ticker symbol of the sponsor/collaborator (e.g. PFE, MRNA, LLY)'),
      phase: z.string().optional().describe('Case-insensitive phase match (e.g. "PHASE3" or partial "PHASE")'),
      status: z
        .string()
        .optional()
        .describe('Exact status (e.g. "RECRUITING", "COMPLETED", "TERMINATED", "ACTIVE_NOT_RECRUITING")'),
      since: z.string().optional().describe('ISO date — only trials with startDate on/after this date'),
      until: z.string().optional().describe('ISO date — only trials with startDate on/before this date'),
      limit: z.number().int().min(1).max(100).optional().describe('Max trials to return (default 20)'),
      offset: z.number().int().nonnegative().optional().describe('Rows to skip for pagination (default 0)'),
    }),
    async execute(params: {
      ticker: string;
      phase?: string;
      status?: string;
      since?: string;
      until?: string;
      limit?: number;
      offset?: number;
    }): Promise<ToolResult> {
      if (!options.client) return notConfigured();
      const client = options.client;

      const clinicalTrialsFilter: ClinicalTrialFilterOptions = { sort: 'DESC' };
      if (params.phase) clinicalTrialsFilter.phase = params.phase;
      if (params.status) clinicalTrialsFilter.status = params.status;
      if (params.since) clinicalTrialsFilter.since = params.since;
      if (params.until) clinicalTrialsFilter.until = params.until;
      if (params.limit) clinicalTrialsFilter.limit = params.limit;
      if (params.offset != null) clinicalTrialsFilter.offset = params.offset;

      const query = buildEnrichQuery(['clinicalTrials'] as EnrichmentField[], { clinicalTrialsFilter });
      const result = await safeCall(() =>
        client.request<Entity>(query, { id: params.ticker.toUpperCase(), clinicalTrialsFilter }),
      );
      if (!result.ok) return result.toolResult;

      const entity = result.data;
      const trials = entity.clinicalTrials ?? [];
      if (trials.length === 0) {
        return { content: `No clinical trials found for ${params.ticker}.` };
      }
      return {
        content: `# ${formatAssetLabel(entity.name, params.ticker)} — Clinical Trials (${trials.length})\n\n${formatClinicalTrials(trials)}`,
      };
    },
  };

  const getFdaEvents: ToolDefinition = {
    name: 'get_fda_events',
    description:
      'Get openFDA events for a ticker — adverse event reports (drugs, devices) and drug enforcement/recall ' +
      'actions. Returns event type (DRUG_ADVERSE, DEVICE_ADVERSE, DRUG_RECALL), severity (recall class I/II/III ' +
      'or outcome flag), product name, and a summary narrative.\n\n' +
      'Use for biotech/pharma/medical-device tickers when the user asks about safety, recalls, regulatory risk, ' +
      'or adverse outcomes. Class I recalls = highest risk (serious injury/death). Filter by `types` or ' +
      '`severity` to narrow.',
    parameters: z.object({
      ticker: z.string().min(1).describe('Ticker symbol (e.g. PFE, JNJ, MDT)'),
      types: z
        .array(FDA_EVENT_TYPE)
        .optional()
        .describe('Restrict to event kinds (e.g. ["DRUG_RECALL"], ["DRUG_ADVERSE", "DEVICE_ADVERSE"])'),
      severity: z
        .string()
        .optional()
        .describe(
          'Exact severity match — "CLASS I", "CLASS II", "CLASS III" for recalls; outcome flag for adverse events',
        ),
      since: z.string().optional().describe('ISO date — only events with reportDate on/after this date'),
      until: z.string().optional().describe('ISO date — only events with reportDate on/before this date'),
      limit: z.number().int().min(1).max(100).optional().describe('Max events to return (default 20)'),
      offset: z.number().int().nonnegative().optional().describe('Rows to skip for pagination (default 0)'),
    }),
    async execute(params: {
      ticker: string;
      types?: FdaEventType[];
      severity?: string;
      since?: string;
      until?: string;
      limit?: number;
      offset?: number;
    }): Promise<ToolResult> {
      if (!options.client) return notConfigured();
      const client = options.client;

      const fdaEventsFilter: FdaEventFilterOptions = { sort: 'DESC' };
      if (params.types?.length) fdaEventsFilter.types = params.types;
      if (params.severity) fdaEventsFilter.severity = params.severity;
      if (params.since) fdaEventsFilter.since = params.since;
      if (params.until) fdaEventsFilter.until = params.until;
      if (params.limit) fdaEventsFilter.limit = params.limit;
      if (params.offset != null) fdaEventsFilter.offset = params.offset;

      const query = buildEnrichQuery(['fdaEvents'] as EnrichmentField[], { fdaEventsFilter });
      const result = await safeCall(() =>
        client.request<Entity>(query, { id: params.ticker.toUpperCase(), fdaEventsFilter }),
      );
      if (!result.ok) return result.toolResult;

      const entity = result.data;
      const events = entity.fdaEvents ?? [];
      if (events.length === 0) {
        return { content: `No FDA events found for ${params.ticker}.` };
      }
      return {
        content: `# ${formatAssetLabel(entity.name, params.ticker)} — FDA Events (${events.length})\n\n${formatFdaEvents(events)}`,
      };
    },
  };

  const getLitigation: ToolDefinition = {
    name: 'get_litigation',
    description:
      'Get US federal court litigation for a ticker (from CourtListener/RECAP). Returns case name, court, ' +
      'docket number, filing/termination dates, nature of suit, and a link to the docket.\n\n' +
      'Use when the user asks about legal exposure, active lawsuits, patent/antitrust/securities cases, or ' +
      'court-driven catalysts. Set `onlyActive: true` to drop terminated cases. Filter by `natureOfSuit` ' +
      '(e.g. "PATENT", "ANTITRUST", "SECURITIES") or `court` substring.',
    parameters: z.object({
      ticker: z.string().min(1).describe('Ticker symbol of a party in the case (e.g. AAPL, META, GOOGL)'),
      onlyActive: z.boolean().optional().describe('Only include cases with no dateTerminated (still open)'),
      court: z
        .string()
        .optional()
        .describe('Case-insensitive substring against court name/citation (e.g. "N.D. CAL", "S.D.N.Y.")'),
      natureOfSuit: z
        .string()
        .optional()
        .describe('Case-insensitive substring against nature of suit (e.g. "PATENT", "ANTITRUST", "SECURITIES")'),
      since: z.string().optional().describe('ISO date — only cases with dateFiled on/after this date'),
      until: z.string().optional().describe('ISO date — only cases with dateFiled on/before this date'),
      limit: z.number().int().min(1).max(100).optional().describe('Max cases to return (default 20)'),
      offset: z.number().int().nonnegative().optional().describe('Rows to skip for pagination (default 0)'),
    }),
    async execute(params: {
      ticker: string;
      onlyActive?: boolean;
      court?: string;
      natureOfSuit?: string;
      since?: string;
      until?: string;
      limit?: number;
      offset?: number;
    }): Promise<ToolResult> {
      if (!options.client) return notConfigured();
      const client = options.client;

      const litigationFilter: LitigationFilterOptions = { sort: 'DESC' };
      if (params.onlyActive != null) litigationFilter.onlyActive = params.onlyActive;
      if (params.court) litigationFilter.court = params.court;
      if (params.natureOfSuit) litigationFilter.natureOfSuit = params.natureOfSuit;
      if (params.since) litigationFilter.since = params.since;
      if (params.until) litigationFilter.until = params.until;
      if (params.limit) litigationFilter.limit = params.limit;
      if (params.offset != null) litigationFilter.offset = params.offset;

      const query = buildEnrichQuery(['litigation'] as EnrichmentField[], { litigationFilter });
      const result = await safeCall(() =>
        client.request<Entity>(query, { id: params.ticker.toUpperCase(), litigationFilter }),
      );
      if (!result.ok) return result.toolResult;

      const entity = result.data;
      const cases = entity.litigation ?? [];
      if (cases.length === 0) {
        return { content: `No litigation cases found for ${params.ticker}.` };
      }
      return {
        content: `# ${formatAssetLabel(entity.name, params.ticker)} — Litigation (${cases.length})\n\n${formatLitigation(cases)}`,
      };
    },
  };

  const getGovernmentContracts: ToolDefinition = {
    name: 'get_government_contracts',
    description:
      'Get USASpending.gov federal contract awards for a ticker. Returns award ID, recipient, amount (USD), ' +
      'awarding agency, award type, action date, and description.\n\n' +
      'Use for defense/government-exposed tickers (e.g. LMT, RTX, BA, GD, PLTR) when the user asks about ' +
      'contract wins, backlog, agency concentration, or defense-budget exposure. Filter by `minAmount` (USD) ' +
      'to drop small awards.',
    parameters: z.object({
      ticker: z.string().min(1).describe('Ticker symbol of the contract recipient (e.g. LMT, RTX, PLTR)'),
      minAmount: z
        .number()
        .nonnegative()
        .optional()
        .describe('Only contracts with amount >= this value in USD (e.g. 1000000 for $1M+)'),
      since: z.string().optional().describe('ISO date — only contracts with actionDate on/after this date'),
      until: z.string().optional().describe('ISO date — only contracts with actionDate on/before this date'),
      limit: z.number().int().min(1).max(100).optional().describe('Max contracts to return (default 20)'),
      offset: z.number().int().nonnegative().optional().describe('Rows to skip for pagination (default 0)'),
    }),
    async execute(params: {
      ticker: string;
      minAmount?: number;
      since?: string;
      until?: string;
      limit?: number;
      offset?: number;
    }): Promise<ToolResult> {
      if (!options.client) return notConfigured();
      const client = options.client;

      const governmentContractsFilter: GovernmentContractFilterOptions = { sort: 'DESC' };
      if (params.minAmount != null) governmentContractsFilter.minAmount = params.minAmount;
      if (params.since) governmentContractsFilter.since = params.since;
      if (params.until) governmentContractsFilter.until = params.until;
      if (params.limit) governmentContractsFilter.limit = params.limit;
      if (params.offset != null) governmentContractsFilter.offset = params.offset;

      const query = buildEnrichQuery(['governmentContracts'] as EnrichmentField[], { governmentContractsFilter });
      const result = await safeCall(() =>
        client.request<Entity>(query, { id: params.ticker.toUpperCase(), governmentContractsFilter }),
      );
      if (!result.ok) return result.toolResult;

      const entity = result.data;
      const contracts = entity.governmentContracts ?? [];
      if (contracts.length === 0) {
        return { content: `No government contracts found for ${params.ticker}.` };
      }
      return {
        content: `# ${formatAssetLabel(entity.name, params.ticker)} — Government Contracts (${contracts.length})\n\n${formatGovernmentContracts(contracts)}`,
      };
    },
  };

  const macroSeries: ToolDefinition = {
    name: 'macro_series',
    description:
      'Get a macroeconomic time series by series id. Returns metadata (title, units, frequency, last updated) ' +
      'and observations (date/value pairs, newest first).\n\n' +
      'Use for macro context: unemployment (UNRATE), real GDP (GDPC1), CPI (CPIAUCSL), fed funds (FEDFUNDS), ' +
      '10Y Treasury (DGS10), 2s10s spread (T10Y2Y), M2 (M2SL), yield curve, etc. Prefer this over ' +
      'get_gdp/get_inflation/get_interest_rates when a specific series id is known.',
    parameters: z.object({
      seriesId: z.string().min(1).describe('Macro series id (e.g. "UNRATE", "GDPC1", "CPIAUCSL", "DGS10")'),
      since: z.string().optional().describe('ISO date — only observations on/after this date'),
      until: z.string().optional().describe('ISO date — only observations on/before this date'),
      limit: z.number().int().min(1).max(1000).optional().describe('Max observations to return (default 100)'),
    }),
    async execute(params: { seriesId: string; since?: string; until?: string; limit?: number }): Promise<ToolResult> {
      if (!options.client) return notConfigured();
      const client = options.client;
      const filter: ArraySubGraphOptions = { sort: 'DESC' };
      if (params.since) filter.since = params.since;
      if (params.until) filter.until = params.until;
      if (params.limit) filter.limit = params.limit;
      const result = await safeCall(() =>
        client.request<MacroSeries>(MACRO_SERIES, { seriesId: params.seriesId, filter }),
      );
      if (!result.ok) return result.toolResult;
      return { content: formatMacroSeries(result.data) };
    },
  };

  const macroSeriesBatch: ToolDefinition = {
    name: 'macro_series_batch',
    description:
      'Batch-fetch multiple macro series in one call. Same observations/metadata shape as `macro_series`, but ' +
      'returned for each series id. Prefer this over repeated `macro_series` calls when comparing macro series ' +
      '(e.g. ["DGS10","DGS2","T10Y2Y"] for yield-curve context, or ["UNRATE","CPIAUCSL","FEDFUNDS"] for ' +
      'inflation/employment/policy context).',
    parameters: z.object({
      seriesIds: z
        .array(z.string().min(1))
        .min(1)
        .max(20)
        .describe('Macro series ids (e.g. ["UNRATE", "CPIAUCSL", "FEDFUNDS"])'),
      since: z.string().optional().describe('ISO date — only observations on/after this date'),
      until: z.string().optional().describe('ISO date — only observations on/before this date'),
      limit: z.number().int().min(1).max(1000).optional().describe('Max observations per series (default 100)'),
    }),
    async execute(params: {
      seriesIds: string[];
      since?: string;
      until?: string;
      limit?: number;
    }): Promise<ToolResult> {
      if (!options.client) return notConfigured();
      const client = options.client;
      const filter: ArraySubGraphOptions = { sort: 'DESC' };
      if (params.since) filter.since = params.since;
      if (params.until) filter.until = params.until;
      if (params.limit) filter.limit = params.limit;
      const result = await safeCall(() =>
        client.request<MacroSeries[]>(MACRO_SERIES_BATCH, { seriesIds: params.seriesIds, filter }),
      );
      if (!result.ok) return result.toolResult;
      const seriesList = result.data;
      if (seriesList.length === 0) {
        return { content: 'No macro series returned.' };
      }
      return { content: seriesList.map(formatMacroSeries).join('\n\n---\n\n') };
    },
  };

  return [
    searchEntities,
    jintelQuery,
    enrichEntity,
    batchEnrich,
    marketQuotes,
    sanctionsScreen,
    runTechnical,
    priceHistory,
    marketStatus,
    getNews,
    getResearch,
    getSentiment,
    getAnalystConsensus,
    getDerivatives,
    getFilings,
    getRiskSignals,
    getGdp,
    getInflation,
    getInterestRates,
    getSP500Multiples,
    getShortInterest,
    getFamaFrench,
    getSocial,
    getPredictions,
    getDiscussions,
    getFinancials,
    getExecutives,
    getInstitutionalHoldings,
    getOwnership,
    getTopHolders,
    getInsiderTrades,
    getEarningsPressReleases,
    getSegmentedRevenue,
    getEarningsCalendar,
    getPeriodicFiling,
    getClinicalTrials,
    getFdaEvents,
    getLitigation,
    getGovernmentContracts,
    macroSeries,
    macroSeriesBatch,
  ];
}
