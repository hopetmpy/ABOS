import { describe, expect, it } from "vitest";
import { CodexAppServerClient } from "../codex/app-server.js";

const FAKE_APP_SERVER = String.raw`
const readline = require("node:readline");
const rl = readline.createInterface({ input: process.stdin });
function send(value) { process.stdout.write(JSON.stringify(value) + "\\n"); }

rl.on("line", (line) => {
  let message;
  try { message = JSON.parse(line); } catch { return; }

  if (message.method === "initialize" && message.id !== undefined) {
    send({
      id: message.id,
      result: {
        serverInfo: { name: "fake-codex", version: "0.0.0-test" }
      }
    });
    return;
  }

  if (message.method === "account/read" && message.id !== undefined) {
    send({
      method: "account/updated",
      params: { account: null, requiresOpenaiAuth: true }
    });
    send({
      id: message.id,
      result: { account: null, requiresOpenaiAuth: true }
    });
    return;
  }

  if (message.method === "model/list" && message.id !== undefined) {
    send({
      id: message.id,
      result: {
        data: [{
          id: "fake-id",
          model: "fake-model",
          displayName: "Fake Model",
          description: "transport smoke model",
          hidden: false,
          isDefault: true,
          defaultReasoningEffort: "medium",
          supportedReasoningEfforts: [{
            reasoningEffort: "medium",
            description: "Medium"
          }]
        }],
        nextCursor: null
      }
    });
  }
});
`;

describe("CodexAppServerClient transport", () => {
  it("performs a real JSONL stdio initialize/request/notification round trip", async () => {
    const client = new CodexAppServerClient({
      command: process.execPath,
      args: ["-e", FAKE_APP_SERVER],
      requestTimeoutMs: 5_000,
    });

    await client.start();

    const notificationPromise = client.waitForNotification<{
      account: null;
      requiresOpenaiAuth: boolean;
    }>(
      "account/updated",
      (params) => params.requiresOpenaiAuth === true,
      5_000,
    );

    const account = await client.request<{
      account: null;
      requiresOpenaiAuth: boolean;
    }>("account/read", { refreshToken: false });

    expect(account).toEqual({
      account: null,
      requiresOpenaiAuth: true,
    });
    await expect(notificationPromise).resolves.toEqual({
      account: null,
      requiresOpenaiAuth: true,
    });

    const models = await client.request<{
      data: Array<{ model: string }>;
      nextCursor: null;
    }>("model/list", { limit: 100, includeHidden: false });

    expect(models.data[0].model).toBe("fake-model");
    expect(models.nextCursor).toBeNull();

    client.close();
  });

  it("reports an unavailable Codex executable as an actionable startup error", async () => {
    const client = new CodexAppServerClient({
      command: "__abos_missing_codex_binary__",
      requestTimeoutMs: 500,
    });

    await expect(client.start()).rejects.toThrow(/Codex CLI is unavailable/);
    client.close();
  });
});
