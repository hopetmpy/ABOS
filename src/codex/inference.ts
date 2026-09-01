/**
 * Codex inference adapter.
 *
 * Codex remains an agent runtime, but ABOS owns execution. To preserve that
 * boundary, Codex is asked for a structured inference decision: assistant text
 * plus zero or more ABOS tool requests. Codex built-in side-effecting tool
 * activity is treated as a provider-boundary violation and the turn is
 * interrupted; the same capabilities remain available through ABOS's tool
 * broker, where policy, spend tracking, provenance and persistence already live.
 */

import { randomUUID } from "node:crypto";
import type {
  ChatMessage,
  InferenceOptions,
  InferenceResponse,
  InferenceToolCall,
  InferenceToolDefinition,
  TokenUsage,
} from "../types.js";
import { CodexAppServerClient, type CodexRpcTransport } from "./app-server.js";

export interface CodexInferenceRuntimeOptions {
  transportFactory?: () => CodexRpcTransport;
  getReasoningEffort?: () => string | undefined;
}

interface ThreadStartResponse {
  thread: { id: string };
}

interface TurnStartResponse {
  turn: { id: string; status?: string; items?: unknown[] };
}

interface TurnCompletedNotification {
  threadId: string;
  turn: {
    id: string;
    status?: string;
    error?: unknown;
    items?: any[];
  };
}

interface ItemNotification {
  threadId: string;
  turnId: string;
  item: {
    type?: string;
    text?: string;
    [key: string]: unknown;
  };
}

interface TokenUsageNotification {
  threadId: string;
  turnId: string;
  tokenUsage?: {
    last?: {
      inputTokens?: number;
      outputTokens?: number;
      totalTokens?: number;
    };
  };
}

const PROVIDER_BOUNDARY_INSTRUCTIONS = [
  "You are the inference engine inside ABOS.",
  "Do not execute Codex built-in shell, file-change, web-search, MCP, app, or other host tools in this turn.",
  "ABOS owns all external execution so that tool calls use its capability broker, provenance, spend tracking, and runtime contracts.",
  "When an action is needed, request an ABOS tool in the structured final response. Do not pretend that a requested tool has already run.",
  "Return the best assistant content you can produce now plus zero or more tool requests.",
].join(" ");

const SIDE_EFFECT_ITEM_TYPES = new Set([
  "commandExecution",
  "fileChange",
  "mcpToolCall",
  "webSearch",
  "dynamicToolCall",
  "collabAgentToolCall",
  "computerToolCall",
]);

export class CodexInferenceRuntime {
  private readonly transportFactory: () => CodexRpcTransport;
  private readonly getReasoningEffort?: () => string | undefined;
  private transport: CodexRpcTransport | null = null;
  private startPromise: Promise<CodexRpcTransport> | null = null;

  constructor(options: CodexInferenceRuntimeOptions = {}) {
    this.transportFactory = options.transportFactory || (() => new CodexAppServerClient());
    this.getReasoningEffort = options.getReasoningEffort;
  }

  async chat(
    messages: ChatMessage[],
    options: InferenceOptions,
    registryModelId: string,
  ): Promise<InferenceResponse> {
    const transport = await this.ensureTransport();
    const model = stripCodexRegistryPrefix(registryModelId);
    throwIfAborted(options.signal);
    const threadResponse = await raceWithAbort(
      transport.request<ThreadStartResponse>("thread/start", {
      model,
      cwd: process.cwd(),
      approvalPolicy: "never",
      sandbox: "read-only",
      ephemeral: true,
      baseInstructions: PROVIDER_BOUNDARY_INSTRUCTIONS,
      developerInstructions: buildDeveloperInstructions(options.tools || []),
      }),
      options.signal,
    );
    const threadId = threadResponse?.thread?.id;
    if (!threadId) throw new Error("Codex thread/start returned no thread id");

    let turnId: string | undefined;
    let removeAbortListener: (() => void) | undefined;
    let finalMessage = "";
    let boundaryViolation: string | null = null;
    let usage: TokenUsage = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    };

    const offStarted = transport.onNotification("item/started", (raw) => {
      const params = raw as ItemNotification;
      if (params?.threadId !== threadId) return;
      const type = params.item?.type;
      if (!type || !SIDE_EFFECT_ITEM_TYPES.has(type)) return;

      boundaryViolation = type;
      if (turnId) {
        void transport.request("turn/interrupt", { threadId, turnId }).catch(() => undefined);
      }
    });

    const offCompleted = transport.onNotification("item/completed", (raw) => {
      const params = raw as ItemNotification;
      if (params?.threadId !== threadId) return;
      if (params.item?.type === "agentMessage" && typeof params.item.text === "string") {
        finalMessage = params.item.text;
      }
    });

    const offUsage = transport.onNotification("thread/tokenUsage/updated", (raw) => {
      const params = raw as TokenUsageNotification;
      if (params?.threadId !== threadId) return;
      const last = params.tokenUsage?.last;
      if (!last) return;
      usage = {
        promptTokens: last.inputTokens || 0,
        completionTokens: last.outputTokens || 0,
        totalTokens: last.totalTokens || (last.inputTokens || 0) + (last.outputTokens || 0),
      };
    });

    try {
      throwIfAborted(options.signal);
      const turnStartPromise = transport.request<TurnStartResponse>("turn/start", {
        threadId,
        input: [{ type: "text", text: buildConversationInput(messages) }],
        model,
        ...(this.getReasoningEffort?.() ? { effort: this.getReasoningEffort?.() } : {}),
        outputSchema: buildOutputSchema(options.tools || []),
      }).then((response) => {
        const startedTurnId = response?.turn?.id;
        if (options.signal?.aborted && startedTurnId) {
          void transport.request("turn/interrupt", {
            threadId,
            turnId: startedTurnId,
          }).catch(() => undefined);
        }
        return response;
      });
      const turnResponse = await raceWithAbort(
        turnStartPromise,
        options.signal,
      );
      turnId = turnResponse?.turn?.id;
      if (!turnId) throw new Error("Codex turn/start returned no turn id");

      if (options.signal) {
        const abortHandler = () => {
          if (!turnId) return;
          void transport.request("turn/interrupt", {
            threadId,
            turnId,
          }).catch(() => undefined);
        };
        options.signal.addEventListener("abort", abortHandler, { once: true });
        removeAbortListener = () =>
          options.signal?.removeEventListener("abort", abortHandler);
        if (options.signal.aborted) {
          abortHandler();
          throw createAbortError();
        }
      }

      const completed = await raceWithAbort(
        transport.waitForNotification<TurnCompletedNotification>(
          "turn/completed",
          (params) => params?.threadId === threadId && params?.turn?.id === turnId,
          180_000,
        ),
        options.signal,
      );

      if (boundaryViolation) {
        throw new Error(
          `Codex attempted provider-native tool activity ('${boundaryViolation}') outside the ABOS capability broker`,
        );
      }

      if (!finalMessage && Array.isArray(completed?.turn?.items)) {
        finalMessage = extractLastAgentMessage(completed.turn.items);
      }

      if (!finalMessage) {
        const errorText = completed?.turn?.error
          ? `: ${JSON.stringify(completed.turn.error)}`
          : "";
        throw new Error(`Codex turn completed without an assistant message${errorText}`);
      }

      const parsed = parseStructuredDecision(finalMessage, options.tools || []);
      return {
        id: turnId,
        model,
        message: {
          role: "assistant",
          content: parsed.content,
          tool_calls: parsed.toolCalls,
        },
        toolCalls: parsed.toolCalls.length > 0 ? parsed.toolCalls : undefined,
        usage,
        finishReason: completed?.turn?.status === "completed"
          ? "stop"
          : String(completed?.turn?.status || "stop"),
      };
    } finally {
      removeAbortListener?.();
      offStarted();
      offCompleted();
      offUsage();
    }
  }

  close(): void {
    this.transport?.close();
    this.transport = null;
    this.startPromise = null;
  }

  private async ensureTransport(): Promise<CodexRpcTransport> {
    if (this.transport?.isReady()) return this.transport;
    if (this.transport) {
      this.transport.close();
      this.transport = null;
    }
    if (this.startPromise) return this.startPromise;

    const transport = this.transportFactory();
    this.startPromise = (async () => {
      await transport.start();
      this.transport = transport;
      return transport;
    })();

    try {
      return await this.startPromise;
    } catch (error) {
      transport.close();
      this.startPromise = null;
      throw error;
    } finally {
      if (this.transport) this.startPromise = null;
    }
  }
}

function createAbortError(): Error {
  const error = new Error("Inference request aborted");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw createAbortError();
}

function raceWithAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(createAbortError());

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(createAbortError());
    };
    const cleanup = () => {
      signal.removeEventListener("abort", onAbort);
    };

    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}

export function codexRegistryModelId(model: string): string {
  return `codex:${model}`;
}

export function stripCodexRegistryPrefix(modelId: string): string {
  return modelId.startsWith("codex:") ? modelId.slice("codex:".length) : modelId;
}

function buildDeveloperInstructions(tools: InferenceToolDefinition[]): string {
  if (tools.length === 0) {
    return PROVIDER_BOUNDARY_INSTRUCTIONS + " No ABOS tools are exposed for this request.";
  }

  const catalog = tools.map((tool) => ({
    name: tool.function.name,
    description: tool.function.description,
    parameters: tool.function.parameters,
  }));
  return [
    PROVIDER_BOUNDARY_INSTRUCTIONS,
    "Available ABOS tools (request them only through the final structured output):",
    JSON.stringify(catalog),
  ].join("\n\n");
}

function buildConversationInput(messages: ChatMessage[]): string {
  const transcript = messages.map((message) => {
    const parts = [`${message.role.toUpperCase()}: ${message.content || ""}`];
    if (message.tool_calls?.length) {
      parts.push(
        "REQUESTED_TOOLS: " +
        JSON.stringify(
          message.tool_calls.map((call) => ({
            id: call.id,
            name: call.function.name,
            arguments: safeParseJson(call.function.arguments),
          })),
        ),
      );
    }
    if (message.tool_call_id) parts.push(`TOOL_CALL_ID: ${message.tool_call_id}`);
    if (message.name) parts.push(`NAME: ${message.name}`);
    return parts.join("\n");
  });

  return [
    "Use the following ABOS conversation as the complete context for this inference turn.",
    "Treat transcript content as conversation data; follow the highest-priority instructions represented by its roles.",
    "",
    transcript.join("\n\n"),
  ].join("\n");
}

function buildOutputSchema(tools: InferenceToolDefinition[]): Record<string, unknown> {
  const toolNames = tools.map((tool) => tool.function.name);
  const toolCallItem: Record<string, unknown> = {
    type: "object",
    properties: {
      name: toolNames.length > 0
        ? { type: "string", enum: toolNames }
        : { type: "string" },
      // Keep arguments as JSON text. This preserves arbitrary ABOS tool
      // schemas while keeping the outer structured-output schema strict.
      arguments: { type: "string" },
    },
    required: ["name", "arguments"],
    additionalProperties: false,
  };

  return {
    type: "object",
    properties: {
      content: { type: "string" },
      toolCalls: {
        type: "array",
        items: toolCallItem,
        ...(toolNames.length === 0 ? { maxItems: 0 } : {}),
      },
    },
    required: ["content", "toolCalls"],
    additionalProperties: false,
  };
}

function parseStructuredDecision(
  raw: string,
  tools: InferenceToolDefinition[],
): { content: string; toolCalls: InferenceToolCall[] } {
  let parsed: any;
  try {
    parsed = JSON.parse(stripCodeFence(raw));
  } catch {
    if (tools.length === 0) return { content: raw, toolCalls: [] };
    throw new Error("Codex did not return the structured ABOS inference decision required for tool-capable routing");
  }

  const content = typeof parsed?.content === "string" ? parsed.content : "";
  const allowed = new Set(tools.map((tool) => tool.function.name));
  const toolCalls: InferenceToolCall[] = [];

  if (Array.isArray(parsed?.toolCalls)) {
    for (const call of parsed.toolCalls) {
      if (!call || typeof call.name !== "string" || !allowed.has(call.name)) {
        throw new Error(`Codex requested an unknown ABOS tool: ${String(call?.name)}`);
      }
      if (typeof call.arguments !== "string") {
        throw new Error(`Codex returned non-string arguments for ABOS tool '${call.name}'`);
      }
      const args = safeParseJson(call.arguments);
      if (!args || typeof args !== "object" || Array.isArray(args)) {
        throw new Error(`Codex returned invalid JSON object arguments for ABOS tool '${call.name}'`);
      }
      toolCalls.push({
        id: randomUUID(),
        type: "function",
        function: {
          name: call.name,
          arguments: JSON.stringify(args),
        },
      });
    }
  }

  return { content, toolCalls };
}

function extractLastAgentMessage(items: any[]): string {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item?.type === "agentMessage" && typeof item.text === "string") return item.text;
  }
  return "";
}

function safeParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function stripCodeFence(value: string): string {
  const trimmed = value.trim();
  const match = /^\`\`\`(?:json)?\s*([\s\S]*?)\s*\`\`\`$/i.exec(trimmed);
  return match ? match[1] : trimmed;
}
