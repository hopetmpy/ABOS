import { describe, expect, it, vi } from "vitest";
import type { CodexRpcTransport } from "../codex/app-server.js";
import { CodexInferenceRuntime } from "../codex/inference.js";
import type { InferenceToolDefinition } from "../types.js";

class FakeInferenceTransport implements CodexRpcTransport {
  started = false;
  closed = false;
  requests: Array<{ method: string; params?: Record<string, unknown> }> = [];
  private handlers = new Map<string, Set<(params: unknown) => void>>();
  private notifications = new Map<string, unknown[]>();
  emitBoundaryViolation = false;
  holdCompletion = false;

  async start(): Promise<void> {
    this.started = true;
    this.closed = false;
  }

  isReady(): boolean {
    return this.started && !this.closed;
  }

  onNotification(method: string, handler: (params: unknown) => void): () => void {
    const set = this.handlers.get(method) || new Set();
    set.add(handler);
    this.handlers.set(method, set);
    return () => this.handlers.get(method)?.delete(handler);
  }

  async request<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    this.requests.push({ method, params });

    if (method === "thread/start") {
      return { thread: { id: "thread-1" } } as T;
    }

    if (method === "turn/start") {
      if (this.emitBoundaryViolation) {
        this.emit("item/started", {
          threadId: "thread-1",
          turnId: "turn-1",
          item: { type: "commandExecution" },
        });
      }

      this.emit("thread/tokenUsage/updated", {
        threadId: "thread-1",
        turnId: "turn-1",
        tokenUsage: {
          last: {
            inputTokens: 120,
            outputTokens: 30,
            totalTokens: 150,
          },
        },
      });

      this.emit("item/completed", {
        threadId: "thread-1",
        turnId: "turn-1",
        item: {
          type: "agentMessage",
          text: JSON.stringify({
            content: "I will inspect it.",
            toolCalls: [{
              name: "inspect_state",
              arguments: JSON.stringify({ scope: "runtime" }),
            }],
          }),
        },
      });

      if (!this.holdCompletion) {
        this.queue("turn/completed", {
          threadId: "thread-1",
          turn: { id: "turn-1", status: "completed", items: [] },
        });
      }

      return { turn: { id: "turn-1", status: "inProgress" } } as T;
    }

    if (method === "turn/interrupt") return {} as T;
    throw new Error(`Unexpected fake request: ${method}`);
  }

  async waitForNotification<T>(
    method: string,
    predicate: (params: T) => boolean,
  ): Promise<T> {
    const match = (this.notifications.get(method) || []).find((item) => predicate(item as T));
    if (match) return match as T;
    if (this.holdCompletion && method === "turn/completed") {
      return new Promise<T>(() => {});
    }
    throw new Error(`No matching fake notification for ${method}`);
  }

  close(): void {
    this.closed = true;
  }

  simulateCrash(): void {
    this.closed = true;
  }

  private emit(method: string, params: unknown): void {
    for (const handler of this.handlers.get(method) || []) handler(params);
  }

  private queue(method: string, params: unknown): void {
    const list = this.notifications.get(method) || [];
    list.push(params);
    this.notifications.set(method, list);
  }
}

const tool: InferenceToolDefinition = {
  type: "function",
  function: {
    name: "inspect_state",
    description: "Inspect ABOS runtime state",
    parameters: {
      type: "object",
      properties: {
        scope: { type: "string" },
      },
      required: ["scope"],
    },
  },
};

describe("CodexInferenceRuntime", () => {
  it("uses the selected Codex model and preserves ABOS tool-broker semantics", async () => {
    const fake = new FakeInferenceTransport();
    const runtime = new CodexInferenceRuntime({
      transportFactory: () => fake,
      getReasoningEffort: () => "high",
    });

    const response = await runtime.chat(
      [{ role: "user", content: "Inspect the runtime" }],
      { tools: [tool] },
      "codex:gpt-test",
    );

    expect(response.model).toBe("gpt-test");
    expect(response.message.content).toBe("I will inspect it.");
    expect(response.toolCalls).toHaveLength(1);
    expect(response.toolCalls?.[0].function.name).toBe("inspect_state");
    expect(JSON.parse(response.toolCalls?.[0].function.arguments || "{}")).toEqual({
      scope: "runtime",
    });
    expect(response.usage).toEqual({
      promptTokens: 120,
      completionTokens: 30,
      totalTokens: 150,
    });

    const threadStart = fake.requests.find((request) => request.method === "thread/start");
    expect(threadStart?.params).toMatchObject({
      model: "gpt-test",
      ephemeral: true,
      approvalPolicy: "never",
      sandbox: "read-only",
    });

    const turnStart = fake.requests.find((request) => request.method === "turn/start");
    expect(turnStart?.params).toMatchObject({
      threadId: "thread-1",
      model: "gpt-test",
      effort: "high",
    });
    expect(turnStart?.params?.outputSchema).toBeDefined();
  });

  it("restarts the app-server transport after it becomes unhealthy", async () => {
    const first = new FakeInferenceTransport();
    const second = new FakeInferenceTransport();
    const transports = [first, second];
    let factoryCalls = 0;

    const runtime = new CodexInferenceRuntime({
      transportFactory: () => transports[factoryCalls++],
    });

    await runtime.chat(
      [{ role: "user", content: "First turn" }],
      { tools: [tool] },
      "codex:gpt-test",
    );
    expect(factoryCalls).toBe(1);

    first.simulateCrash();

    await runtime.chat(
      [{ role: "user", content: "Second turn" }],
      { tools: [tool] },
      "codex:gpt-test",
    );
    expect(factoryCalls).toBe(2);
    expect(second.started).toBe(true);
  });

  it("interrupts an in-flight Codex turn when the router aborts", async () => {
    const fake = new FakeInferenceTransport();
    fake.holdCompletion = true;
    const runtime = new CodexInferenceRuntime({ transportFactory: () => fake });
    const controller = new AbortController();

    const pending = runtime.chat(
      [{ role: "user", content: "Keep thinking" }],
      { tools: [tool], signal: controller.signal },
      "codex:gpt-test",
    );

    // Abort as soon as turn/start has been issued. This intentionally allows
    // the abort to race with turn-id assignment; production must still
    // interrupt once the id becomes known.
    await vi.waitFor(() => {
      expect(
        fake.requests.some((request) => request.method === "turn/start"),
      ).toBe(true);
    });
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });

    await vi.waitFor(() => {
      expect(
        fake.requests.filter(
          (request) =>
            request.method === "turn/interrupt" &&
            request.params?.threadId === "thread-1" &&
            request.params?.turnId === "turn-1",
        ),
      ).toHaveLength(1);
    });
  });

  it("rejects provider-native side effects instead of bypassing ABOS execution", async () => {
    const fake = new FakeInferenceTransport();
    fake.emitBoundaryViolation = true;
    const runtime = new CodexInferenceRuntime({ transportFactory: () => fake });

    await expect(
      runtime.chat(
        [{ role: "user", content: "Use the host shell directly" }],
        { tools: [tool] },
        "codex:gpt-test",
      ),
    ).rejects.toThrow(/outside the ABOS capability broker/);

    expect(
      fake.requests.filter(
        (request) =>
          request.method === "turn/interrupt" &&
          request.params?.threadId === "thread-1" &&
          request.params?.turnId === "turn-1",
      ),
    ).toHaveLength(1);
  });
});
