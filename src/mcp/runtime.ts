import { createHash } from "node:crypto";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import type {
  AbosDatabase,
  AbosTool,
  InstalledTool,
  RiskLevel,
} from "../types.js";
import type { CapabilityDescriptor } from "../capabilities/model.js";
import type { CapabilityRegistry } from "../capabilities/registry.js";
import { sanitizeToolResult } from "../agent/injection-defense.js";
import {
  appendEvidenceEvent,
  correlationIdFor,
  currentEvidenceContext,
} from "../observability/evidence.js";
import { createLogger } from "../observability/logger.js";
import { trustedHttpUrl } from "../network/url-trust.js";

const logger = createLogger("mcp-runtime");
const CLIENT_INFO = { name: "abos-mcp-client", version: "0.3.0" } as const;

type ListedMcpTool = {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
};

interface StdioMcpConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
  cwd?: string;
}

interface HttpMcpConfig {
  url: string;
  tokenEnv?: string;
  callTimeoutMs?: number;
}

type ParsedMcpConfig =
  | { kind: "stdio"; value: StdioMcpConfig }
  | { kind: "streamable-http"; value: HttpMcpConfig };

export interface DiscoverConfiguredMcpToolsOptions {
  db: AbosDatabase;
  capabilityRegistry: CapabilityRegistry;
  reservedToolNames?: Iterable<string>;
  /** Deterministic test seam. Production leaves this undefined and uses global fetch. */
  httpFetch?: typeof fetch;
}

class McpExternalOutcomeUnknownError extends Error {
  readonly externalEffectOutcomeUnknown = true;

  constructor(message: string) {
    super(message);
    this.name = "McpExternalOutcomeUnknownError";
  }
}

function hash(value: string, length = 12): string {
  return createHash("sha256").update(value).digest("hex").slice(0, length);
}

function slug(value: string, maxLength: number): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  return (normalized || "unnamed").slice(0, maxLength);
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => [key, canonicalize(record[key])]),
  );
}

function contractFingerprint(tool: ListedMcpTool): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize({ name: tool.name, inputSchema: tool.inputSchema })))
    .digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const MCP_TOKEN_ENV_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MCP_HTTP_SECRET_KEYS = new Set([
  "token",
  "bearerToken",
  "authorization",
  "apiKey",
  "clientSecret",
]);

function mcpTransport(entry: InstalledTool): string {
  const value = entry.config?.transport;
  return typeof value === "string" && value.trim()
    ? value.trim().toLowerCase()
    : "stdio";
}


function trustedMcpHttpUrl(rawUrl: unknown): string | { error: string } {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) {
    return { error: "streamable-http url is not configured" };
  }

  try {
    return trustedHttpUrl(rawUrl.trim(), {
      allowHttpOnLoopback: true,
      rejectEmbeddedCredentials: true,
      stripHash: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("must not embed credentials")) {
      return { error: "streamable-http url must not embed credentials" };
    }
    if (message.includes("HTTPS required")) {
      return {
        error: "HTTPS is required for remote MCP endpoints; HTTP is allowed only on loopback",
      };
    }
    return { error: "streamable-http url is invalid" };
  }
}

export function validateMcpHttpConfig(
  config: Record<string, unknown>,
): { value: HttpMcpConfig } | { error: string } {
  for (const key of MCP_HTTP_SECRET_KEYS) {
    if (Object.prototype.hasOwnProperty.call(config, key)) {
      return {
        error: `raw MCP credential field ${key} must not be persisted; use tokenEnv`,
      };
    }
  }

  const trustedUrl = trustedMcpHttpUrl(config.url);
  if (typeof trustedUrl !== "string") return trustedUrl;

  const rawTokenEnv = config.tokenEnv;
  if (rawTokenEnv !== undefined) {
    if (typeof rawTokenEnv !== "string" || !MCP_TOKEN_ENV_RE.test(rawTokenEnv)) {
      return { error: "tokenEnv must be a valid environment variable name" };
    }
  }

  const rawTimeout = config.callTimeoutMs;
  if (
    rawTimeout !== undefined &&
    (typeof rawTimeout !== "number" || !Number.isSafeInteger(rawTimeout) || rawTimeout <= 0)
  ) {
    return { error: "callTimeoutMs must be a positive integer number of milliseconds" };
  }

  return {
    value: {
      url: trustedUrl,
      ...(rawTokenEnv !== undefined ? { tokenEnv: rawTokenEnv as string } : {}),
      ...(rawTimeout !== undefined ? { callTimeoutMs: rawTimeout as number } : {}),
    },
  };
}

function parseMcpConfig(entry: InstalledTool): ParsedMcpConfig | { error: string } {
  const config = entry.config ?? {};
  const transport = mcpTransport(entry);

  if (transport === "streamable-http") {
    const parsed = validateMcpHttpConfig(config);
    return "error" in parsed
      ? parsed
      : { kind: "streamable-http", value: parsed.value };
  }

  if (transport !== "stdio") {
    return { error: `unsupported MCP transport: ${transport || "<empty>"}` };
  }

  const command = typeof config.command === "string" ? config.command.trim() : "";
  if (!command) {
    return { error: "stdio command is not configured" };
  }

  const rawArgs = config.args;
  if (rawArgs !== undefined && (!Array.isArray(rawArgs) || rawArgs.some((arg) => typeof arg !== "string"))) {
    return { error: "stdio args must be an array of strings" };
  }

  const rawEnv = config.env;
  if (
    rawEnv !== undefined &&
    (!isRecord(rawEnv) || Object.values(rawEnv).some((value) => typeof value !== "string"))
  ) {
    return { error: "stdio env must be a string-to-string object" };
  }

  const rawCwd = config.cwd;
  if (rawCwd !== undefined && typeof rawCwd !== "string") {
    return { error: "stdio cwd must be a string" };
  }

  return {
    kind: "stdio",
    value: {
      command,
      args: (rawArgs as string[] | undefined) ?? [],
      env: rawEnv as Record<string, string> | undefined,
      cwd: rawCwd as string | undefined,
    },
  };
}

function safeErrorText(error: unknown): string {
  return sanitizeToolResult(error instanceof Error ? error.message : String(error), 2_000);
}

function httpStatusFromError(error: unknown): number | undefined {
  if (!isRecord(error)) return undefined;
  return typeof error.status === "number" ? error.status : undefined;
}

function discoveryFailure(
  error: unknown,
  transport: ParsedMcpConfig["kind"],
): { reason: string; evidence: string; safeError: string } {
  const safeError = safeErrorText(error);
  const status = httpStatusFromError(error);
  const name = isRecord(error) && typeof error.name === "string" ? error.name : "";

  if (transport === "streamable-http" && (status === 401 || name === "UnauthorizedError")) {
    return {
      reason: "auth_unauthorized",
      evidence: "The Streamable HTTP MCP endpoint rejected authentication (HTTP 401/unauthorized).",
      safeError,
    };
  }
  if (transport === "streamable-http" && status === 403) {
    return {
      reason: "auth_forbidden",
      evidence: "The Streamable HTTP MCP endpoint denied access (HTTP 403/forbidden).",
      safeError,
    };
  }

  return {
    reason: "connect_or_list_failed",
    evidence: `The configured MCP server could not complete ${transport} connection and tools/list.`,
    safeError,
  };
}

const UNSAFE_SCHEMA_IDENTIFIER = /[\u0000-\u001f\u007f\u200b-\u200d\ufeff]|<\|(?:im_start|im_end|endoftext)\|>|<\/?(?:system|prompt)>|\[\/?INST\]|<<\/?SYS>>/i;
const SCHEMA_IDENTIFIER_VALUE_KEYS = new Set([
  "$id",
  "$anchor",
  "$dynamicAnchor",
  "$ref",
  "$dynamicRef",
]);

function assertSafeSchemaIdentifier(value: string): void {
  if (UNSAFE_SCHEMA_IDENTIFIER.test(value)) {
    throw new Error("Unsafe MCP input schema identifier was rejected before projection.");
  }
}

function sanitizedSchema(value: unknown, key = ""): unknown {
  if (Array.isArray(value)) return value.map((entry) => sanitizedSchema(entry, key));
  if (!isRecord(value)) {
    if (typeof value === "string") {
      if (SCHEMA_IDENTIFIER_VALUE_KEYS.has(key)) assertSafeSchemaIdentifier(value);
      if (["description", "title", "$comment"].includes(key)) {
        return sanitizeToolResult(value, 2_000);
      }
    }
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([childKey, childValue]) => {
      assertSafeSchemaIdentifier(childKey);
      return [childKey, sanitizedSchema(childValue, childKey)];
    }),
  );
}

function safeDescription(entry: InstalledTool, tool: ListedMcpTool): string {
  const localServer = slug(entry.name, 32);
  const remoteDescription = tool.description
    ? sanitizeToolResult(tool.description, 2_000)
    : "No remote description supplied.";
  return `MCP tool from configured server ${localServer}. Remote description is untrusted metadata: ${remoteDescription}`;
}

function exposedToolName(
  entry: InstalledTool,
  remoteName: string,
  reserved: Set<string>,
): string {
  const server = slug(entry.name, 12);
  const tool = slug(remoteName, 24);
  const digest = createHash("sha256")
    .update(`${entry.id}\0${remoteName}`)
    .digest("hex");

  for (const suffixLength of [8, 12, 16, 20]) {
    const candidate = `mcp_${server}_${tool}_${digest.slice(0, suffixLength)}`.slice(0, 64);
    if (!reserved.has(candidate)) {
      reserved.add(candidate);
      return candidate;
    }
  }
  throw new Error(`Unable to allocate collision-safe MCP tool name for inventory ${entry.id}`);
}

function serverCapabilityId(entry: InstalledTool): string {
  return `mcp-server:${entry.id}`;
}

function toolCapabilityId(entry: InstalledTool, remoteName: string): string {
  return `mcp-tool:${entry.id}:${hash(remoteName, 16)}`;
}

function isRetiredMcpInventory(entry: InstalledTool): boolean {
  return entry.config?.runtimeTruth === "retired";
}

function correlationFields(serverId: string) {
  const context = currentEvidenceContext();
  return {
    correlationId: context?.correlationId ?? correlationIdFor("mcp_server", serverId),
    causationId: context?.causationId ?? null,
    goalId: context?.goalId ?? null,
    taskId: context?.taskId ?? null,
    turnId: context?.turnId ?? null,
    toolCallId: context?.toolCallId ?? null,
  };
}

function appendMcpEvidence(
  db: AbosDatabase,
  entry: InstalledTool,
  authorityId: string,
  eventType: string,
  payload: Record<string, unknown>,
): void {
  const correlation = correlationFields(entry.id);
  appendEvidenceEvent(db.raw, {
    ...correlation,
    eventType,
    domain: "mcp",
    authorityType: "capability_record",
    authorityId,
    epistemicStatus: "observation",
    payload,
    provenance: {
      source: "mcp-runtime",
      transport: mcpTransport(entry),
      inventoryId: entry.id,
    },
  });
}

function registerCapability(
  db: AbosDatabase,
  registry: CapabilityRegistry,
  entry: InstalledTool,
  descriptor: CapabilityDescriptor,
  eventType: string,
  payload: Record<string, unknown>,
): void {
  registry.register(descriptor);
  try {
    appendMcpEvidence(db, entry, descriptor.id, eventType, payload);
  } catch (error) {
    try {
      registry.recordProbe(descriptor.id, {
        state: "unknown",
        authority: "mcp-runtime:evidence-persistence-failed",
        evidence: ["Cross-domain evidence persistence failed; runtime readiness was invalidated."],
      });
    } catch {
      // Preserve the first persistence failure.
    }
    throw error;
  }
}

function recordCapabilityProbe(
  db: AbosDatabase,
  registry: CapabilityRegistry,
  entry: InstalledTool,
  capabilityId: string,
  state: string,
  evidence: string[],
  eventType: string,
  payload: Record<string, unknown>,
): void {
  registry.recordProbe(capabilityId, {
    state,
    authority: `mcp-runtime:${entry.id}`,
    evidence,
  });
  try {
    appendMcpEvidence(db, entry, capabilityId, eventType, payload);
  } catch (error) {
    try {
      registry.recordProbe(capabilityId, {
        state: "unknown",
        authority: "mcp-runtime:evidence-persistence-failed",
        evidence: ["Cross-domain evidence persistence failed; runtime readiness was invalidated."],
      });
    } catch {
      // Preserve the first persistence failure.
    }
    throw error;
  }
}

function retireInventoryCapabilities(
  db: AbosDatabase,
  registry: CapabilityRegistry,
  entry: InstalledTool,
): void {
  const serverId = serverCapabilityId(entry);
  const evidence = ["The local MCP inventory was explicitly retired; it must not be connected or projected."];
  if (registry.get(serverId)) {
    recordCapabilityProbe(
      db,
      registry,
      entry,
      serverId,
      "retired",
      evidence,
      "mcp.server_retired",
      { reason: "inventory_retired" },
    );
  } else {
    registerCapability(
      db,
      registry,
      entry,
      serverDescriptor(entry, "retired", evidence),
      "mcp.server_retired",
      { reason: "inventory_retired" },
    );
  }

  for (const capability of registry.list()) {
    if (capability.provider !== "mcp" || capability.type !== "tool") continue;
    if (capability.metadata?.inventoryId !== entry.id) continue;
    recordCapabilityProbe(
      db,
      registry,
      entry,
      capability.id,
      "retired",
      ["The owning MCP inventory was explicitly retired locally."],
      "mcp.tool_retired",
      { reason: "inventory_retired" },
    );
  }
}

function serverDescriptor(
  entry: InstalledTool,
  state: string,
  evidence: string[],
  observedAt = new Date().toISOString(),
): CapabilityDescriptor {
  return {
    id: serverCapabilityId(entry),
    type: "service",
    provider: "mcp",
    description: `Configured MCP server ${slug(entry.name, 32)}`,
    requirements: [],
    provides: [`mcp_server_${hash(entry.id, 12)}`],
    permissions: [],
    available: state === "verified_available",
    state,
    observedAt,
    authority: `mcp-runtime:${entry.id}`,
    evidence,
    metadata: {
      inventoryId: entry.id,
      transport: mcpTransport(entry),
    },
  };
}

function toolRisk(tool: ListedMcpTool): RiskLevel {
  // Server annotations are self-reported hints. They may only make ABOS more
  // conservative here; they never downgrade the default caution boundary.
  return tool.annotations?.destructiveHint === true ? "dangerous" : "caution";
}

async function connect(
  entry: InstalledTool,
  config: ParsedMcpConfig,
  httpFetch?: typeof fetch,
): Promise<Client> {
  const client = new Client(CLIENT_INFO, {
    versionNegotiation: { mode: "auto" },
  });
  try {
    if (config.kind === "stdio") {
      const transport = new StdioClientTransport({
        command: config.value.command,
        args: config.value.args,
        ...(config.value.env ? { env: config.value.env } : {}),
        ...(config.value.cwd ? { cwd: config.value.cwd } : {}),
      });
      await client.connect(transport);
      return client;
    }

    const tokenEnv = config.value.tokenEnv;
    const authProvider = tokenEnv
      ? {
          token: async (): Promise<string> => {
            const token = process.env[tokenEnv];
            if (!token?.trim()) {
              throw new Error(`MCP bearer environment variable ${tokenEnv} is not set`);
            }
            return token.trim();
          },
        }
      : undefined;

    const transport = new StreamableHTTPClientTransport(
      new URL(config.value.url),
      {
        ...(authProvider ? { authProvider } : {}),
        ...(httpFetch ? { fetch: httpFetch } : {}),
      },
    );
    await client.connect(transport);
    return client;
  } catch (error) {
    try {
      await client.close();
    } catch {
      // Connection error remains primary.
    }
    throw error;
  }
}

async function closeQuietly(client: Client): Promise<void> {
  try {
    await client.close();
  } catch (error) {
    logger.warn("MCP client close failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function listAllTools(client: Client): Promise<ListedMcpTool[]> {
  const tools: ListedMcpTool[] = [];
  let cursor: string | undefined;
  do {
    const page = cursor
      ? await client.listTools({ cursor })
      : await client.listTools();
    tools.push(...(page.tools as ListedMcpTool[]));
    cursor = page.nextCursor;
  } while (cursor);
  return tools;
}

function serializeResult(result: unknown): string {
  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}

async function invokeTool(
  db: AbosDatabase,
  registry: CapabilityRegistry,
  entry: InstalledTool,
  config: ParsedMcpConfig,
  httpFetch: typeof fetch | undefined,
  remoteToolName: string,
  capabilityId: string,
  expectedContractFingerprint: string,
  args: Record<string, unknown>,
): Promise<string> {
  let client: Client | undefined;
  try {
    client = await connect(entry, config, httpFetch);
    const currentTools = await listAllTools(client);
    const current = currentTools.find((tool) => tool.name === remoteToolName);
    if (!current) {
      recordCapabilityProbe(
        db,
        registry,
        entry,
        capabilityId,
        "degraded",
        ["The MCP server connected but the previously discovered tool is no longer listed."],
        "mcp.tool_definition_changed",
        { reason: "tool_missing_before_call" },
      );
      throw new Error("MCP tool definition changed before call; rediscovery is required.");
    }
    if (contractFingerprint(current) !== expectedContractFingerprint) {
      recordCapabilityProbe(
        db,
        registry,
        entry,
        capabilityId,
        "degraded",
        ["The MCP tool input contract changed after discovery; the call was refused before side effects."],
        "mcp.tool_definition_changed",
        { reason: "input_contract_changed_before_call" },
      );
      throw new Error("MCP tool contract changed before call; rediscovery is required.");
    }

    let result: Awaited<ReturnType<Client["callTool"]>>;
    try {
const requestOptions = config.kind === "streamable-http" && config.value.callTimeoutMs
  ? { timeout: config.value.callTimeoutMs }
  : undefined;
result = await client.callTool(
  { name: remoteToolName, arguments: args },
  requestOptions,
);
    } catch (error) {
      try {
        recordCapabilityProbe(
          db,
          registry,
          entry,
          capabilityId,
          "degraded",
          ["The MCP tools/call request did not produce a trusted terminal result."],
          "mcp.tool_call_outcome_unknown",
          { error: error instanceof Error ? error.message : String(error) },
        );
      } catch {
        // Preserve call uncertainty even if local evidence persistence fails.
      }
      throw new McpExternalOutcomeUnknownError(
        `MCP call outcome is unknown: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (result.isError === true) {
      const safeError = sanitizeToolResult(serializeResult(result), 4_000);
      try {
        recordCapabilityProbe(
          db,
          registry,
          entry,
          capabilityId,
          "degraded",
          ["The MCP protocol call completed, but the remote tool reported a domain-level error."],
          "mcp.tool_call_reported_error",
          { reportedError: true },
        );
      } catch {
        // The returned remote error already makes the effect non-repeatable without review.
      }
      throw new McpExternalOutcomeUnknownError(
        `MCP tool reported an error; remote side effects cannot be assumed absent: ${safeError}`,
      );
    }

    try {
      recordCapabilityProbe(
        db,
        registry,
        entry,
        capabilityId,
        "verified_available",
        ["A real MCP tools/call completed with a non-error result against the current discovered input contract."],
        "mcp.tool_call_verified",
        { verified: true },
      );
    } catch (error) {
      throw new McpExternalOutcomeUnknownError(
        `MCP call returned successfully but local verification persistence failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return serializeResult(result);
  } finally {
    if (client) await closeQuietly(client);
  }
}

export async function discoverConfiguredMcpTools(
  options: DiscoverConfiguredMcpToolsOptions,
): Promise<AbosTool[]> {
  const { db, capabilityRegistry, httpFetch } = options;
  const reserved = new Set(options.reservedToolNames ?? []);
  const inventory = db.getToolInventory().filter((entry) => entry.type === "mcp");
  const projected: AbosTool[] = [];

  for (const entry of inventory) {
    if (isRetiredMcpInventory(entry)) {
      try {
        retireInventoryCapabilities(db, capabilityRegistry, entry);
      } catch (error) {
        logger.warn("Failed to persist MCP retirement evidence", {
          inventoryId: entry.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      continue;
    }

    const parsed = parseMcpConfig(entry);
    if ("error" in parsed) {
      try {
        registerCapability(
          db,
          capabilityRegistry,
          entry,
          serverDescriptor(entry, "unavailable", [parsed.error]),
          "mcp.server_unavailable",
          { reason: parsed.error },
        );
      } catch (error) {
        logger.warn("Failed to persist MCP configuration-unavailable evidence", {
          inventoryId: entry.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      continue;
    }

    let client: Client | undefined;
    try {
      client = await connect(entry, parsed, httpFetch);
      const tools = await listAllTools(client);
      const observedAt = new Date().toISOString();
      const era = client.getProtocolEra();
      const listedCapabilityIds = new Set(
        tools
          .filter((tool) => typeof tool.name === "string" && tool.name.length > 0)
          .map((tool) => toolCapabilityId(entry, tool.name)),
      );

      registerCapability(
        db,
        capabilityRegistry,
        entry,
        serverDescriptor(
          entry,
          "verified_available",
          [`Official MCP SDK connected over ${parsed.kind} and completed tools/list.`],
          observedAt,
        ),
        "mcp.server_verified",
        { toolCount: tools.length, protocolEra: era ?? "unknown" },
      );

      const seenRemoteNames = new Set<string>();
      for (const remoteTool of tools) {
        if (!remoteTool.name || seenRemoteNames.has(remoteTool.name)) {
          logger.warn("Skipping duplicate or empty MCP tool name", {
            inventoryId: entry.id,
          });
          continue;
        }
        seenRemoteNames.add(remoteTool.name);
        if (!isRecord(remoteTool.inputSchema)) {
          logger.warn("Skipping MCP tool with malformed input schema", {
            inventoryId: entry.id,
          });
          continue;
        }

        const exposedName = exposedToolName(entry, remoteTool.name, reserved);
        const capabilityId = toolCapabilityId(entry, remoteTool.name);
        const fingerprint = contractFingerprint(remoteTool);
        let parameters: Record<string, unknown>;
        try {
          assertSafeSchemaIdentifier(remoteTool.name);
          parameters = sanitizedSchema(remoteTool.inputSchema) as Record<string, unknown>;
        } catch (error) {
          registerCapability(
            db,
            capabilityRegistry,
            entry,
            {
              id: capabilityId,
              type: "tool",
              provider: "mcp",
              description: safeDescription(entry, remoteTool),
              requirements: [],
              provides: [exposedName],
              permissions: [],
              dependencies: [serverCapabilityId(entry)],
              compatibility: era ? [`mcp-era:${era}`] : [],
              available: false,
              state: "unavailable",
              observedAt,
              authority: `mcp-runtime:${entry.id}`,
              evidence: ["The remote MCP tool schema contained an unsafe identifier and was refused before projection."],
              metadata: {
                inventoryId: entry.id,
                transport: mcpTransport(entry),
                remoteToolName: remoteTool.name,
                remoteToolContractHash: fingerprint,
              },
            },
            "mcp.tool_schema_rejected",
            { reason: "unsafe_schema_identifier" },
          );
          logger.warn("Rejected unsafe MCP tool schema", {
            inventoryId: entry.id,
            error: error instanceof Error ? error.message : String(error),
          });
          continue;
        }

        const descriptor: CapabilityDescriptor = {
          id: capabilityId,
          type: "tool",
          provider: "mcp",
          description: safeDescription(entry, remoteTool),
          requirements: [],
          provides: [exposedName],
          permissions: [],
          dependencies: [serverCapabilityId(entry)],
          compatibility: era ? [`mcp-era:${era}`] : [],
          available: false,
          state: "probed",
          observedAt,
          authority: `mcp-runtime:${entry.id}`,
          evidence: [
            "The tool was discovered through a real MCP tools/list response; it is not verified_available until a tools/call succeeds.",
          ],
          metadata: {
            inventoryId: entry.id,
            transport: mcpTransport(entry),
            remoteToolName: remoteTool.name,
            remoteToolContractHash: fingerprint,
          },
        };

        registerCapability(
          db,
          capabilityRegistry,
          entry,
          descriptor,
          "mcp.tool_discovered",
          { exposedName, remoteToolContractHash: fingerprint },
        );

        projected.push({
          name: exposedName,
          description: safeDescription(entry, remoteTool),
          parameters,
          category: "capability",
          riskLevel: toolRisk(remoteTool),
          externalOutput: true,
          execute: async (args) =>
            invokeTool(
              db,
              capabilityRegistry,
              entry,
              parsed,
              httpFetch,
              remoteTool.name,
              capabilityId,
              fingerprint,
              args,
            ),
        });
      }

      for (const capability of capabilityRegistry.list()) {
        if (capability.provider !== "mcp" || capability.type !== "tool") continue;
        if (capability.metadata?.inventoryId !== entry.id) continue;
        if (listedCapabilityIds.has(capability.id)) continue;
        recordCapabilityProbe(
          db,
          capabilityRegistry,
          entry,
          capability.id,
          "retired",
          ["A successful current MCP tools/list no longer contained this previously discovered tool."],
          "mcp.tool_retired",
          { reason: "absent_from_successful_tools_list" },
        );
      }
    } catch (error) {
      const failure = discoveryFailure(error, parsed.kind);
      try {
        registerCapability(
          db,
          capabilityRegistry,
          entry,
          serverDescriptor(entry, "unavailable", [failure.evidence]),
          "mcp.server_unavailable",
          { reason: failure.reason, error: failure.safeError },
        );
      } catch {
        // Keep this server unavailable for this discovery pass; do not block others.
      }
      logger.warn("MCP server discovery failed", {
        inventoryId: entry.id,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (client) await closeQuietly(client);
    }
  }

  return projected;
}
