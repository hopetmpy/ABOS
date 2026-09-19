import { createHash } from "node:crypto";
import { Client } from "@modelcontextprotocol/client";
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

interface ParsedMcpConfig {
  kind: "stdio";
  value: StdioMcpConfig;
}

export interface DiscoverConfiguredMcpToolsOptions {
  db: AbosDatabase;
  capabilityRegistry: CapabilityRegistry;
  reservedToolNames?: Iterable<string>;
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

function parseStdioConfig(entry: InstalledTool): ParsedMcpConfig | { error: string } {
  const config = entry.config ?? {};
  const transport = typeof config.transport === "string" ? config.transport.trim().toLowerCase() : "stdio";
  if (transport !== "stdio") {
    return { error: `transport ${transport || "<empty>"} is outside MCP_CORE_STDIO` };
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

function sanitizedSchema(value: unknown, key = ""): unknown {
  if (Array.isArray(value)) return value.map((entry) => sanitizedSchema(entry));
  if (!isRecord(value)) {
    if (typeof value === "string" && ["description", "title", "$comment"].includes(key)) {
      return sanitizeToolResult(value, 2_000);
    }
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([childKey, childValue]) => [
      childKey,
      sanitizedSchema(childValue, childKey),
    ]),
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
      transport: "stdio",
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
      transport: "stdio",
    },
  };
}

function toolRisk(tool: ListedMcpTool): RiskLevel {
  // Server annotations are self-reported hints. They may only make ABOS more
  // conservative here; they never downgrade the default caution boundary.
  return tool.annotations?.destructiveHint === true ? "dangerous" : "caution";
}

async function connect(entry: InstalledTool, config: StdioMcpConfig): Promise<Client> {
  const client = new Client(CLIENT_INFO, {
    versionNegotiation: { mode: "auto" },
  });
  try {
    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      ...(config.env ? { env: config.env } : {}),
      ...(config.cwd ? { cwd: config.cwd } : {}),
    });
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
  config: StdioMcpConfig,
  remoteToolName: string,
  capabilityId: string,
  expectedContractFingerprint: string,
  args: Record<string, unknown>,
): Promise<string> {
  let client: Client | undefined;
  try {
    client = await connect(entry, config);
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
      result = await client.callTool({ name: remoteToolName, arguments: args });
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
  const { db, capabilityRegistry } = options;
  const reserved = new Set(options.reservedToolNames ?? []);
  const inventory = db.getToolInventory().filter((entry) => entry.type === "mcp");
  const projected: AbosTool[] = [];

  for (const entry of inventory) {
    const parsed = parseStdioConfig(entry);
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
      client = await connect(entry, parsed.value);
      const tools = await listAllTools(client);
      const observedAt = new Date().toISOString();
      const era = client.getProtocolEra();

      registerCapability(
        db,
        capabilityRegistry,
        entry,
        serverDescriptor(
          entry,
          "verified_available",
          ["Official MCP SDK connected over stdio and completed tools/list."],
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
            transport: "stdio",
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
          parameters: sanitizedSchema(remoteTool.inputSchema) as Record<string, unknown>,
          category: "capability",
          riskLevel: toolRisk(remoteTool),
          externalOutput: true,
          execute: async (args) =>
            invokeTool(
              db,
              capabilityRegistry,
              entry,
              parsed.value,
              remoteTool.name,
              capabilityId,
              fingerprint,
              args,
            ),
        });
      }
    } catch (error) {
      try {
        registerCapability(
          db,
          capabilityRegistry,
          entry,
          serverDescriptor(entry, "unavailable", [
            "The configured MCP server could not complete stdio connection and tools/list.",
          ]),
          "mcp.server_unavailable",
          { error: error instanceof Error ? error.message : String(error) },
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
