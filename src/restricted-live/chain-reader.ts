import { BASE_CHAIN_ID, BASE_USDC_ADDRESS, RestrictedLiveViolation, assertAllowedUrl } from "./mode.js";

export interface RpcTransport { request(method: string, params: unknown[]): Promise<unknown> }
export interface ChainReadAudit { record(event: string, metadata?: Record<string, unknown>): void }
const READ_METHODS = new Set(["eth_chainId", "eth_getBalance", "eth_call", "eth_getTransactionReceipt"]);

export class RestrictedBaseRpcTransport implements RpcTransport {
  private readonly url: string;
  private requestId = 0;
  constructor(rpcUrl: string, private readonly audit: ChainReadAudit) {
    this.url = assertAllowedUrl(rpcUrl, "baseRpcOrigins").toString();
  }
  async request(method: string, params: unknown[]): Promise<unknown> {
    if (!READ_METHODS.has(method)) {
      this.audit.record("network_call_denied", { origin: new URL(this.url).origin, method, reason: "RPC method is not read-only allowlisted" });
      throw new RestrictedLiveViolation("RPC_WRITE_DENIED", `RPC method denied: ${method}`);
    }
    this.audit.record("network_call_allowed", { origin: new URL(this.url).origin, method });
    let response: Response;
    try {
      response = await fetch(this.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++this.requestId, method, params }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      const detail = sanitizeNetworkError(error);
      throw new RestrictedLiveViolation("RPC_READ_FAILED", `Base RPC ${method} network failure: ${detail}`);
    }
    if (!response.ok) throw new RestrictedLiveViolation("RPC_READ_FAILED", `Base RPC read failed with HTTP ${response.status}`);
    const payload = await response.json() as { result?: unknown; error?: { message?: string } };
    if (payload.error || payload.result === undefined) throw new RestrictedLiveViolation("RPC_READ_FAILED", payload.error?.message ?? "Base RPC returned no result");
    return payload.result;
  }
}

function sanitizeNetworkError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  // Keep diagnostics useful while excluding request data, credentials, and
  // potentially embedded authorization material from provider errors.
  const sanitized = raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/0x[a-f0-9]{32,}/gi, "[redacted-hex]").trim();
  return (sanitized || "network request failed").slice(0, 240);
}

export class RestrictedChainReader {
  constructor(rpcUrl: string, private readonly walletAddress: string, private readonly transport: RpcTransport) { assertAllowedUrl(rpcUrl, "baseRpcOrigins"); }
  request(method: string, params: unknown[]): Promise<unknown> {
    if (!READ_METHODS.has(method)) throw new RestrictedLiveViolation("RPC_WRITE_DENIED", `RPC method denied: ${method}`);
    if (method === "eth_getBalance" && String(params[0]).toLowerCase() !== this.walletAddress.toLowerCase()) throw new RestrictedLiveViolation("RPC_SCOPE_DENIED", "May read only the dedicated wallet balance");
    if (method === "eth_call") {
      const call = params[0] as Record<string, unknown> | undefined;
      if (!call || String(call.to).toLowerCase() !== BASE_USDC_ADDRESS.toLowerCase()) throw new RestrictedLiveViolation("RPC_SCOPE_DENIED", "Only Base USDC balanceOf reads are allowed");
    }
    return this.transport.request(method, params);
  }
  async getChainId(): Promise<number> {
    const result = String(await this.request("eth_chainId", []));
    const chainId = Number.parseInt(result, 16);
    if (chainId !== BASE_CHAIN_ID) throw new RestrictedLiveViolation("CHAIN_DENIED", `Unexpected chain ID: ${chainId}`);
    return chainId;
  }
  async getOwnEthBalance(): Promise<string> {
    const wei = BigInt(String(await this.request("eth_getBalance", [this.walletAddress, "latest"])));
    return formatUnits(wei, 18);
  }
  async getOwnUsdcBalance(): Promise<string> {
    return formatUnits(await this.getOwnUsdcBalanceBaseUnits(), 6);
  }
  async getOwnUsdcBalanceBaseUnits(): Promise<bigint> {
    const address = this.walletAddress.toLowerCase().replace(/^0x/, "").padStart(64, "0");
    const data = `0x70a08231${address}`;
    return BigInt(String(await this.request("eth_call", [{ to: BASE_USDC_ADDRESS, data }, "latest"])));
  }
  static readonly chainId = BASE_CHAIN_ID;
}

function formatUnits(value: bigint, decimals: number): string {
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fraction = (value % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}
