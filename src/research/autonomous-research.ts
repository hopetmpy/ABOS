import type BetterSqlite3 from "better-sqlite3";
import {
  normalizeAutonomousResearchConfig,
  type AutonomousResearchConfig,
  type AutomatonConfig,
  type AutomatonIdentity,
  type ChatMessage,
  type FinancialState,
} from "../types.js";
import {
  getActiveGoals,
  getGoalById,
  getTasksByGoal,
  insertEvent,
  insertKnowledge,
} from "../state/database.js";
import { createGoal } from "../orchestration/task-graph.js";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("research.autonomous");
const STATE_KEY = "autonomous_research.state";
const MAX_CONTEXT_GOALS = 30;
const MAX_CONTEXT_KNOWLEDGE = 20;
const MAX_OUTCOME_LENGTH = 6_000;
const MIN_EXPECTED_VALUE_SCORE = 0.3;
const MIN_FEASIBILITY_SCORE = 0.4;
const MIN_LEARNING_VALUE_SCORE = 0.3;

interface ResearchInference {
  chat(params: {
    tier: "reasoning";
    messages: ChatMessage[];
    maxTokens: number;
    temperature: number;
    responseFormat: { type: "json_object" };
  }): Promise<{ content: string }>;
}

interface ResearchCandidate {
  title: string;
  domain: string;
  hypothesis: string;
  rationale: string;
  experiment: string;
  successCriteria: string[];
  stopConditions: string[];
  noveltyChecks: string[];
  noveltyScore: number;
  expectedValueScore: number;
  feasibilityScore: number;
  learningValueScore: number;
  riskScore: number;
  estimatedCostCents: number;
}

interface DomainStats {
  attempts: number;
  successes: number;
  failures: number;
  reward: number;
}

interface DailyStarts {
  date: string;
  count: number;
}

interface AutonomousResearchState {
  version: 1;
  lastAttemptAt: string | null;
  currentGoalId: string | null;
  consecutiveFailures: number;
  pauseUntil: string | null;
  dailyStarts: DailyStarts;
  domainStats: Record<string, DomainStats>;
}

export interface AutonomousResearchTickResult {
  status:
    | "disabled"
    | "busy"
    | "cooldown"
    | "budget_blocked"
    | "failure_pause"
    | "daily_limit"
    | "no_candidate"
    | "created"
    | "error";
  goalId?: string;
  message?: string;
}

export function shouldWakeForAutonomousResearch(
  db: BetterSqlite3.Database,
  config: AutomatonConfig,
  creditsCents: number,
  now = new Date(),
): boolean {
  const researchConfig = normalizeAutonomousResearchConfig(
    config.autonomousResearch,
  );
  if (!researchConfig.enabled || getActiveGoals(db).length > 0) {
    return false;
  }
  if (
    !Number.isFinite(creditsCents) ||
    creditsCents < researchConfig.minCreditsCents ||
    creditsCents - researchConfig.reserveCreditsCents <
      researchConfig.maxGoalCostCents
  ) {
    return false;
  }

  const row = db
    .prepare("SELECT value FROM kv WHERE key = ?")
    .get(STATE_KEY) as { value: string } | undefined;
  const state = row?.value
    ? sanitizeState(safeJsonParse(row.value))
    : defaultState();
  if (state.pauseUntil && new Date(state.pauseUntil) > now) {
    return false;
  }
  const today = now.toISOString().slice(0, 10);
  if (
    state.dailyStarts.date === today &&
    state.dailyStarts.count >= researchConfig.maxGoalsPerDay
  ) {
    return false;
  }
  if (
    state.lastAttemptAt &&
    now.getTime() - new Date(state.lastAttemptAt).getTime() <
      researchConfig.cooldownMinutes * 60_000
  ) {
    return false;
  }
  return true;
}

interface HistoricalGoal {
  id: string;
  title: string;
  description: string;
  status: string;
  strategy: string | null;
  createdAt: string;
}

export class AutonomousResearchEngine {
  private readonly researchConfig: AutonomousResearchConfig;

  constructor(
    private readonly db: BetterSqlite3.Database,
    private readonly inference: ResearchInference,
    private readonly identity: AutomatonIdentity,
    config: AutomatonConfig,
  ) {
    const normalizedConfig = normalizeAutonomousResearchConfig(
      config.autonomousResearch,
    );
    this.researchConfig = {
      ...normalizedConfig,
      mission: normalizedConfig.mission ?? config.genesisPrompt,
    };
  }

  async tick(financial: FinancialState): Promise<AutonomousResearchTickResult> {
    if (!this.researchConfig.enabled) {
      return { status: "disabled" };
    }

    if (getActiveGoals(this.db).length > 0) {
      return { status: "busy" };
    }

    const state = this.loadState();
    this.reconcilePreviousGoal(state);

    const now = new Date();
    if (state.pauseUntil && new Date(state.pauseUntil) > now) {
      this.saveState(state);
      return {
        status: "failure_pause",
        message: `Autonomous research paused until ${state.pauseUntil}`,
      };
    }
    if (state.pauseUntil) {
      state.pauseUntil = null;
      state.consecutiveFailures = 0;
    }

    if (!this.hasBudget(financial)) {
      this.saveState(state);
      return { status: "budget_blocked" };
    }

    this.resetDailyCounter(state, now);
    if (state.dailyStarts.count >= this.researchConfig.maxGoalsPerDay) {
      this.saveState(state);
      return { status: "daily_limit" };
    }

    if (!this.cooldownElapsed(state, now)) {
      this.saveState(state);
      return { status: "cooldown" };
    }

    state.lastAttemptAt = now.toISOString();
    this.saveState(state);

    try {
      const history = this.loadGoalHistory();
      const candidates = await this.generateCandidates(history, state, financial);
      const selected = this.selectCandidate(candidates, history, state);

      if (!selected) {
        insertEvent(this.db, {
          type: "autonomous_research_no_candidate",
          agentAddress: this.identity.address,
          content: JSON.stringify({
            candidateCount: candidates.length,
            reason: "No candidate passed novelty, safety, feasibility, and budget gates",
          }),
          tokenCount: 0,
        });
        return { status: "no_candidate" };
      }

      const goal = createGoal(
        this.db,
        selected.title,
        this.buildGoalDescription(selected),
        this.buildGoalStrategy(selected),
      );

      state.currentGoalId = goal.id;
      state.dailyStarts.count += 1;
      const domain = normalizeDomain(selected.domain);
      const stats = state.domainStats[domain] ?? emptyDomainStats();
      stats.attempts += 1;
      state.domainStats[domain] = stats;
      this.saveState(state);

      insertKnowledge(this.db, {
        category: "technical",
        key: `research-hypothesis:${goal.id}`,
        content: JSON.stringify(selected),
        source: this.identity.address,
        confidence: 0.3,
        tokenCount: estimateTokens(JSON.stringify(selected)),
      });
      insertEvent(this.db, {
        type: "autonomous_research_goal_created",
        agentAddress: this.identity.address,
        goalId: goal.id,
        content: JSON.stringify({
          candidate: selected,
          selectionScore: scoreCandidate(
            selected,
            localNoveltyScore(selected, history),
            stats.reward,
            this.researchConfig.maxGoalCostCents,
          ),
        }),
        tokenCount: 0,
      });

      return {
        status: "created",
        goalId: goal.id,
        message: `Created autonomous research goal "${goal.title}"`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn("Autonomous research candidate generation failed", { error: message });
      insertEvent(this.db, {
        type: "autonomous_research_error",
        agentAddress: this.identity.address,
        content: message.slice(0, 2_000),
        tokenCount: 0,
      });
      return { status: "error", message };
    }
  }

  private async generateCandidates(
    history: HistoricalGoal[],
    state: AutonomousResearchState,
    financial: FinancialState,
  ): Promise<ResearchCandidate[]> {
    const recentKnowledge = this.db
      .prepare(
        `SELECT category, key, content, confidence, last_verified
         FROM knowledge_store
         WHERE expires_at IS NULL OR expires_at >= ?
         ORDER BY last_verified DESC
         LIMIT ?`,
      )
      .all(new Date().toISOString(), MAX_CONTEXT_KNOWLEDGE) as Array<{
        category: string;
        key: string;
        content: string;
        confidence: number;
        last_verified: string;
      }>;

    const result = await this.inference.chat({
      tier: "reasoning",
      maxTokens: 2_400,
      temperature: 0.85,
      responseFormat: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: buildCandidateSystemPrompt(this.researchConfig),
        },
        {
          role: "user",
          content: JSON.stringify({
            mission: this.researchConfig.mission,
            availableCreditsCents: financial.creditsCents,
            reserveCreditsCents: this.researchConfig.reserveCreditsCents,
            maxGoalCostCents: this.researchConfig.maxGoalCostCents,
            priorGoals: history,
            recentKnowledge,
            learnedDomainStats: state.domainStats,
          }),
        },
      ],
    });

    return parseCandidates(result.content)
      .slice(0, this.researchConfig.candidateCount);
  }

  private selectCandidate(
    candidates: ResearchCandidate[],
    history: HistoricalGoal[],
    state: AutonomousResearchState,
  ): ResearchCandidate | null {
    const eligible = candidates
      .map((candidate) => {
        const localNovelty = localNoveltyScore(candidate, history);
        const domainReward =
          state.domainStats[normalizeDomain(candidate.domain)]?.reward ?? 0;
        return {
          candidate,
          localNovelty,
          score: scoreCandidate(
            candidate,
            localNovelty,
            domainReward,
            this.researchConfig.maxGoalCostCents,
          ),
        };
      })
      .filter(({ candidate, localNovelty }) =>
        candidate.noveltyScore >= this.researchConfig.minNoveltyScore &&
        localNovelty >= this.researchConfig.minNoveltyScore &&
        candidate.expectedValueScore >= MIN_EXPECTED_VALUE_SCORE &&
        candidate.feasibilityScore >= MIN_FEASIBILITY_SCORE &&
        candidate.learningValueScore >= MIN_LEARNING_VALUE_SCORE &&
        candidate.riskScore <= this.researchConfig.maxRiskScore &&
        candidate.estimatedCostCents > 0 &&
        candidate.estimatedCostCents <= this.researchConfig.maxGoalCostCents &&
        candidate.successCriteria.length > 0 &&
        candidate.stopConditions.length > 0 &&
        candidate.noveltyChecks.length > 0 &&
        !this.containsBlockedTopic(candidate),
      )
      .sort((a, b) => b.score - a.score);

    return eligible[0]?.candidate ?? null;
  }

  private containsBlockedTopic(candidate: ResearchCandidate): boolean {
    const text = [
      candidate.title,
      candidate.domain,
      candidate.hypothesis,
      candidate.rationale,
      candidate.experiment,
      ...candidate.successCriteria,
      ...candidate.stopConditions,
      ...candidate.noveltyChecks,
    ].join(" ").toLowerCase();

    return this.researchConfig.blockedTopics.some((topic) =>
      text.includes(topic.trim().toLowerCase()),
    );
  }

  private reconcilePreviousGoal(state: AutonomousResearchState): void {
    if (!state.currentGoalId) {
      return;
    }

    const goal = getGoalById(this.db, state.currentGoalId);
    if (!goal || goal.status === "active" || goal.status === "paused") {
      return;
    }

    const tasks = getTasksByGoal(this.db, goal.id);
    const completed = tasks.filter((task) => task.status === "completed").length;
    const failed = tasks.filter((task) => task.status === "failed").length;
    const outcome = goal.status === "completed" ? "success" : "failure";
    const domain = readStrategyDomain(goal.strategy);
    const stats = state.domainStats[domain] ?? emptyDomainStats();

    if (outcome === "success") {
      stats.successes += 1;
      stats.reward = clamp(stats.reward + 0.1, -0.5, 0.5);
      state.consecutiveFailures = 0;
    } else {
      stats.failures += 1;
      stats.reward = clamp(stats.reward - 0.1, -0.5, 0.5);
      state.consecutiveFailures += 1;
    }
    state.domainStats[domain] = stats;

    const taskOutcomes = tasks.map((task) => ({
      title: task.title,
      role: task.agentRole,
      status: task.status,
      result: task.result,
      actualCostCents: task.actualCostCents,
    }));
    const content = JSON.stringify({
      goalId: goal.id,
      title: goal.title,
      status: goal.status,
      completedTasks: completed,
      failedTasks: failed,
      taskOutcomes,
    }).slice(0, MAX_OUTCOME_LENGTH);

    insertKnowledge(this.db, {
      category: "technical",
      key: `research-outcome:${goal.id}`,
      content,
      source: this.identity.address,
      confidence: outcome === "success" ? 0.8 : 0.6,
      tokenCount: estimateTokens(content),
    });
    insertEvent(this.db, {
      type: "autonomous_research_reflection",
      agentAddress: this.identity.address,
      goalId: goal.id,
      content,
      tokenCount: estimateTokens(content),
    });

    state.currentGoalId = null;
    if (
      state.consecutiveFailures >=
      this.researchConfig.maxConsecutiveFailures
    ) {
      state.pauseUntil = new Date(
        Date.now() + this.researchConfig.pauseAfterFailuresMinutes * 60_000,
      ).toISOString();
    }
  }

  private buildGoalDescription(candidate: ResearchCandidate): string {
    return [
      `Hypothesis: ${candidate.hypothesis}`,
      "",
      `Why it may matter: ${candidate.rationale}`,
      "",
      "Required research lifecycle:",
      "1. Search prior art and the local knowledge store before building anything.",
      "2. Attempt to falsify novelty; stop or reframe if the idea is already established.",
      `3. Run this bounded experiment: ${candidate.experiment}`,
      "4. Evaluate the evidence against the success criteria.",
      "5. Persist sources, artifacts, negative results, and a concise reflection for future cycles.",
      "6. If required sources, network access, or tools are unavailable, record the limitation and finish as inconclusive instead of inventing evidence.",
      "",
      "Novelty checks:",
      ...candidate.noveltyChecks.map((item) => `- ${item}`),
      "",
      "Success criteria:",
      ...candidate.successCriteria.map((item) => `- ${item}`),
      "",
      "Stop conditions:",
      ...candidate.stopConditions.map((item) => `- ${item}`),
      "",
      "Boundaries:",
      `- Total estimated execution cost must remain at or below ${candidate.estimatedCostCents} cents.`,
      "- Do not transfer funds, deploy publicly, spawn descendants, change safety controls, or self-modify as part of this goal.",
      "- Treat novelty as an evidence-backed estimate, never as proof that nobody has discovered the idea.",
    ].join("\n");
  }

  private buildGoalStrategy(candidate: ResearchCandidate): string {
    return [
      "autonomous-research/v1",
      `domain=${normalizeDomain(candidate.domain)}`,
      `estimatedCostCents=${candidate.estimatedCostCents}`,
      `noveltyScore=${candidate.noveltyScore.toFixed(2)}`,
      `riskScore=${candidate.riskScore.toFixed(2)}`,
      "prioritize falsification, reproducible evidence, and reusable knowledge",
    ].join("; ");
  }

  private hasBudget(financial: FinancialState): boolean {
    if (!Number.isFinite(financial.creditsCents) || financial.creditsCents < 0) {
      return false;
    }
    return (
      financial.creditsCents >= this.researchConfig.minCreditsCents &&
      financial.creditsCents - this.researchConfig.reserveCreditsCents >=
        this.researchConfig.maxGoalCostCents
    );
  }

  private cooldownElapsed(
    state: AutonomousResearchState,
    now: Date,
  ): boolean {
    if (!state.lastAttemptAt) {
      return true;
    }
    return (
      now.getTime() - new Date(state.lastAttemptAt).getTime() >=
      this.researchConfig.cooldownMinutes * 60_000
    );
  }

  private resetDailyCounter(
    state: AutonomousResearchState,
    now: Date,
  ): void {
    const date = now.toISOString().slice(0, 10);
    if (state.dailyStarts.date !== date) {
      state.dailyStarts = { date, count: 0 };
    }
  }

  private loadGoalHistory(): HistoricalGoal[] {
    return this.db
      .prepare(
        `SELECT id, title, description, status, strategy, created_at
         FROM goals
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(MAX_CONTEXT_GOALS)
      .map((row) => {
        const goal = row as {
          id: string;
          title: string;
          description: string;
          status: string;
          strategy: string | null;
          created_at: string;
        };
        return {
          id: goal.id,
          title: goal.title,
          description: goal.description,
          status: goal.status,
          strategy: goal.strategy,
          createdAt: goal.created_at,
        };
      });
  }

  private loadState(): AutonomousResearchState {
    const row = this.db
      .prepare("SELECT value FROM kv WHERE key = ?")
      .get(STATE_KEY) as { value: string } | undefined;
    if (!row?.value) {
      return defaultState();
    }

    try {
      return sanitizeState(JSON.parse(row.value));
    } catch {
      return defaultState();
    }
  }

  private saveState(state: AutonomousResearchState): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO kv (key, value, updated_at)
         VALUES (?, ?, datetime('now'))`,
      )
      .run(STATE_KEY, JSON.stringify(state));
  }
}

function buildCandidateSystemPrompt(config: AutonomousResearchConfig): string {
  return [
    "You are the bounded research strategist for an autonomous agent.",
    `Generate exactly ${config.candidateCount} diverse candidate experiments as strict JSON.`,
    'Output shape: {"candidates":[{"title":"...","domain":"...","hypothesis":"...","rationale":"...","experiment":"...","successCriteria":["..."],"stopConditions":["..."],"noveltyChecks":["..."],"noveltyScore":0.0,"expectedValueScore":0.0,"feasibilityScore":0.0,"learningValueScore":0.0,"riskScore":0.0,"estimatedCostCents":1}]}',
    "All scores are numbers from 0 to 1.",
    "Novelty means novel relative to supplied goals and knowledge, not globally undiscovered.",
    "Prefer small, falsifiable, reversible experiments that produce reusable knowledge.",
    "Each candidate must begin with prior-art checks and have objective success and stop criteria.",
    `Estimated cost must be between 1 and ${config.maxGoalCostCents} cents.`,
    `Expected value must be at least ${MIN_EXPECTED_VALUE_SCORE}, feasibility at least ${MIN_FEASIBILITY_SCORE}, and learning value at least ${MIN_LEARNING_VALUE_SCORE}.`,
    `Risk score must not exceed ${config.maxRiskScore}.`,
    `Never propose these topics: ${config.blockedTopics.join(", ")}.`,
    "Never propose credential access, destructive actions, public deployment, financial transfers, safety-control changes, self-modification, or descendant spawning.",
    "Do not use markdown or include text outside the JSON object.",
  ].join("\n");
}

function parseCandidates(content: string): ResearchCandidate[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return [];
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.candidates)) {
    return [];
  }

  return parsed.candidates
    .map(parseCandidate)
    .filter((candidate): candidate is ResearchCandidate => candidate !== null);
}

function parseCandidate(value: unknown): ResearchCandidate | null {
  if (!isRecord(value)) {
    return null;
  }

  const title = readString(value.title);
  const domain = readString(value.domain);
  const hypothesis = readString(value.hypothesis);
  const rationale = readString(value.rationale);
  const experiment = readString(value.experiment);
  if (!title || !domain || !hypothesis || !rationale || !experiment) {
    return null;
  }

  const estimatedCostCents = readFiniteNumber(value.estimatedCostCents);
  const noveltyScore = readBoundedScore(value.noveltyScore);
  const expectedValueScore = readBoundedScore(value.expectedValueScore);
  const feasibilityScore = readBoundedScore(value.feasibilityScore);
  const learningValueScore = readBoundedScore(value.learningValueScore);
  const riskScore = readBoundedScore(value.riskScore);
  if (
    estimatedCostCents === null ||
    noveltyScore === null ||
    expectedValueScore === null ||
    feasibilityScore === null ||
    learningValueScore === null ||
    riskScore === null
  ) {
    return null;
  }

  return {
    title: title.slice(0, 160),
    domain: domain.slice(0, 80),
    hypothesis: hypothesis.slice(0, 2_000),
    rationale: rationale.slice(0, 2_000),
    experiment: experiment.slice(0, 3_000),
    successCriteria: readStringArray(value.successCriteria, 8),
    stopConditions: readStringArray(value.stopConditions, 8),
    noveltyChecks: readStringArray(value.noveltyChecks, 8),
    noveltyScore,
    expectedValueScore,
    feasibilityScore,
    learningValueScore,
    riskScore,
    estimatedCostCents: Math.round(estimatedCostCents),
  };
}

function scoreCandidate(
  candidate: ResearchCandidate,
  localNovelty: number,
  domainReward: number,
  maxGoalCostCents: number,
): number {
  const novelty = Math.min(candidate.noveltyScore, localNovelty);
  const costEfficiency = 1 - clamp(
    candidate.estimatedCostCents / Math.max(1, maxGoalCostCents),
    0,
    1,
  );
  return (
    novelty * 0.3 +
    candidate.expectedValueScore * 0.2 +
    candidate.feasibilityScore * 0.15 +
    candidate.learningValueScore * 0.2 +
    costEfficiency * 0.05 +
    domainReward * 0.1 -
    candidate.riskScore * 0.25
  );
}

function localNoveltyScore(
  candidate: ResearchCandidate,
  history: HistoricalGoal[],
): number {
  if (history.length === 0) {
    return 1;
  }
  const candidateTokens = tokenize(
    `${candidate.title} ${candidate.hypothesis} ${candidate.experiment}`,
  );
  let maxSimilarity = 0;
  for (const goal of history) {
    const goalTokens = tokenize(`${goal.title} ${goal.description}`);
    maxSimilarity = Math.max(
      maxSimilarity,
      jaccardSimilarity(candidateTokens, goalTokens),
    );
  }
  return clamp(1 - maxSimilarity, 0, 1);
}

function tokenize(text: string): Set<string> {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3);
  return new Set(tokens);
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) {
    return 1;
  }
  let intersection = 0;
  for (const value of a) {
    if (b.has(value)) {
      intersection += 1;
    }
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function sanitizeState(value: unknown): AutonomousResearchState {
  const fallback = defaultState();
  if (!isRecord(value)) {
    return fallback;
  }
  const dailyStarts = isRecord(value.dailyStarts)
    ? {
        date: readString(value.dailyStarts.date) || fallback.dailyStarts.date,
        count: Math.max(0, Math.floor(readFiniteNumber(value.dailyStarts.count) ?? 0)),
      }
    : fallback.dailyStarts;

  const domainStats: Record<string, DomainStats> = {};
  if (isRecord(value.domainStats)) {
    for (const [domain, rawStats] of Object.entries(value.domainStats)) {
      if (!isRecord(rawStats)) {
        continue;
      }
      domainStats[normalizeDomain(domain)] = {
        attempts: Math.max(0, Math.floor(readFiniteNumber(rawStats.attempts) ?? 0)),
        successes: Math.max(0, Math.floor(readFiniteNumber(rawStats.successes) ?? 0)),
        failures: Math.max(0, Math.floor(readFiniteNumber(rawStats.failures) ?? 0)),
        reward: clamp(readFiniteNumber(rawStats.reward) ?? 0, -0.5, 0.5),
      };
    }
  }

  return {
    version: 1,
    lastAttemptAt: readNullableString(value.lastAttemptAt),
    currentGoalId: readNullableString(value.currentGoalId),
    consecutiveFailures: Math.max(
      0,
      Math.floor(readFiniteNumber(value.consecutiveFailures) ?? 0),
    ),
    pauseUntil: readNullableString(value.pauseUntil),
    dailyStarts,
    domainStats,
  };
}

function defaultState(): AutonomousResearchState {
  return {
    version: 1,
    lastAttemptAt: null,
    currentGoalId: null,
    consecutiveFailures: 0,
    pauseUntil: null,
    dailyStarts: { date: new Date().toISOString().slice(0, 10), count: 0 },
    domainStats: {},
  };
}

function emptyDomainStats(): DomainStats {
  return {
    attempts: 0,
    successes: 0,
    failures: 0,
    reward: 0,
  };
}

function readStrategyDomain(strategy: string | null): string {
  if (!strategy) {
    return "unknown";
  }
  const match = strategy.match(/(?:^|;\s*)domain=([^;]+)/);
  return normalizeDomain(match?.[1] ?? "unknown");
}

function normalizeDomain(domain: string): string {
  const normalized = domain
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "unknown";
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readStringArray(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().slice(0, 500))
    .filter(Boolean)
    .slice(0, limit);
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readBoundedScore(value: unknown): number | null {
  const score = readFiniteNumber(value);
  return score !== null && score >= 0 && score <= 1 ? score : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeJsonParse(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function estimateTokens(content: string): number {
  return Math.max(1, Math.ceil(content.length / 4));
}
