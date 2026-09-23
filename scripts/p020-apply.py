from pathlib import Path
import re


def replace_one(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one literal match, found {count}: {old[:120]!r}")
    p.write_text(text.replace(old, new, 1))


def regex_one(path: str, pattern: str, replacement: str) -> None:
    p = Path(path)
    text = p.read_text()
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f"{path}: expected one regex match, found {count}: {pattern[:120]!r}")
    p.write_text(updated)


# KnowledgeStore: the DB authority is already open-world; remove the app-only enum gate.
path = "src/memory/knowledge-store.ts"
replace_one(
    path,
    '''export type KnowledgeCategory =
  | "market"
  | "technical"
  | "social"
  | "financial"
  | "operational";''',
    '''export type KnowledgeCategory = string;''',
)
replace_one(
    path,
    '''export interface KnowledgeStats {
  total: number;
  byCategory: Record<KnowledgeCategory, number>;
  totalTokens: number;
}''',
    '''export interface KnowledgeStats {
  total: number;
  byCategory: Record<string, number>;
  totalTokens: number;
}''',
)
regex_one(
    path,
    r'''const KNOWLEDGE_CATEGORIES: KnowledgeCategory\[\] = \[.*?\];\n\nfunction isKnowledgeCategory\(value: string\): value is KnowledgeCategory \{.*?\n\}\n''',
    '''const KNOWN_KNOWLEDGE_CATEGORIES = [
  "market",
  "technical",
  "social",
  "financial",
  "operational",
] as const;
''',
)
replace_one(
    path,
    '''function toKnowledgeEntry(row: KnowledgeStoreRow): KnowledgeEntry {
  if (!isKnowledgeCategory(row.category)) {
    throw new Error(`Invalid knowledge category: ${row.category}`);
  }

  return {''',
    '''function toKnowledgeEntry(row: KnowledgeStoreRow): KnowledgeEntry {
  return {''',
)
regex_one(
    path,
    r'''  getStats\(\): KnowledgeStats \{\n    const byCategory: Record<KnowledgeCategory, number> = \{.*?\n    return \{\n      total: totals\.total,\n      byCategory,\n      totalTokens: totals\.totalTokens,\n    \};\n  \}''',
    '''  getStats(): KnowledgeStats {
    const byCategory: Record<string, number> = Object.fromEntries(
      KNOWN_KNOWLEDGE_CATEGORIES.map((category) => [category, 0]),
    );

    const counts = this.db
      .prepare(
        "SELECT category, COUNT(*) AS count FROM knowledge_store GROUP BY category",
      )
      .all() as { category: string; count: number }[];

    for (const row of counts) {
      byCategory[row.category] = row.count;
    }

    const totals = this.db
      .prepare(
        "SELECT COUNT(*) AS total, COALESCE(SUM(token_count), 0) AS totalTokens FROM knowledge_store",
      )
      .get() as { total: number; totalTokens: number };

    return {
      total: totals.total,
      byCategory,
      totalTokens: totals.totalTokens,
    };
  }''',
)

# EnhancedRetriever: category inference is a ranking hint, never a retrieval frontier;
# feedback belongs to the retriever instance instead of process-global mutable state.
path = "src/memory/enhanced-retriever.ts"
replace_one(
    path,
    '''const feedbackPrecisionWindow: number[] = [];
const feedbackByTurn = new Map<string, RetrievalFeedback>();
let lastRollingPrecision: number | undefined;
let feedbackDb: Database | null = null;
''',
    '',
)
regex_one(
    path,
    r'''export function recordRetrievalFeedback\(feedback: RetrievalFeedback\): void \{.*?\n\}\n\nexport class EnhancedRetriever''',
    '''export class EnhancedRetriever''',
)
replace_one(
    path,
    '''export class EnhancedRetriever extends MemoryRetriever {
  private readonly db: Database;
  private readonly knowledgeStore: KnowledgeStore;
  private readonly taskStore?: any;
''',
    '''export class EnhancedRetriever extends MemoryRetriever {
  private readonly db: Database;
  private readonly knowledgeStore: KnowledgeStore;
  private readonly taskStore?: any;
  private readonly feedbackPrecisionWindow: number[] = [];
  private lastRollingPrecision: number | undefined;
''',
)
replace_one(
    path,
    '''    this.db = db;
    this.taskStore = taskStore;
    this.knowledgeStore = new KnowledgeStore(db);
    feedbackDb = db;
''',
    '''    this.db = db;
    this.taskStore = taskStore;
    this.knowledgeStore = new KnowledgeStore(db);
''',
)
replace_one(
    path,
    '''  recordRetrievalFeedback(feedback: RetrievalFeedback): void {
    recordRetrievalFeedback(feedback);
  }
''',
    '''  recordRetrievalFeedback(feedback: RetrievalFeedback): void {
    const retrieved = dedupeStrings(feedback.retrieved).filter((id) => id.length > 0);
    const retrievedSet = new Set(retrieved);
    let matched = dedupeStrings(feedback.matched).filter((id) => retrievedSet.has(id));

    if (retrieved.length > 0) {
      const response = getTurnResponse(this.db, feedback.turnId);
      if (response.length > 0) {
        const autoMatched = matchRetrievedKnowledgeInResponse(
          this.db,
          retrieved,
          response,
        );
        if (autoMatched.length > 0) {
          matched = dedupeStrings([...matched, ...autoMatched]).filter((id) =>
            retrievedSet.has(id)
          );
          incrementKnowledgeAccessCount(this.db, autoMatched);
        }
      }
    }

    const retrievalPrecision = retrieved.length === 0
      ? 0
      : matched.length / retrieved.length;
    this.pushRollingPrecision(retrievalPrecision);
  }

  private pushRollingPrecision(precision: number): number {
    this.feedbackPrecisionWindow.push(clamp01(precision));
    while (this.feedbackPrecisionWindow.length > MAX_ROLLING_FEEDBACK_WINDOW) {
      this.feedbackPrecisionWindow.shift();
    }

    const total = this.feedbackPrecisionWindow.reduce((sum, value) => sum + value, 0);
    this.lastRollingPrecision = this.feedbackPrecisionWindow.length > 0
      ? total / this.feedbackPrecisionWindow.length
      : undefined;
    return this.lastRollingPrecision ?? 0;
  }
''',
)
replace_one(
    path,
    '''    if (lastRollingPrecision !== undefined) {
      result.retrievalPrecision = lastRollingPrecision;
    }''',
    '''    if (this.lastRollingPrecision !== undefined) {
      result.retrievalPrecision = this.lastRollingPrecision;
    }''',
)
regex_one(
    path,
    r'''  private collectKnowledgeCandidates\(query: EnhancedQuery\): KnowledgeEntry\[\] \{.*?\n  \}\n\n  private searchTermAcrossCategories\(.*?\n  \}\n\n  private computeScoringFactors''',
    '''  private collectKnowledgeCandidates(query: EnhancedQuery): KnowledgeEntry[] {
    const byId = new Map<string, KnowledgeEntry>();

    if (query.terms.length === 0) {
      for (const entry of this.knowledgeStore.search("", undefined, KNOWLEDGE_SEARCH_LIMIT)) {
        byId.set(entry.id, entry);
      }
    } else {
      for (const term of query.terms) {
        for (const entry of this.knowledgeStore.search(
          term,
          undefined,
          KNOWLEDGE_SEARCH_LIMIT,
        )) {
          byId.set(entry.id, entry);
        }
      }
    }

    let entries = [...byId.values()];
    if (query.timeRange?.since) {
      const sinceMs = Date.parse(query.timeRange.since);
      if (!Number.isNaN(sinceMs)) {
        entries = entries.filter((entry) => {
          const referenceTime = Date.parse(entry.lastVerified || entry.createdAt);
          return !Number.isNaN(referenceTime) && referenceTime >= sinceMs;
        });
      }
    }

    return entries;
  }

  private computeScoringFactors''',
)
regex_one(
    path,
    r'''\nfunction pushRollingPrecision\(precision: number\): number \{.*?\n\}\n\nfunction dedupeStrings''',
    '''
function dedupeStrings''',
)

# ContextManager: reserve mandatory tail before optional history/memory and render it last.
path = "src/memory/context-manager.ts"
replace_one(
    path,
    '''  memoryTokens: number;
  eventTokens: number;
  turnTokens: number;
  compressionHeadroom: number;''',
    '''  memoryTokens: number;
  eventTokens: number;
  turnTokens: number;
  tailTokens: number;
  compressionHeadroom: number;''',
)
replace_one(
    path,
    '''  taskSpec?: string;
  memories?: string;
  events?: any[];
  modelContextWindow: number;''',
    '''  taskSpec?: string;
  memories?: string | string[];
  events?: any[];
  tailMessages?: ChatMessage[];
  modelContextWindow: number;''',
)
replace_one(
    path,
    '''    const renderedTurns = (params.recentTurns ?? []).map((turn, index) =>
      this.renderTurn(turn, index),
    );
    const recentTurns = renderedTurns.slice(-3);
    const olderTurns = renderedTurns.slice(0, -3);

    let includedTurnCount = 0;
    let turnTokens = 0;

    for (const recentTurn of recentTurns) {
      recentTurnMessages.push(...recentTurn.messages);
      usedTokens += recentTurn.tokens;
      turnTokens += recentTurn.tokens;
      includedTurnCount += 1;
    }

    let memoryTokens = 0;
''',
    '''    const tailMessages = [...(params.tailMessages ?? [])];
    const tailTokens = this.countMessagesTokens(tailMessages);
    usedTokens += tailTokens;

    const renderedTurns = (params.recentTurns ?? []).map((turn, index) =>
      this.renderTurn(turn, index),
    );
    const recentCandidates = renderedTurns.slice(-3);
    const olderTurns = renderedTurns.slice(0, -3);

    let includedTurnCount = 0;
    let turnTokens = 0;
    const selectedRecentTurns: RenderedTurn[] = [];
    for (let i = recentCandidates.length - 1; i >= 0; i--) {
      const recentTurn = recentCandidates[i];
      if (usedTokens + recentTurn.tokens > promptCapacity) continue;
      selectedRecentTurns.push(recentTurn);
      usedTokens += recentTurn.tokens;
      turnTokens += recentTurn.tokens;
      includedTurnCount += 1;
    }
    selectedRecentTurns.sort((a, b) => a.turnIndex - b.turnIndex);
    for (const recentTurn of selectedRecentTurns) {
      recentTurnMessages.push(...recentTurn.messages);
    }

    let memoryTokens = 0;
''',
)
regex_one(
    path,
    r'''    if \(params\.memories && params\.memories\.trim\(\)\.length > 0\) \{.*?\n    \}\n\n    const selectedOlderTurns''',
    '''    const memoryBlocks = Array.isArray(params.memories)
      ? params.memories
      : params.memories
        ? [params.memories]
        : [];

    for (const memoryBlock of memoryBlocks) {
      if (!memoryBlock || memoryBlock.trim().length === 0) continue;
      const memoryMessage: ChatMessage = {
        role: "system",
        content: `## Retrieved memories\n${memoryBlock.trim()}`,
      };
      const candidateTokens = this.countMessagesTokens([memoryMessage]);
      if (usedTokens + candidateTokens <= promptCapacity) {
        messages.push(memoryMessage);
        usedTokens += candidateTokens;
        memoryTokens += candidateTokens;
      }
    }

    const selectedOlderTurns''',
)
replace_one(
    path,
    '''    messages.push(...olderTurnMessages);
    messages.push(...recentTurnMessages);
    messages.push(...eventMessages);
''',
    '''    messages.push(...olderTurnMessages);
    messages.push(...recentTurnMessages);
    messages.push(...eventMessages);
    messages.push(...tailMessages);
''',
)
replace_one(
    path,
    '''      memoryTokens,
      eventTokens,
      turnTokens,
      compressionHeadroom,''',
    '''      memoryTokens,
      eventTokens,
      turnTokens,
      tailTokens,
      compressionHeadroom,''',
)

# Canonicalize anti-repetition message so both legacy and new assembly use one behavior.
path = "src/agent/context.ts"
marker = '''/**
 * Build the message array for the next inference call.
 * Includes system prompt + recent conversation history.
 * Applies token budget enforcement and tool result truncation.
 */
export function buildContextMessages'''
helper = '''export function buildAntiRepetitionMessage(
  recentTurns: AgentTurn[],
): ChatMessage | undefined {
  const analysisWindow = recentTurns.slice(-5);
  if (analysisWindow.length < 3) return undefined;

  const toolFrequency: Record<string, number> = {};
  for (const turn of analysisWindow) {
    for (const tc of turn.toolCalls) {
      toolFrequency[tc.name] = (toolFrequency[tc.name] || 0) + 1;
    }
  }

  const repeatedTools = Object.entries(toolFrequency)
    .filter(([, count]) => count >= 3)
    .map(([name]) => name);
  if (repeatedTools.length === 0) return undefined;

  return {
    role: "user",
    content:
      `[system] WARNING: You have been calling ${repeatedTools.join(", ")} repeatedly in recent turns. ` +
      `You already have this information. Move on to BUILDING something. ` +
      `Write code, create files, set up a service. Do not check status again.`,
  };
}

/**
 * Build the message array for the next inference call.
 * Includes system prompt + recent conversation history.
 * Applies token budget enforcement and tool result truncation.
 */
export function buildContextMessages'''
replace_one(path, marker, helper)
regex_one(
    path,
    r'''  // ── Anti-Repetition Warning ──.*?\n  // Add pending input if any''',
    '''  // ── Anti-Repetition Warning ──
  const antiRepetitionMessage = buildAntiRepetitionMessage(recentTurns);
  if (antiRepetitionMessage) {
    messages.push(antiRepetitionMessage);
  }

  // Add pending input if any''',
)

# Activate the existing cognitive pieces in the main AgentLoop.
path = "src/agent/loop.ts"
replace_one(
    path,
    '''  InputSource,
  ModelStrategyConfig,
} from "../types.js";''',
    '''  InputSource,
  ModelStrategyConfig,
  ChatMessage,
} from "../types.js";''',
)
replace_one(
    path,
    '''  DEFAULT_MODEL_STRATEGY_CONFIG,
  DEFAULT_TREASURY_POLICY,
} from "../types.js";''',
    '''  DEFAULT_MODEL_STRATEGY_CONFIG,
  DEFAULT_TREASURY_POLICY,
  DEFAULT_TOKEN_BUDGET,
} from "../types.js";''',
)
replace_one(
    path,
    '''import { buildContextMessages, trimContext } from "./context.js";''',
    '''import { buildAntiRepetitionMessage, trimContext } from "./context.js";''',
)
replace_one(
    path,
    '''import { MemoryIngestionPipeline } from "../memory/ingestion.js";
import { DEFAULT_MEMORY_BUDGET } from "../types.js";
import { formatMemoryBlock } from "./context.js";''',
    '''import { MemoryIngestionPipeline } from "../memory/ingestion.js";
import { EnhancedRetriever, calculateMemoryBudget } from "../memory/enhanced-retriever.js";
import { ContextManager, createTokenCounter } from "../memory/context-manager.js";
import { DEFAULT_MEMORY_BUDGET } from "../types.js";
import { formatMemoryBlock } from "./context.js";''',
)
replace_one(
    path,
    '''import { generateTodoMd, injectTodoContext } from "../orchestration/attention.js";''',
    '''import { generateTodoMd } from "../orchestration/attention.js";''',
)
replace_one(
    path,
    '''  const runtimeModelBinding = new RuntimeModelBinding(modelStrategyConfig);
''',
    '''  const runtimeModelBinding = new RuntimeModelBinding(modelStrategyConfig);
  const contextManager = new ContextManager(createTokenCounter());
  const enhancedRetriever = new EnhancedRetriever(db.raw, DEFAULT_MEMORY_BUDGET);
''',
)
regex_one(
    path,
    r'''      // Phase 2\.2: Pre-turn memory retrieval.*?\n      if \(memoryBlock\) \{\n        messages\.splice\(1, 0, \{ role: "system", content: memoryBlock \}\);\n      \}\n''',
    '''      let todoMd: string | undefined;
      let retrievedKnowledgeIds: string[] = [];
''',
)
replace_one(
    path,
    '''      if (planModeController) {
        try {
          const todoMd = generateTodoMd(db.raw);
          messages = injectTodoContext(messages, todoMd);
        } catch (error) {
          logger.warn(
            `todo.md context injection skipped: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
''',
    '''      if (planModeController) {
        try {
          todoMd = generateTodoMd(db.raw);
        } catch (error) {
          logger.warn(
            `todo.md context generation skipped: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
''',
)
replace_one(
    path,
    '''      const selectedModel =
        inferenceRouter.selectModel(
          survivalTier,
          "agent_turn",
          activeConnectionProvider,
        )?.modelId || "none";
      const providerLabel = activeConnectionProvider || "legacy/auto";
''',
    '''      const selectedModelEntry = inferenceRouter.selectModel(
        survivalTier,
        "agent_turn",
        activeConnectionProvider,
      );
      const selectedModel = selectedModelEntry?.modelId || "none";
      // Until the router exposes a fallback-safe aggregate window, never widen
      // beyond the legacy prompt ceiling. A smaller selected model is honored.
      const modelContextWindow = Math.max(
        1,
        Math.min(
          selectedModelEntry?.contextWindow ?? DEFAULT_TOKEN_BUDGET.total,
          DEFAULT_TOKEN_BUDGET.total,
        ),
      );

      const cognitiveMemoryBlocks: string[] = [];
      try {
        const sessionId = db.getKV("session_id") || "default";
        const retriever = new MemoryRetriever(db.raw, DEFAULT_MEMORY_BUDGET);
        const memories = retriever.retrieve(sessionId, currentInput?.content);
        if (memories.totalTokens > 0) {
          cognitiveMemoryBlocks.push(formatMemoryBlock(memories));
        }

        const knowledgeBudget = calculateMemoryBudget(
          contextManager.getUtilization(),
          modelContextWindow,
        );
        const activatedKnowledge = enhancedRetriever.retrieveScored({
          sessionId,
          currentInput: currentInput?.content,
          budgetTokens: knowledgeBudget,
        });
        retrievedKnowledgeIds = activatedKnowledge.entries.map(
          (candidate) => candidate.entry.id,
        );
        for (const candidate of activatedKnowledge.entries) {
          const entry = candidate.entry;
          cognitiveMemoryBlocks.push(
            `### Activated Knowledge\n- [${entry.category}/${entry.key}] ${entry.content}\n` +
            `  source=${entry.source}; confidence=${entry.confidence.toFixed(2)}; ` +
            `lastVerified=${entry.lastVerified}`,
          );
        }
      } catch (error) {
        logger.error("Cognitive retrieval failed", error instanceof Error ? error : undefined);
      }

      const tailMessages: ChatMessage[] = [];
      const antiRepetitionMessage = buildAntiRepetitionMessage(recentTurns);
      if (antiRepetitionMessage) {
        tailMessages.push(antiRepetitionMessage);
      }
      if (currentInput) {
        tailMessages.push({
          role: "user",
          content: `[${currentInput.source}] ${currentInput.content}`,
        });
      }

      const assembledContext = contextManager.assembleContext({
        systemPrompt,
        todoMd,
        recentTurns,
        memories: cognitiveMemoryBlocks,
        tailMessages,
        modelContextWindow,
      });
      const messages = assembledContext.messages;
      if (assembledContext.utilization.recommendation !== "ok") {
        logger.info("Cognitive context utilization", {
          utilization: assembledContext.utilization,
          budget: assembledContext.budget,
        });
      }

      const providerLabel = activeConnectionProvider || "legacy/auto";
''',
)
replace_one(
    path,
    '''      db.runTransaction(() => {
        db.insertTurn(turn);
        for (const tc of turn.toolCalls) {
          db.insertToolCall(turn.id, tc);
        }
        // Mark claimed inbox messages as processed (atomic with turn persistence)
        if (claimedIds.length > 0) {
          markInboxProcessed(db.raw, claimedIds);
        }
      });
      onTurnComplete?.(turn);
''',
    '''      db.runTransaction(() => {
        db.insertTurn(turn);
        for (const tc of turn.toolCalls) {
          db.insertToolCall(turn.id, tc);
        }
        // Mark claimed inbox messages as processed (atomic with turn persistence)
        if (claimedIds.length > 0) {
          markInboxProcessed(db.raw, claimedIds);
        }
      });

      if (retrievedKnowledgeIds.length > 0) {
        try {
          enhancedRetriever.recordRetrievalFeedback({
            turnId: turn.id,
            retrieved: retrievedKnowledgeIds,
            matched: [],
            retrievalPrecision: 0,
            rollingPrecision: 0,
          });
        } catch (error) {
          logger.error(
            "Knowledge retrieval feedback failed",
            error instanceof Error ? error : undefined,
          );
        }
      }

      onTurnComplete?.(turn);
''',
)

# Focused adversarial tests.
path = "src/__tests__/memory/knowledge-store.test.ts"
insert_before = '''  it("getStats handles empty table", () => {'''
addition = '''  it("accepts and reports categories unknown at compile time", () => {
    addKnowledge({ category: "legal-regulatory", key: "policy", content: "new rule" });

    const results = store.search("rule", "legal-regulatory");
    expect(results).toHaveLength(1);
    expect(results[0].category).toBe("legal-regulatory");
    expect(store.getStats().byCategory["legal-regulatory"]).toBe(1);
  });

'''
replace_one(path, insert_before, addition + insert_before)

path = "src/__tests__/memory/enhanced-retriever.test.ts"
insert_before = '''  it("respects budget and reports truncation", () => {'''
addition = '''  it("uses known categories as ranking hints instead of hard filters", () => {
    addKnowledge({
      category: "legal-regulatory",
      key: "api-timeout-policy",
      content: "api timeout policy for regulated deployments",
      confidence: 0.95,
      tokenCount: 20,
    });

    const retriever = new mod.EnhancedRetriever(db);
    const result = retriever.retrieveScored({
      sessionId: "s1",
      currentInput: "api timeout policy",
      agentRole: "software engineer",
      budgetTokens: 200,
    });

    expect(result.entries.some((candidate) =>
      candidate.entry.category === "legal-regulatory"
    )).toBe(true);
  });

'''
replace_one(path, insert_before, addition + insert_before)
insert_before = '''  it("retrieveScored includes precision metadata once feedback exists", () => {'''
addition = '''  it("keeps retrieval feedback isolated between retriever instances", () => {
    const secondDb = createTestDb();
    try {
      const first = new mod.EnhancedRetriever(db);
      const second = new mod.EnhancedRetriever(secondDb);

      first.recordRetrievalFeedback({
        turnId: "turn-a",
        retrieved: ["a"],
        matched: ["a"],
        retrievalPrecision: 0,
        rollingPrecision: 0,
      });

      expect(first.retrieveScored({
        sessionId: "s1",
        currentInput: "none",
        budgetTokens: 0,
      }).retrievalPrecision).toBe(1);
      expect(second.retrieveScored({
        sessionId: "s2",
        currentInput: "none",
        budgetTokens: 0,
      }).retrievalPrecision).toBeUndefined();
    } finally {
      secondDb.close();
    }
  });

'''
replace_one(path, insert_before, addition + insert_before)

path = "src/__tests__/memory/context-manager.test.ts"
insert_before = '''describe("ContextManager.compact", () => {'''
addition = '''  it("reserves mandatory tail and keeps pending input last", () => {
    const manager = new ContextManager(fixedTokenCounter(10));
    const assembled = manager.assembleContext({
      systemPrompt: "sys",
      recentTurns: [makeTurn(1), makeTurn(2), makeTurn(3)],
      memories: ["optional memory"],
      tailMessages: [{ role: "user", content: "pending-input" }],
      modelContextWindow: 60,
      reserveTokens: 20,
    });

    expect(assembled.messages.at(-1)?.content).toBe("pending-input");
    expect(assembled.budget.tailTokens).toBeGreaterThan(0);
    expect(assembled.messages.some((message) =>
      message.content.includes("optional memory")
    )).toBe(false);
  });

  it("keeps assistant tool calls adjacent to their tool results", () => {
    const manager = new ContextManager(fixedTokenCounter(1));
    const turn = {
      id: "tool-turn",
      timestamp: new Date().toISOString(),
      state: "running",
      input: "inspect",
      thinking: "calling tool",
      toolCalls: [{ id: "call-1", name: "inspect", args: {}, result: "done" }],
      tokenUsage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      costCents: 0,
    };
    const assembled = manager.assembleContext({
      systemPrompt: "sys",
      recentTurns: [turn],
      tailMessages: [{ role: "user", content: "next" }],
      modelContextWindow: 100,
      reserveTokens: 10,
    });

    const assistantIndex = assembled.messages.findIndex((message) =>
      message.role === "assistant" && Array.isArray(message.tool_calls)
    );
    expect(assistantIndex).toBeGreaterThan(0);
    expect(assembled.messages[assistantIndex + 1]?.role).toBe("tool");
    expect(assembled.messages[assistantIndex + 1]?.tool_call_id).toBe("call-1");
  });

'''
replace_one(path, insert_before, addition + insert_before)
