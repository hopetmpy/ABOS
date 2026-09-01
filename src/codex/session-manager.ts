/**
 * High-level Codex account and model-catalog control plane.
 */

import { CodexAppServerClient, type CodexRpcTransport } from "./app-server.js";
import type {
  CodexAccountReadResponse,
  CodexDeviceCodeLoginResponse,
  CodexLoginCompletedNotification,
  CodexModelDescriptor,
  CodexModelListResponse,
} from "./types.js";

export type CodexTransportFactory = () => CodexRpcTransport;

export class CodexDeviceLoginHandle {
  readonly loginId: string;
  readonly verificationUrl: string;
  readonly userCode: string;
  private closed = false;

  constructor(
    private readonly transport: CodexRpcTransport,
    response: CodexDeviceCodeLoginResponse,
  ) {
    this.loginId = response.loginId;
    this.verificationUrl = response.verificationUrl;
    this.userCode = response.userCode;
  }

  async wait(timeoutMs = 10 * 60_000): Promise<CodexLoginCompletedNotification> {
    try {
      return await this.transport.waitForNotification<CodexLoginCompletedNotification>(
        "account/login/completed",
        (params) => params.loginId === this.loginId,
        timeoutMs,
      );
    } finally {
      this.close();
    }
  }

  async cancel(): Promise<void> {
    if (this.closed) return;
    try {
      await this.transport.request("account/login/cancel", { loginId: this.loginId });
    } finally {
      this.close();
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.transport.close();
  }
}

export class CodexSessionManager {
  constructor(
    private readonly transportFactory: CodexTransportFactory = () => new CodexAppServerClient(),
  ) {}

  async account(refreshToken = false): Promise<CodexAccountReadResponse> {
    return this.withTransport((transport) =>
      transport.request<CodexAccountReadResponse>("account/read", {
        refreshToken,
      }),
    );
  }

  async beginDeviceCodeLogin(): Promise<CodexDeviceLoginHandle> {
    const transport = this.transportFactory();
    await transport.start();

    try {
      const response = await transport.request<CodexDeviceCodeLoginResponse>(
        "account/login/start",
        { type: "chatgptDeviceCode" },
      );
      if (
        response?.type !== "chatgptDeviceCode" ||
        !response.loginId ||
        !response.verificationUrl ||
        !response.userCode
      ) {
        throw new Error("Codex returned an invalid device-code login response");
      }
      return new CodexDeviceLoginHandle(transport, response);
    } catch (error) {
      transport.close();
      throw error;
    }
  }

  async logout(): Promise<void> {
    await this.withTransport(async (transport) => {
      await transport.request("account/logout");
    });
  }

  async listModels(includeHidden = false): Promise<CodexModelDescriptor[]> {
    return this.withTransport(async (transport) => {
      const models: CodexModelDescriptor[] = [];
      let cursor: string | null | undefined;

      do {
        const response = await transport.request<CodexModelListResponse>("model/list", {
          limit: 100,
          includeHidden,
          ...(cursor ? { cursor } : {}),
        });
        if (Array.isArray(response?.data)) models.push(...response.data);
        cursor = response?.nextCursor;
      } while (cursor);

      return models;
    });
  }

  private async withTransport<T>(
    callback: (transport: CodexRpcTransport) => Promise<T>,
  ): Promise<T> {
    const transport = this.transportFactory();
    await transport.start();
    try {
      return await callback(transport);
    } finally {
      transport.close();
    }
  }
}
