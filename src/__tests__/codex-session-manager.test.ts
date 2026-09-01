import { describe, expect, it } from "vitest";
import type { CodexRpcTransport } from "../codex/app-server.js";
import { CodexSessionManager } from "../codex/session-manager.js";

class FakeTransport implements CodexRpcTransport {
  started = false;
  closed = false;
  requests: Array<{ method: string; params?: Record<string, unknown> }> = [];
  notifications = new Map<string, unknown[]>();
  responses = new Map<string, unknown[]>();

  async start(): Promise<void> {
    this.started = true;
  }

  isReady(): boolean {
    return this.started && !this.closed;
  }

  async request<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    this.requests.push({ method, params });
    const queue = this.responses.get(method) || [];
    if (queue.length === 0) throw new Error(`No fake response for ${method}`);
    return queue.shift() as T;
  }

  onNotification(_method: string, _handler: (params: unknown) => void): () => void {
    return () => undefined;
  }

  async waitForNotification<T>(
    method: string,
    predicate: (params: T) => boolean,
  ): Promise<T> {
    const match = (this.notifications.get(method) || []).find((item) => predicate(item as T));
    if (!match) throw new Error(`No matching fake notification for ${method}`);
    return match as T;
  }

  close(): void {
    this.closed = true;
  }
}

describe("CodexSessionManager", () => {
  it("starts device-code login without exposing OAuth credentials", async () => {
    const fake = new FakeTransport();
    fake.responses.set("account/login/start", [{
      type: "chatgptDeviceCode",
      loginId: "login-1",
      verificationUrl: "https://example.test/device",
      userCode: "ABCD-EFGH",
    }]);
    fake.notifications.set("account/login/completed", [{
      loginId: "login-1",
      success: true,
      error: null,
    }]);

    const manager = new CodexSessionManager(() => fake);
    const login = await manager.beginDeviceCodeLogin();

    expect(fake.started).toBe(true);
    expect(login.verificationUrl).toBe("https://example.test/device");
    expect(login.userCode).toBe("ABCD-EFGH");
    expect(fake.requests[0]).toEqual({
      method: "account/login/start",
      params: { type: "chatgptDeviceCode" },
    });

    const completed = await login.wait();
    expect(completed.success).toBe(true);
    expect(fake.closed).toBe(true);
  });

  it("reads account state and closes the app-server transport", async () => {
    const fake = new FakeTransport();
    fake.responses.set("account/read", [{
      account: { type: "chatgpt", email: "user@example.test", planType: "plus" },
    }]);

    const manager = new CodexSessionManager(() => fake);
    const account = await manager.account();

    expect(account.account?.type).toBe("chatgpt");
    expect(fake.requests).toContainEqual({
      method: "account/read",
      params: { refreshToken: false },
    });
    expect(fake.closed).toBe(true);
  });

  it("paginates model/list and preserves provider metadata", async () => {
    const fake = new FakeTransport();
    const first = {
      id: "id-a",
      model: "model-a",
      displayName: "Model A",
      description: "A",
      hidden: false,
      isDefault: true,
      defaultReasoningEffort: "high",
      supportedReasoningEfforts: [{ reasoningEffort: "high", description: "High" }],
    };
    const second = {
      id: "id-b",
      model: "model-b",
      displayName: "Model B",
      description: "B",
      hidden: false,
      isDefault: false,
      defaultReasoningEffort: "medium",
      supportedReasoningEfforts: [{ reasoningEffort: "medium", description: "Medium" }],
    };

    fake.responses.set("model/list", [
      { data: [first], nextCursor: "cursor-2" },
      { data: [second], nextCursor: null },
    ]);

    const manager = new CodexSessionManager(() => fake);
    const models = await manager.listModels(false);

    expect(models.map((model) => model.model)).toEqual(["model-a", "model-b"]);
    expect(models[0].supportedReasoningEfforts[0].reasoningEffort).toBe("high");
    expect(fake.requests).toEqual([
      {
        method: "model/list",
        params: { limit: 100, includeHidden: false },
      },
      {
        method: "model/list",
        params: { limit: 100, includeHidden: false, cursor: "cursor-2" },
      },
    ]);
    expect(fake.closed).toBe(true);
  });

  it("logs out through Codex rather than deleting copied tokens", async () => {
    const fake = new FakeTransport();
    fake.responses.set("account/logout", [{}]);

    const manager = new CodexSessionManager(() => fake);
    await manager.logout();

    expect(fake.requests).toEqual([{ method: "account/logout", params: undefined }]);
    expect(fake.closed).toBe(true);
  });
});
