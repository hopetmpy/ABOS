from pathlib import Path
import textwrap


def read(path: str) -> str:
    return Path(path).read_text()


def write(path: str, text: str) -> None:
    Path(path).write_text(text)


def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"expected one occurrence in {path}, found {count}: {old[:160]!r}")
    write(path, text.replace(old, new, 1))


def replace_between(path: str, start: str, end: str, replacement: str) -> None:
    text = read(path)
    start_idx = text.find(start)
    if start_idx < 0:
        raise SystemExit(f"start marker not found in {path}: {start!r}")
    end_idx = text.find(end, start_idx)
    if end_idx < 0:
        raise SystemExit(f"end marker not found in {path}: {end!r}")
    write(path, text[:start_idx] + replacement + text[end_idx:])


def replace_count(path: str, old: str, new: str, expected: int) -> None:
    text = read(path)
    count = text.count(old)
    if count != expected:
        raise SystemExit(f"expected {expected} occurrences in {path}, found {count}: {old!r}")
    write(path, text.replace(old, new))


runtime = "src/mcp/runtime.ts"
replace_once(
    runtime,
    'import { Client } from "@modelcontextprotocol/client";\n',
    'import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";\n',
)

replace_between(
    runtime,
    "interface StdioMcpConfig {",
    "class McpExternalOutcomeUnknownError",
    textwrap.dedent('''\
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

'''),
)

replace_between(
    runtime,
    "function parseStdioConfig(entry: InstalledTool)",
    "const UNSAFE_SCHEMA_IDENTIFIER",
    textwrap.dedent('''\
const MCP_LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
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

  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return { error: "streamable-http url is invalid" };
  }

  if (parsed.username || parsed.password) {
    return { error: "streamable-http url must not embed credentials" };
  }

  const protocol = parsed.protocol.toLowerCase();
  const host = parsed.hostname.toLowerCase();
  if (protocol !== "https:" && !(protocol === "http:" && MCP_LOOPBACK_HOSTS.has(host))) {
    return {
      error: "HTTPS is required for remote MCP endpoints; HTTP is allowed only on loopback",
    };
  }

  parsed.hash = "";
  return parsed.toString();
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

'''),
)

replace_count(runtime, 'transport: "stdio"', 'transport: mcpTransport(entry)', 4)

replace_between(
    runtime,
    "async function connect(entry: InstalledTool, config: StdioMcpConfig)",
    "async function closeQuietly",
    textwrap.dedent('''\
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

'''),
)

replace_once(
    runtime,
    "  config: StdioMcpConfig,\n  remoteToolName: string,",
    "  config: ParsedMcpConfig,\n  httpFetch: typeof fetch | undefined,\n  remoteToolName: string,",
)
replace_once(
    runtime,
    "    client = await connect(entry, config);",
    "    client = await connect(entry, config, httpFetch);",
)
replace_once(
    runtime,
    '      result = await client.callTool({ name: remoteToolName, arguments: args });',
    textwrap.dedent('''\
      const requestOptions = config.kind === "streamable-http" && config.value.callTimeoutMs
        ? { timeout: config.value.callTimeoutMs }
        : undefined;
      result = await client.callTool(
        { name: remoteToolName, arguments: args },
        requestOptions,
      );''').rstrip(),
)
replace_once(
    runtime,
    "  const { db, capabilityRegistry } = options;",
    "  const { db, capabilityRegistry, httpFetch } = options;",
)
replace_once(runtime, "    const parsed = parseStdioConfig(entry);", "    const parsed = parseMcpConfig(entry);")
replace_once(
    runtime,
    "      client = await connect(entry, parsed.value);",
    "      client = await connect(entry, parsed, httpFetch);",
)
replace_once(
    runtime,
    '["Official MCP SDK connected over stdio and completed tools/list."],',
    '[`Official MCP SDK connected over ${parsed.kind} and completed tools/list.`],',
)
replace_once(
    runtime,
    "              parsed.value,\n              remoteTool.name,",
    "              parsed,\n              httpFetch,\n              remoteTool.name,",
)
replace_once(
    runtime,
    textwrap.dedent('''\
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
'''),
    textwrap.dedent('''\
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
'''),
)

# Extend the existing configurator instead of creating a parallel HTTP tool.
tools = "src/agent/tools-core.ts"
replace_between(
    tools,
    "    // ── Self-Mod: Install MCP Server ──",
    "    // ── Financial: Transfer Credits ──",
    textwrap.dedent('''\
    // ── Self-Mod: Install MCP Server ──
    {
      name: "install_mcp_server",
      description:
        "Configure an MCP server. stdio servers may install an npm package; Streamable HTTP servers persist only endpoint metadata and optional tokenEnv, never the bearer token itself.",
      category: "self_mod",
      riskLevel: "dangerous",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "MCP server name" },
          package: {
            type: "string",
            description: "npm package name for stdio MCP servers (not used for Streamable HTTP)",
          },
          config: {
            type: "string",
            description:
              "JSON MCP config. Use transport=streamable-http, url, optional tokenEnv/callTimeoutMs for remote HTTP; never include raw credentials.",
          },
        },
        required: ["name"],
      },
      execute: async (args, ctx) => {
        let parsedConfig: Record<string, unknown> = {};
        if (args.config !== undefined) {
          try {
            const parsed = JSON.parse(args.config as string) as unknown;
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
              return "Blocked: MCP config must be a JSON object.";
            }
            parsedConfig = parsed as Record<string, unknown>;
          } catch (error) {
            return `Blocked: invalid MCP config JSON: ${error instanceof Error ? error.message : String(error)}`;
          }
        }

        const pkg = typeof args.package === "string" ? args.package.trim() : "";
        const explicitTransport = typeof parsedConfig.transport === "string"
          ? parsedConfig.transport.trim().toLowerCase()
          : "";
        const transport = explicitTransport || (pkg ? "stdio" : "");

        if (transport === "streamable-http") {
          if (pkg) {
            return "Blocked: Streamable HTTP MCP configuration must not install an npm package.";
          }
          const { validateMcpHttpConfig } = await import("../mcp/runtime.js");
          const validation = validateMcpHttpConfig(parsedConfig);
          if ("error" in validation) {
            return `Blocked: ${validation.error}`;
          }

          const { ulid } = await import("ulid");
          const toolEntry = {
            id: ulid(),
            name: args.name as string,
            type: "mcp" as const,
            config: {
              transport: "streamable-http",
              url: validation.value.url,
              ...(validation.value.tokenEnv ? { tokenEnv: validation.value.tokenEnv } : {}),
              ...(validation.value.callTimeoutMs
                ? { callTimeoutMs: validation.value.callTimeoutMs }
                : {}),
              runtimeTruth: "configured_unverified",
            },
            installedAt: new Date().toISOString(),
            enabled: false,
          };
          ctx.db.installTool(toolEntry);
          ctx.db.insertModification({
            id: ulid(),
            timestamp: new Date().toISOString(),
            type: "mcp_install",
            description: `Configured Streamable HTTP MCP inventory (runtime unverified): ${args.name}`,
            reversible: true,
          });
          return `Streamable HTTP MCP configuration saved: ${args.name}. Runtime execution is UNVERIFIED; bearer credentials, when configured, are resolved only from tokenEnv at runtime.`;
        }

        if (transport !== "stdio") {
          return "Blocked: specify an npm package for stdio or config.transport=streamable-http for a remote MCP endpoint.";
        }
        if (!pkg) {
          return "Blocked: stdio MCP configuration requires an npm package.";
        }
        // Defense-in-depth: validate package name inline in case the
        // policy engine's validate.package_name rule is bypassed.
        if (!/^[@a-zA-Z0-9._\\/-]+$/.test(pkg)) {
          return `Blocked: invalid package name "${pkg}"`;
        }
        const result = await ctx.conway.exec(`npm install -g ${pkg}`, 60000);
        if (result.exitCode !== 0) {
          return `Failed to install MCP server: ${result.stderr}`;
        }

        const { ulid } = await import("ulid");
        const toolEntry = {
          id: ulid(),
          name: args.name as string,
          type: "mcp" as const,
          config: {
            ...parsedConfig,
            transport: "stdio",
            package: pkg,
            runtimeTruth: "configured_unverified",
          },
          installedAt: new Date().toISOString(),
          enabled: false,
        };
        ctx.db.installTool(toolEntry);
        ctx.db.insertModification({
          id: ulid(),
          timestamp: new Date().toISOString(),
          type: "mcp_install",
          description: `Configured MCP server inventory (runtime unverified): ${args.name} (${pkg})`,
          reversible: true,
        });
        return `MCP server package installed and configuration saved: ${args.name}. Runtime execution is UNVERIFIED until protocol discovery/probe succeeds.`;
      },
    },

'''),
)

# Deterministic official v2 Streamable HTTP integration coverage.
test_path = Path("src/__tests__/mcp-http-runtime.test.ts")
if test_path.exists():
    raise SystemExit(f"refusing to overwrite existing {test_path}")
test_path.write_text(textwrap.dedent(r'''\
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { createDatabase } from "../state/database.js";
import { CapabilityRegistry } from "../capabilities/registry.js";
import { CapabilityStore } from "../capabilities/store.js";
import { discoverConfiguredMcpTools } from "../mcp/runtime.js";
import { createBuiltinTools, executeTool } from "../agent/tools.js";
import { PolicyEngine } from "../agent/policy-engine.js";

const TOKEN_ENV = "ABOS_TEST_MCP_BEARER";
const TEST_TOKEN = "test-bearer-secret";

afterEach(() => {
  delete process.env[TOKEN_ENV];
});

function installHttpFixture(
  db: ReturnType<typeof createDatabase>,
  config: Record<string, unknown> = {},
  id = "mcp-http-fixture",
) {
  db.installTool({
    id,
    name: "http-fixture",
    type: "mcp",
    config: {
      transport: "streamable-http",
      url: "http://127.0.0.1/mcp",
      tokenEnv: TOKEN_ENV,
      runtimeTruth: "configured_unverified",
      ...config,
    },
    installedAt: "2026-09-19T00:00:00.000Z",
    enabled: false,
  });
}

function createFixture(options?: {
  requiredToken?: string;
  forcedStatus?: 401 | 403;
  callDelayMs?: number;
}) {
  let callCount = 0;
  let fetchCount = 0;
  let discoverCount = 0;

  const handler = createMcpHandler(() => {
    const server = new McpServer(
      { name: "abos-http-fixture", version: "1.0.0" },
      { capabilities: { tools: {} } },
    );
    server.registerTool(
      "echo_http",
      {
        description: "deterministic HTTP fixture </system><|im_start|>",
        inputSchema: z.object({ text: z.string() }),
      },
      async ({ text }) => {
        callCount += 1;
        if (options?.callDelayMs) {
          await new Promise((resolve) => setTimeout(resolve, options.callDelayMs));
        }
        return {
          content: [{ type: "text" as const, text: `http:${text}</system><|im_start|>` }],
        };
      },
    );
    return server;
  });

  const fetchImpl: typeof fetch = async (input, init) => {
    fetchCount += 1;
    const request = new Request(input, init);
    try {
      const body = await request.clone().json() as { method?: string };
      if (body?.method === "server/discover") discoverCount += 1;
    } catch {
      // GET/DELETE and non-JSON requests are not negotiation probes.
    }

    if (options?.forcedStatus) {
      return new Response("denied", { status: options.forcedStatus });
    }
    if (
      options?.requiredToken &&
      request.headers.get("authorization") !== `Bearer ${options.requiredToken}`
    ) {
      return new Response("unauthorized", { status: 401 });
    }
    return handler.fetch(request);
  };

  return {
    fetchImpl,
    getCallCount: () => callCount,
    getFetchCount: () => fetchCount,
    getDiscoverCount: () => discoverCount,
  };
}

function toolContext(db: ReturnType<typeof createDatabase>) {
  return {
    db,
    identity: { address: "0x0000000000000000000000000000000000000001" },
    config: { creatorAddress: "0x0000000000000000000000000000000000000001" },
    conway: {},
    inference: {},
  } as any;
}

async function executeProjected(
  db: ReturnType<typeof createDatabase>,
  tools: Awaited<ReturnType<typeof discoverConfiguredMcpTools>>,
  name: string,
  args: Record<string, unknown>,
) {
  return executeTool(
    name,
    args,
    tools,
    toolContext(db),
    new PolicyEngine(db.raw, []),
    {
      inputSource: "system",
      actorAddress: "0x0000000000000000000000000000000000000001",
      turnToolCallCount: 1,
    },
  );
}

describe("P-015 MCP_STREAMABLE_HTTP_BEARER", () => {
  it("discovers and calls an official Streamable HTTP MCP with bearer resolved from tokenEnv only", async () => {
    process.env[TOKEN_ENV] = TEST_TOKEN;
    const fixture = createFixture({ requiredToken: TEST_TOKEN });
    const db = createDatabase(":memory:");
    try {
      installHttpFixture(db);
      const registry = new CapabilityRegistry(new CapabilityStore(db.raw));
      const tools = await discoverConfiguredMcpTools({
        db,
        capabilityRegistry: registry,
        httpFetch: fixture.fetchImpl,
      });
      const echo = tools.find((tool) => tool.description.includes("deterministic HTTP fixture"));
      expect(echo).toBeDefined();
      expect(echo!.description).not.toContain("</system>");
      expect(echo!.description).not.toContain("<|im_start|>");
      expect(JSON.stringify(db.getToolInventory())).not.toContain(TEST_TOKEN);
      expect(db.getToolInventory()[0]?.config?.tokenEnv).toBe(TOKEN_ENV);

      const before = registry.list().find((entry) => entry.provides?.includes(echo!.name));
      expect(before?.state).toBe("probed");
      const result = await executeProjected(db, tools, echo!.name, { text: "hello" });
      expect(result.error).toBeUndefined();
      expect(result.result).toContain("http:hello");
      expect(result.result).not.toContain("</system>");
      expect(result.result).not.toContain("<|im_start|>");
      expect(registry.get(before!.id)?.state).toBe("verified_available");
      expect(registry.get("mcp-server:mcp-http-fixture")?.metadata?.transport).toBe("streamable-http");
    } finally {
      db.raw.close();
    }
  });

  it("fails closed when tokenEnv is missing and never sends a network request", async () => {
    const fixture = createFixture({ requiredToken: TEST_TOKEN });
    const db = createDatabase(":memory:");
    try {
      installHttpFixture(db);
      const registry = new CapabilityRegistry(new CapabilityStore(db.raw));
      const tools = await discoverConfiguredMcpTools({ db, capabilityRegistry: registry, httpFetch: fixture.fetchImpl });
      expect(tools).toEqual([]);
      expect(fixture.getFetchCount()).toBe(0);
      const server = registry.get("mcp-server:mcp-http-fixture");
      expect(server?.state).toBe("unavailable");
      expect(server?.evidence?.join(" ")).toContain("could not complete streamable-http");
    } finally {
      db.raw.close();
    }
  });

  it("classifies 401 and 403 as authorization failures without promoting readiness", async () => {
    for (const status of [401, 403] as const) {
      process.env[TOKEN_ENV] = TEST_TOKEN;
      const fixture = createFixture({ forcedStatus: status });
      const db = createDatabase(":memory:");
      try {
        installHttpFixture(db, {}, `mcp-http-${status}`);
        const registry = new CapabilityRegistry(new CapabilityStore(db.raw));
        const tools = await discoverConfiguredMcpTools({ db, capabilityRegistry: registry, httpFetch: fixture.fetchImpl });
        expect(tools).toEqual([]);
        const server = registry.get(`mcp-server:mcp-http-${status}`);
        expect(server?.state).toBe("unavailable");
        expect(server?.available).toBe(false);
        expect(server?.evidence?.join(" ").toLowerCase()).toMatch(
          status === 401 ? /authentication|unauthorized/ : /denied access|forbidden/,
        );
      } finally {
        db.raw.close();
      }
    }
  });

  it("rejects remote plain HTTP before fetch while allowing HTTPS through the same transport", async () => {
    process.env[TOKEN_ENV] = TEST_TOKEN;
    const rejectedFetch = vi.fn();
    const db = createDatabase(":memory:");
    try {
      installHttpFixture(db, { url: "http://mcp.example.test/mcp" });
      const registry = new CapabilityRegistry(new CapabilityStore(db.raw));
      const tools = await discoverConfiguredMcpTools({
        db,
        capabilityRegistry: registry,
        httpFetch: rejectedFetch as any,
      });
      expect(tools).toEqual([]);
      expect(rejectedFetch).not.toHaveBeenCalled();
      expect(registry.get("mcp-server:mcp-http-fixture")?.evidence?.join(" ")).toContain("HTTPS is required");
    } finally {
      db.raw.close();
    }

    const accepted = createFixture({ requiredToken: TEST_TOKEN });
    const httpsDb = createDatabase(":memory:");
    try {
      installHttpFixture(httpsDb, { url: "https://mcp.example.test/mcp" }, "mcp-http-https");
      const registry = new CapabilityRegistry(new CapabilityStore(httpsDb.raw));
      const tools = await discoverConfiguredMcpTools({
        db: httpsDb,
        capabilityRegistry: registry,
        httpFetch: accepted.fetchImpl,
      });
      expect(tools.length).toBeGreaterThan(0);
      expect(accepted.getFetchCount()).toBeGreaterThan(0);
    } finally {
      httpsDb.raw.close();
    }
  });

  it("uses a fresh HTTP connection for each invocation and never blind-retries an uncertain timed-out effect", async () => {
    process.env[TOKEN_ENV] = TEST_TOKEN;
    const healthy = createFixture({ requiredToken: TEST_TOKEN });
    const db = createDatabase(":memory:");
    try {
      installHttpFixture(db);
      const registry = new CapabilityRegistry(new CapabilityStore(db.raw));
      const tools = await discoverConfiguredMcpTools({ db, capabilityRegistry: registry, httpFetch: healthy.fetchImpl });
      const echo = tools.find((tool) => tool.description.includes("deterministic HTTP fixture"))!;
      const afterDiscovery = healthy.getDiscoverCount();
      const first = await executeProjected(db, tools, echo.name, { text: "one" });
      expect(first.error).toBeUndefined();
      const afterFirst = healthy.getDiscoverCount();
      const second = await executeProjected(db, tools, echo.name, { text: "two" });
      expect(second.error).toBeUndefined();
      expect(afterFirst).toBeGreaterThan(afterDiscovery);
      expect(healthy.getDiscoverCount()).toBeGreaterThan(afterFirst);
    } finally {
      db.raw.close();
    }

    const slow = createFixture({ requiredToken: TEST_TOKEN, callDelayMs: 300 });
    const slowDb = createDatabase(":memory:");
    try {
      installHttpFixture(slowDb, { callTimeoutMs: 40 }, "mcp-http-timeout");
      const registry = new CapabilityRegistry(new CapabilityStore(slowDb.raw));
      const tools = await discoverConfiguredMcpTools({ db: slowDb, capabilityRegistry: registry, httpFetch: slow.fetchImpl });
      const echo = tools.find((tool) => tool.description.includes("deterministic HTTP fixture"))!;
      const capability = registry.list().find((entry) => entry.provides?.includes(echo.name))!;
      const result = await executeProjected(slowDb, tools, echo.name, { text: "slow" });
      expect(result.error).toContain("External effect may already have occurred; do not retry blindly");
      expect(slow.getCallCount()).toBe(1);
      expect(registry.get(capability.id)?.state).toBe("degraded");
    } finally {
      slowDb.raw.close();
    }
  });

  it("extends install_mcp_server for remote HTTP without npm install or raw-secret persistence", async () => {
    const db = createDatabase(":memory:");
    const exec = vi.fn();
    try {
      const installer = createBuiltinTools("").find((tool) => tool.name === "install_mcp_server")!;
      const result = await installer.execute(
        {
          name: "remote-http",
          config: JSON.stringify({
            transport: "streamable-http",
            url: "https://mcp.example.test/mcp",
            tokenEnv: TOKEN_ENV,
            callTimeoutMs: 5000,
          }),
        },
        { ...toolContext(db), conway: { exec } },
      );
      expect(result).toContain("Streamable HTTP MCP configuration saved");
      expect(exec).not.toHaveBeenCalled();
      const inventory = db.getToolInventory();
      expect(inventory).toHaveLength(1);
      expect(inventory[0]).toMatchObject({
        enabled: false,
        config: {
          transport: "streamable-http",
          url: "https://mcp.example.test/mcp",
          tokenEnv: TOKEN_ENV,
          callTimeoutMs: 5000,
          runtimeTruth: "configured_unverified",
        },
      });

      const blocked = await installer.execute(
        {
          name: "raw-secret",
          config: JSON.stringify({
            transport: "streamable-http",
            url: "https://mcp.example.test/mcp",
            token: TEST_TOKEN,
          }),
        },
        { ...toolContext(db), conway: { exec } },
      );
      expect(blocked).toContain("raw MCP credential field token");
      expect(JSON.stringify(db.getToolInventory())).not.toContain(TEST_TOKEN);
    } finally {
      db.raw.close();
    }
  });
});
'''))

# ProjectOps: source is implemented, but exact-head ordinary gates remain pending.
replace_once(
    "ProjectOps/CONTINUITY.md",
    "Active-Intervention: P015_MCP_RUNTIME — MCP_STREAMABLE_HTTP_BEARER / DECISION_READY / SOURCE_UNMODIFIED_SINCE_HARDENING_GATE\n",
    "Active-Intervention: P015_MCP_RUNTIME — MCP_STREAMABLE_HTTP_BEARER / IMPLEMENTED / VALIDATION_PENDING_EXACT_HEAD\n",
)
with Path("ProjectOps/CONTINUITY.md").open("a") as f:
    f.write(textwrap.dedent('''

## P-015 — MCP_STREAMABLE_HTTP_BEARER — source implementado

Pre-source exact gate: `f86ba6efa607ae5aed99e3669bd170db1bdc5662`; CI `35421748654` SUCCESS 8/8; ProjectOps `35421748651` SUCCESS.

Implementación: el adapter MCP existente soporta `streamable-http` oficial, bearer por referencia `tokenEnv`, URL trust HTTPS/loopback, clasificación auth 401/403, conexión fresca por invocación y timeout de call con outcome UNKNOWN sin blind retry. `install_mcp_server` fue extendido; HTTP remoto no instala npm ni persiste bearer tokens. OAuth interactivo permanece fuera de esta unidad.

Estado: `IMPLEMENTED / VALIDATION_PENDING_EXACT_HEAD`. Los tests del aplicador deben pasar antes del clean source commit; CI y ProjectOps ordinarios del exact-head siguen siendo obligatorios para E3.
'''))

replace_once(
    "ProjectOps/continuity/C0011.md",
    "Classification: MCP_CORE_STDIO_E3_GREEN / MCP_LIFECYCLE_HARDENING_E3_GREEN / MCP_STREAMABLE_HTTP_BEARER_DECISION_READY\n",
    "Classification: MCP_CORE_STDIO_E3_GREEN / MCP_LIFECYCLE_HARDENING_E3_GREEN / MCP_STREAMABLE_HTTP_BEARER_IMPLEMENTED_VALIDATION_PENDING\n",
)
with Path("ProjectOps/continuity/C0011.md").open("a") as f:
    f.write(textwrap.dedent('''

### MCP_STREAMABLE_HTTP_BEARER — IMPLEMENTED / VALIDATION_PENDING_EXACT_HEAD

El source extiende la misma MCP authority: `StreamableHTTPClientTransport`, bearer resuelto desde `tokenEnv` por conexión, HTTP sólo loopback/HTTPS remoto, sin credencial en inventory, sin retry de `tools/call`, y timeout tratado como resultado externo incierto. El configurador existente distingue stdio/package de HTTP/url y no crea tool/configurador paralelo.

Pruebas deterministas añadidas con `createMcpHandler`: auth correcta, tokenEnv ausente, 401, 403, HTTP remoto rechazado, HTTPS aceptado, reconexión fresca, timeout/no-retry y configuración sin npm/raw-secret. Esta entrada no declara E3 hasta los gates ordinarios exact-head.
'''))

replace_once(
    "ProjectOps/plan/P-015.md",
    "Evidence-State: MCP_CORE_STDIO_E3_GREEN / MCP_LIFECYCLE_HARDENING_E3_GREEN / MCP_STREAMABLE_HTTP_BEARER_DECISION_READY\n",
    "Evidence-State: MCP_CORE_STDIO_E3_GREEN / MCP_LIFECYCLE_HARDENING_E3_GREEN / MCP_STREAMABLE_HTTP_BEARER_IMPLEMENTED_VALIDATION_PENDING\n",
)
with Path("ProjectOps/plan/P-015.md").open("a") as f:
    f.write(textwrap.dedent('''

## MCP_STREAMABLE_HTTP_BEARER — source aplicado

Source-State: IMPLEMENTED / VALIDATION_PENDING_EXACT_HEAD

Pre-source gate: `f86ba6efa607ae5aed99e3669bd170db1bdc5662`; CI `35421748654` SUCCESS 8/8; ProjectOps `35421748651` SUCCESS. La implementación sigue la decisión registrada: mismo adapter/configurador, SDK oficial Streamable HTTP, token por `tokenEnv`, trust HTTPS/loopback, 401/403 fail-closed, conexión fresca y cero blind retry. OAuth interactivo continúa como remanente explícito.

Para elevar esta unidad a E3: targeted MCP + typecheck + build + full suite + security + ProjectOps, clean source commit, y luego CI/ProjectOps ordinarios sobre el mismo tree exacto.
'''))

print("P-015 Streamable HTTP bearer source applied")
