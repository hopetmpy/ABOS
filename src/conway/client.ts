/**
 * Conway API Client
 *
 * Communicates with Conway's control plane for sandbox management,
 * credits, and infrastructure operations.
 * Adapted from @aiws/sdk patterns.
 */

import fs from "fs";
import nodePath from "path";
import type {
  ConwayClient,
  ExecResult,
  ExecOptions,
  ManagedProcessSnapshot,
  ManagedProcessStartOptions,
  MoveResult,
  PortInfo,
  CreateSandboxOptions,
  SandboxInfo,
  PricingTier,
  ConwayCreditHistoryPage,
  CreditTransferResult,
  DomainSearchResult,
  DomainRegistration,
  DnsRecord,
  ModelInfo,
} from "../types.js";
import { ResilientHttpClient } from "./http-client.js";
import { ulid } from "ulid";
import { keccak256, toHex } from "viem";
import type { Address, PrivateKeyAccount } from "viem";
import { randomUUID } from "crypto";
import type { ChainType, ChainIdentity } from "../identity/chain.js";
import { expandHomePath, getHomeDir } from "../platform/home.js";
import { getLocalComputerRuntime } from "../platform/local-computer-runtime.js";

interface ConwayClientOptions {
  apiUrl: string;
  apiKey: string;
  sandboxId: string;
}

export function createConwayClient(options: ConwayClientOptions): ConwayClient {
  const { apiUrl, apiKey } = options;
  // Normalize sandbox ID defensively so values like whitespace/"undefined"/"null"
  // never produce malformed API paths such as /v1/sandboxes//exec.
  const sandboxId = normalizeSandboxId(options.sandboxId);
  const httpClient = new ResilientHttpClient();

  async function request(
    method: string,
    path: string,
    body?: unknown,
    requestOptions?: { idempotencyKey?: string; retries404?: number; retries?: number; noStore?: boolean; expectedStatus?: number },
  ): Promise<any> {
    // Conway LB has an intermittent routing bug that returns 404 for valid
    // sandbox endpoints. Retry 404s here (outside ResilientHttpClient) to
    // avoid tripping the circuit breaker on transient routing failures.
    const max404Retries = requestOptions?.retries404 ?? 3;
    for (let attempt = 0; attempt <= max404Retries; attempt++) {
      const resp = await httpClient.request(`${apiUrl}${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: apiKey,
          ...(requestOptions?.noStore
            ? { "Cache-Control": "no-store, max-age=0", Pragma: "no-cache" }
            : {}),
        },
        cache: requestOptions?.noStore ? "no-store" : undefined,
        body: body ? JSON.stringify(body) : undefined,
        idempotencyKey: requestOptions?.idempotencyKey,
        // A destructive, possibly non-idempotent provider mutation must not
        // be silently replayed after a lost response by the HTTP transport.
        retries: requestOptions?.retries,
      });

      if (requestOptions?.expectedStatus !== undefined &&
          resp.status !== requestOptions.expectedStatus) {
        const err = new Error(
          `Conway API returned unexpected status for ${method} ${path}: ${resp.status}; provider outcome UNKNOWN.`,
        ) as Error & { status?: number };
        err.status = resp.status;
        throw err;
      }

      if (resp.status === 404 && attempt < max404Retries) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }

      if (!resp.ok) {
        const text = await resp.text();
        const err: any = new Error(
          `Conway API error: ${method} ${path} -> ${resp.status}: ${text}`,
        );
        err.status = resp.status;
        err.responseText = text;
        err.method = method;
        err.path = path;
        throw err;
      }

      return resp.headers.get("content-type")?.includes("application/json")
        ? resp.json()
        : resp.text();
    }

    throw new Error("Unreachable");
  }

  const canonicalizePayload = (payload: Record<string, string>): string => {
    const sortedKeys = Object.keys(payload).sort();
    const sorted: Record<string, string> = {};
    for (const key of sortedKeys) {
      sorted[key] = payload[key];
    }
    return JSON.stringify(sorted);
  };

  const hashIdentityPayload = (payload: Record<string, string>): `0x${string}` => {
    const canonical = canonicalizePayload(payload);
    return keccak256(toHex(canonical));
  };


  // ─── Sandbox Operations (own sandbox) ────────────────────────
  // When sandboxId is empty, automatically fall back to local execution.

  const isLocal = !sandboxId;

  const localComputer = getLocalComputerRuntime();

  const exec = async (
    command: string,
    timeout?: number,
    options: ExecOptions = {},
  ): Promise<ExecResult> => {
    if (isLocal) return localComputer.exec(command, timeout, options);
    if (options.cwd || options.env) {
      throw new Error(
        "Explicit cwd/env are currently a local-host capability. Remote Conway exec keeps its provider contract instead of pretending local equivalence.",
      );
    }

    // Remote sandboxes default to / as cwd. Wrap commands to run from /root
    // (matching historical remote exec behavior).
    const wrappedCommand = `cd /root && ${command}`;

    try {
      const result = await request(
        "POST",
        `/v1/sandboxes/${sandboxId}/exec`,
        { command: wrappedCommand, timeout },
        { idempotencyKey: ulid() },
      );
      return {
        stdout: result.stdout || "",
        stderr: result.stderr || "",
        exitCode: result.exit_code ?? result.exitCode ?? -1,
      };
    } catch (err: any) {
      if (err?.status === 403) {
        throw new Error(
          `Conway API authentication failed (403). Sandbox exec refused. ` +
            `This may indicate a misconfigured or revoked API key. ` +
            `Command will NOT be executed locally for security reasons.`,
        );
      }
      throw err;
    }
  };

  const requireLocalProcessLifecycle = (): void => {
    if (!isLocal) {
      throw new Error(
        "Managed process lifecycle is currently available only on the explicit local host; remote Conway sandboxes remain a separate execution authority.",
      );
    }
  };

  const startProcess = async (
    command: string,
    options: ManagedProcessStartOptions = {},
  ): Promise<ManagedProcessSnapshot> => {
    requireLocalProcessLifecycle();
    return localComputer.start(command, options);
  };

  const waitProcess = async (
    handle: string,
    timeoutMs?: number,
  ): Promise<ManagedProcessSnapshot> => {
    requireLocalProcessLifecycle();
    return localComputer.wait(handle, timeoutMs);
  };

  const cancelProcess = async (handle: string): Promise<ManagedProcessSnapshot> => {
    requireLocalProcessLifecycle();
    return localComputer.cancel(handle);
  };

  const killProcess = async (handle: string): Promise<ManagedProcessSnapshot> => {
    requireLocalProcessLifecycle();
    return localComputer.kill(handle);
  };

  const moveFile = async (source: string, destination: string): Promise<MoveResult> => {
    requireLocalProcessLifecycle();
    return localComputer.moveFile(source, destination);
  };

  const resolveLocalPath = (filePath: string): string => {
    const portable = filePath.replace(/\\/g, "/");
    if (portable === "/root") return getHomeDir();
    if (portable.startsWith("/root/")) {
      return nodePath.join(
        getHomeDir(),
        ...portable.slice("/root/".length).split("/").filter(Boolean),
      );
    }
    return expandHomePath(filePath);
  };

  const writeFile = async (
    filePath: string,
    content: string,
  ): Promise<void> => {
    if (isLocal) {
      const resolved = resolveLocalPath(filePath);
      const dir = nodePath.dirname(resolved);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(resolved, content, "utf-8");
      return;
    }
    try {
      await request("POST", `/v1/sandboxes/${sandboxId}/files/upload/json`, {
        path: filePath,
        content,
      });
    } catch (err: any) {
      // SECURITY: Never silently fall back to local FS on auth failure.
      if (err?.status === 403) {
        throw new Error(
          `Conway API authentication failed (403). File write refused. ` +
            `File will NOT be written locally for security reasons.`,
        );
      }
      throw err;
    }
  };

  const readFile = async (filePath: string): Promise<string> => {
    if (isLocal) {
      return fs.readFileSync(resolveLocalPath(filePath), "utf-8");
    }
    try {
      const result = await request(
        "GET",
        `/v1/sandboxes/${sandboxId}/files/read?path=${encodeURIComponent(filePath)}`,
        undefined,
        { retries404: 0 },
      );
      return typeof result === "string" ? result : result.content || "";
    } catch (err: any) {
      // SECURITY: Never silently fall back to local FS on auth failure.
      if (err?.status === 403) {
        throw new Error(
          `Conway API authentication failed (403). File read refused. ` +
            `File will NOT be read locally for security reasons.`,
        );
      }
      throw err;
    }
  };

  const exposePort = async (port: number): Promise<PortInfo> => {
    if (isLocal) {
      return {
        port,
        publicUrl: `http://localhost:${port}`,
        sandboxId: "local",
      };
    }
    const result = await request(
      "POST",
      `/v1/sandboxes/${sandboxId}/ports/expose`,
      { port },
    );
    return {
      port: result.port,
      publicUrl: result.public_url || result.publicUrl || result.url,
      sandboxId,
    };
  };

  const removePort = async (port: number): Promise<void> => {
    if (isLocal) return;
    await request("DELETE", `/v1/sandboxes/${sandboxId}/ports/${port}`);
  };

  // ─── Sandbox Management (other sandboxes) ────────────────────

  const createSandbox = async (
    options: CreateSandboxOptions,
  ): Promise<SandboxInfo> => {
    const result = await request("POST", "/v1/sandboxes", {
      name: options.name,
      vcpu: options.vcpu || 1,
      memory_mb: options.memoryMb || 512,
      disk_gb: options.diskGb || 5,
      region: options.region,
    }, {
      // P-031: a sandbox CREATE may incur charges. The shared HTTP client
      // otherwise retries 502/timeouts and the Conway wrapper retries 404.
      // Neither supplier idempotency nor no-dispatch can be inferred from a
      // lost response: never create a second sandbox automatically.
      retries: 0,
      retries404: 0,
    });
    return {
      id: result.id || result.sandbox_id,
      status: result.status || "running",
      region: result.region || "",
      vcpu: result.vcpu || options.vcpu || 1,
      memoryMb: result.memory_mb || options.memoryMb || 512,
      diskGb: result.disk_gb || options.diskGb || 5,
      terminalUrl: result.terminal_url,
      createdAt: result.created_at || new Date().toISOString(),
    };
  };

  const deleteSandbox = async (targetId: string): Promise<void> => {
    // Provider docs declare DELETE /v1/sandboxes/:id => 204 No Content.
    // Historical source used a silent no-op: it could never prove deletion.
    // The exact provider resource ID is required, never a remote path/query
    // or model-generated shell command. Unknown provider outcomes are fatal.
    if (typeof targetId !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9_-]{0,255}$/.test(targetId)) {
      throw new Error("Conway sandbox deletion requires a valid exact sandbox ID.");
    }
    await request(
      "DELETE",
      `/v1/sandboxes/${encodeURIComponent(targetId)}`,
      undefined,
      { retries404: 0, retries: 0, noStore: true, expectedStatus: 204 },
    );
    // Successful 204 is the supplier's acknowledgement of resource removal,
    // never proof of credit refund, subscription cancellation or zero bills.
  };

  const listSandboxes = async (): Promise<SandboxInfo[]> => {
    const result: unknown = await request("GET", "/v1/sandboxes");
    // Conway documents { data: [...] }; deployed/legacy providers may use
    // { sandboxes: [...] } or an array. An unrecognized response is UNKNOWN,
    // never "no sandbox": P-018 reuse, health and reconciliation depend on it.
    const response = result && typeof result === "object" && !Array.isArray(result)
      ? result as Record<string, unknown> : null;
    const raw: unknown = Array.isArray(result) ? result
      : response?.data ?? response?.sandboxes;
    if (!Array.isArray(raw)) {
      throw new Error("Conway sandbox inventory shape is unrecognized; resource existence UNKNOWN.");
    }
    // Do not interpret a partial provider view as an authoritative empty list.
    // Pagination is not exposed by ConwayProbe: fail closed rather than
    // treating an unseen page's resources as absent.
    const total = response?.count ?? response?.total;
    const hasMore = response?.hasMore === true || response?.has_more === true ||
      [response?.next_cursor, response?.nextCursor, response?.next_token,
        response?.nextToken].some(value => typeof value === "string" && value.trim());
    if (response?.source === "workers_fallback_blocked" ||
        response?.partial === true || hasMore ||
        (total !== undefined && (!Number.isSafeInteger(total) ||
          (total as number) < raw.length || (total as number) > raw.length))) {
      throw new Error("Conway sandbox inventory is incomplete/unavailable; resource existence UNKNOWN.");
    }
    // A repeated provider ID is an ambiguous snapshot, not two resources.
    // In particular, conflicting duplicate statuses must never be selected
    // arbitrarily by P-018 health/reconciliation or counted as spare capacity.
    const seenSandboxIds = new Set<string>();
    return raw.map((item: unknown): SandboxInfo => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw new Error("Conway sandbox inventory has an invalid entry; resource existence UNKNOWN.");
      }
      const sandbox = item as Record<string, unknown>;
      const id = sandbox.id ?? sandbox.sandbox_id;
      if (typeof id !== "string" || !id.trim()) {
        throw new Error("Conway sandbox inventory has an unidentifiable resource; existence UNKNOWN.");
      }
      if (seenSandboxIds.has(id)) {
        throw new Error("Conway sandbox inventory repeats a resource identifier; existence UNKNOWN.");
      }
      seenSandboxIds.add(id);
      const numeric = (value: unknown) => typeof value === "number" &&
        Number.isSafeInteger(value) && value >= 0 ? value : 0;
      return {
        id,
        status: typeof sandbox.status === "string" ? sandbox.status : "unknown",
        region: typeof sandbox.region === "string" ? sandbox.region : "",
        vcpu: numeric(sandbox.vcpu),
        memoryMb: numeric(sandbox.memory_mb),
        diskGb: numeric(sandbox.disk_gb),
        terminalUrl: typeof sandbox.terminal_url === "string"
          ? sandbox.terminal_url : undefined,
        createdAt: typeof sandbox.created_at === "string" ? sandbox.created_at : "",
      };
    });
  };

  // ─── Credits ─────────────────────────────────────────────────

  const getCreditsBalance = async (): Promise<number> => {
    // Prefer an uncached HTTP observation for treasury decisions. This is only
    // a cache directive: it cannot authenticate wallet scope, provider event
    // time or finality, and an upstream provider could still serve stale data.
    const result = await request("GET", "/v1/credits/balance", undefined, { noStore: true });
    const observed = result?.balance_cents ?? result?.credits_cents;
    if (!Number.isSafeInteger(observed)) {
      throw new Error(
        "Conway credit balance was not a valid observed integer; UNKNOWN must not become zero.",
      );
    }
    return observed;
  };

  /**
   * Conway Terminal documents authenticated credit history with limit/offset.
   * Only a bounded GET page is observed. Neither a provider HTTP transaction
   * nor a wallet credit movement by itself proves x402 chain settlement,
   * receiving account ownership, invoice finality or available cash.
   */
  const getCreditsHistory = async (
    limit = 20, offset = 0,
  ): Promise<ConwayCreditHistoryPage> => {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 ||
        !Number.isSafeInteger(offset) || offset < 0) {
      throw new Error("Conway credit history requires bounded integer pagination.");
    }
    const result: unknown = await request(
      "GET", `/v1/credits/history?limit=${limit}&offset=${offset}`,
      undefined, { noStore: true, retries404: 0 },
    );
    const response = result && typeof result === "object" && !Array.isArray(result)
      ? result as Record<string, unknown> : null;
    const raw: unknown = Array.isArray(result) ? result
      : response?.transactions ?? response?.data ?? response?.history;
    if (!Array.isArray(raw) || raw.length > limit) {
      throw new Error("Conway credit history page unrecognized or incomplete; entries UNKNOWN.");
    }
    const entries = raw.map((item): ConwayCreditHistoryPage["entries"][number] => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw new Error("Conway credit history entry invalid; ledger UNKNOWN.");
      }
      const row = item as Record<string, unknown>;
      const amount = row.amount_cents ?? row.amount;
      const balance = row.balance_after_cents ?? row.balance_after;
      const id = row.id ?? row.transaction_id;
      const type = row.type ?? row.transaction_type;
      const timestamp = row.created_at ?? row.timestamp;
      if ((amount != null && !Number.isSafeInteger(amount)) ||
          (balance != null && !Number.isSafeInteger(balance)) ||
          (id != null && (typeof id !== "string" || !id.trim())) ||
          (type != null && (typeof type !== "string" || !type.trim())) ||
          (timestamp != null && (typeof timestamp !== "string" || !timestamp.trim())) ||
          (amount == null && type == null && timestamp == null)) {
        throw new Error("Conway credit history fields ambiguous; financial entries UNKNOWN.");
      }
      return {
        id: typeof id === "string" ? id : null,
        type: typeof type === "string" ? type : null,
        amountCents: typeof amount === "number" ? amount : null,
        balanceAfterCents: typeof balance === "number" ? balance : null,
        createdAt: typeof timestamp === "string" ? timestamp : null,
      };
    });
    return { entries, limit, offset, completeness: "observed_page" };
  };

  const getCreditsPricing = async (): Promise<PricingTier[]> => {
    const result: unknown = await request("GET", "/v1/credits/pricing");
    const response = result && typeof result === "object" && !Array.isArray(result)
      ? result as Record<string, unknown> : null;
    // Preserve supported provider envelopes; an unknown envelope is not an
    // authoritative empty tier catalog. Pricing is an advertised estimate,
    // never a final same-account supplier contract or an exact charged unit.
    const tiers: unknown = Array.isArray(result) ? result
      : response?.tiers ?? response?.pricing ?? response?.data;
    if (!Array.isArray(tiers)) {
      throw new Error("Conway pricing response shape UNKNOWN; no zero-priced tier inferred.");
    }
    return tiers.map((value: unknown): PricingTier => {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("Conway pricing tier invalid; price and capacity UNKNOWN.");
      }
      const tier = value as Record<string, unknown>;
      if (typeof tier.name !== "string" || !tier.name.trim() ||
          !Number.isSafeInteger(tier.vcpu) || (tier.vcpu as number) <= 0 ||
          !Number.isSafeInteger(tier.memory_mb) || (tier.memory_mb as number) <= 0 ||
          !Number.isSafeInteger(tier.disk_gb) || (tier.disk_gb as number) <= 0 ||
          !Number.isSafeInteger(tier.monthly_cents) || (tier.monthly_cents as number) < 0) {
        throw new Error("Conway pricing tier lacks a precise provider quantity/price; UNKNOWN.");
      }
      return {
        name: tier.name.trim(),
        vcpu: tier.vcpu as number,
        memoryMb: tier.memory_mb as number,
        diskGb: tier.disk_gb as number,
        monthlyCents: tier.monthly_cents as number,
      };
    });
  };

  const transferCredits = async (
    toAddress: string,
    amountCents: number,
    note?: string,
    options?: { idempotencyKey?: string },
  ): Promise<CreditTransferResult> => {
    const payload = {
      to_address: toAddress,
      amount_cents: amountCents,
      note,
    };

    // Reconciled effects supply a stable key across restart; legacy callers
    // still receive an ephemeral key until migrated to the financial adapter.
    if (options?.idempotencyKey !== undefined && !options.idempotencyKey.trim()) {
      throw new Error("Transfer idempotency key cannot be empty");
    }
    const idempotencyKey = options?.idempotencyKey ?? ulid();
    const paths = ["/v1/credits/transfer", "/v1/credits/transfers"];

    let lastError = "Unknown transfer error";

    for (const path of paths) {
      let resp: Response;
      try {
        resp = await httpClient.request(`${apiUrl}${path}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: apiKey,
          },
          body: JSON.stringify(payload),
          idempotencyKey,
          retries: 0, // Mutating: do not auto-retry transfers
        });
      } catch (cause) {
        const uncertain = new Error(
          `Conway credit transfer response was not observed after dispatch: ${cause instanceof Error ? cause.message : String(cause)}`,
        ) as Error & { externalEffectOutcomeUnknown?: boolean };
        uncertain.externalEffectOutcomeUnknown = true;
        throw uncertain;
      }

      if (!resp.ok) {
        const text = await resp.text();
        lastError = `${resp.status}: ${text}`;
        if (resp.status === 404) continue;
        if (resp.status >= 500) {
          const uncertain = new Error(
            `Conway credit transfer returned ambiguous server status ${lastError}`,
          ) as Error & { externalEffectOutcomeUnknown?: boolean };
          uncertain.externalEffectOutcomeUnknown = true;
          throw uncertain;
        }
        throw new Error(`Conway API error: POST ${path} -> ${lastError}`);
      }

      const data = await resp.json().catch(() => ({}) as any);
      return {
        transferId: data.transfer_id || data.id || "",
        status: data.status || "submitted",
        // Never fill missing provider observations from the submitted request.
        // Missing terms may be reconciled later, but cannot prove settlement.
        toAddress: typeof data.to_address === "string" ? data.to_address : undefined,
        amountCents: Number.isSafeInteger(data.amount_cents) ? data.amount_cents : undefined,
        balanceAfterCents:
          data.balance_after_cents ?? data.new_balance_cents ?? undefined,
      };
    }

    throw new Error(
      `Conway API error: POST /v1/credits/transfer -> ${lastError}`,
    );
  };

  const registerAbos = async (params: {
    abosId: string;
    abosAddress: string;
    creatorAddress: string;
    name: string;
    bio?: string;
    genesisPromptHash?: `0x${string}`;
    account: PrivateKeyAccount;
    nonce?: string;
    chainType?: ChainType;
    chainIdentity?: ChainIdentity;
  }): Promise<{ registration: Record<string, unknown> }> => {
    const {
      abosId,
      abosAddress,
      creatorAddress,
      name,
      bio,
      genesisPromptHash,
      account,
      chainIdentity,
    } = params;
    const nonce = params.nonce ?? randomUUID();
    const isSolana = params.chainType === "solana";

    const payload: Record<string, string> = {
      automaton_id: abosId,
      automaton_address: abosAddress,
      creator_address: creatorAddress,
      name,
      bio: bio || "",
    };
    if (genesisPromptHash) {
      payload.genesis_prompt_hash = genesisPromptHash;
    }

    const payloadHash = hashIdentityPayload(payload);
    let signature: string;

    if (isSolana && chainIdentity) {
      // Solana path: Ed25519 sign of canonical JSON
      const sigMessage = JSON.stringify({ automatonId: abosId, nonce, payloadHash });
      signature = await chainIdentity.signMessage(sigMessage);
    } else if (isSolana && !chainIdentity) {
      throw new Error("Solana registration requires chainIdentity. Pass the ChainIdentity from getWallet().");
    } else {
      // EVM path: EIP-712 typed data (unchanged)
      const domain = {
        name: "AIWS Automaton",
        version: "1",
        chainId: 8453,
      };
      const types = {
        Register: [
          { name: "automatonId", type: "string" },
          { name: "nonce", type: "string" },
          { name: "payloadHash", type: "bytes32" },
        ],
      };
      const message = {
        automatonId: abosId,
        nonce,
        payloadHash,
      };
      signature = await account.signTypedData({
        domain,
        types,
        primaryType: "Register",
        message,
      });
    }

    const body: Record<string, unknown> = {
      automaton_id: abosId,
      automaton_address: abosAddress,
      creator_address: creatorAddress,
      name,
      bio: bio || "",
      nonce,
      signature,
      payload_hash: payloadHash,
    };
    if (genesisPromptHash) {
      body.genesis_prompt_hash = genesisPromptHash;
    }
    if (isSolana) {
      body.chain_type = "solana";
    }

    // Conway currently exposes legacy "automaton" wire names. Keep them
    // confined to this adapter; ABOS code never consumes that identity.
    const external = await request("POST", "/v1/automatons/register", body);
    return { registration: external?.automaton ?? external };
  };

  // ─── Domains ──────────────────────────────────────────────────

  const searchDomains = async (
    query: string,
    tlds?: string,
  ): Promise<DomainSearchResult[]> => {
    const params = new URLSearchParams({ query });
    if (tlds) params.set("tlds", tlds);
    const result = await request("GET", `/v1/domains/search?${params}`);
    const results = result.results || result.domains || [];
    return results.map((d: any) => ({
      domain: d.domain,
      available: d.available ?? d.purchasable ?? false,
      registrationPrice: d.registration_price ?? d.purchase_price,
      renewalPrice: d.renewal_price,
      currency: d.currency || "USD",
    }));
  };

  const registerDomain = async (
    domain: string,
    years: number = 1,
  ): Promise<DomainRegistration> => {
    const result = await request("POST", "/v1/domains/register", {
      domain,
      years,
    }, {
      // Domain registrations may bill or create irreversible ownership.
      // Reconciled P-030 operations, not hidden client transport retries,
      // must decide if a second attempt is legitimate.
      retries: 0,
      retries404: 0,
    });
    return {
      domain: result.domain || domain,
      status: result.status || "registered",
      expiresAt: result.expires_at || result.expiry,
      transactionId: result.transaction_id || result.id,
    };
  };

  const listDnsRecords = async (domain: string): Promise<DnsRecord[]> => {
    const result = await request(
      "GET",
      `/v1/domains/${encodeURIComponent(domain)}/dns`,
    );
    const records = result.records || result || [];
    return (Array.isArray(records) ? records : []).map((r: any) => ({
      id: r.id || r.record_id || "",
      type: r.type || "",
      host: r.host || r.name || "",
      value: r.value || r.answer || "",
      ttl: r.ttl,
      distance: r.distance ?? r.priority,
    }));
  };

  const addDnsRecord = async (
    domain: string,
    type: string,
    host: string,
    value: string,
    ttl?: number,
  ): Promise<DnsRecord> => {
    const result = await request(
      "POST",
      `/v1/domains/${encodeURIComponent(domain)}/dns`,
      { type, host, value, ttl: ttl || 3600 },
    );
    return {
      id: result.id || result.record_id || "",
      type: result.type || type,
      host: result.host || host,
      value: result.value || value,
      ttl: result.ttl || ttl || 3600,
    };
  };

  const deleteDnsRecord = async (
    domain: string,
    recordId: string,
  ): Promise<void> => {
    await request(
      "DELETE",
      `/v1/domains/${encodeURIComponent(domain)}/dns/${encodeURIComponent(recordId)}`,
    );
  };

  // ─── Model Discovery ───────────────────────────────────────────

  const listModels = async (): Promise<ModelInfo[]> => {
    // Try inference.conway.tech first (has availability info), fall back to control plane
    const urls = [
      "https://inference.conway.tech/v1/models",
      `${apiUrl}/v1/models`,
    ];
    for (const url of urls) {
      try {
        const resp = await httpClient.request(url, {
          headers: { Authorization: apiKey },
        });
        if (!resp.ok) continue;
        const result = (await resp.json()) as any;
        const raw = result.data || result.models || [];
        return raw
          .filter((m: any) => m.available !== false)
          .map((m: any) => ({
            id: m.id,
            provider: m.provider || m.owned_by || "unknown",
            pricing: {
              inputPerMillion:
                m.pricing?.input_per_million ??
                m.pricing?.input_per_1m_tokens_usd ??
                0,
              outputPerMillion:
                m.pricing?.output_per_million ??
                m.pricing?.output_per_1m_tokens_usd ??
                0,
            },
          }));
      } catch {
        continue;
      }
    }
    return [];
  };

  const createScopedClient = (targetSandboxId: string): ConwayClient => {
    return createConwayClient({ apiUrl, apiKey, sandboxId: targetSandboxId });
  };

  const client: ConwayClient = {
    exec,
    startProcess,
    waitProcess,
    cancelProcess,
    killProcess,
    moveFile,
    writeFile,
    readFile,
    exposePort,
    removePort,
    createSandbox,
    deleteSandbox,
    listSandboxes,
    getCreditsBalance,
    getCreditsPricing,
    getCreditsHistory,
    transferCredits,
    registerAbos,
    searchDomains,
    registerDomain,
    listDnsRecords,
    addDnsRecord,
    deleteDnsRecord,
    listModels,
    createScopedClient,
  };

  // SECURITY: API credentials are NOT exposed on the client object.
  // If child spawning or other modules need API configuration, pass it
  // explicitly through a dedicated typed interface — never via dynamic getters
  // that any code with a client reference could access.

  return client;
}

function normalizeSandboxId(value: string | null | undefined): string {
  const trimmed = (value || "").trim();
  if (!trimmed) return "";
  if (trimmed === "undefined" || trimmed === "null") return "";
  return trimmed;
}
