/**
 * Tools Manager
 *
 * Manages installation and configuration of external tools and MCP servers.
 */

import type {
  ConwayClient,
  AbosDatabase,
  InstalledTool,
} from "../types.js";
import { logModification } from "./audit-log.js";
import { ulid } from "ulid";

/**
 * Install an npm package globally in the sandbox.
 */
export async function installNpmPackage(
  conway: ConwayClient,
  db: AbosDatabase,
  packageName: string,
): Promise<{ success: boolean; error?: string }> {
  // Sanitize package name (prevent command injection)
  if (!/^[@a-zA-Z0-9._/-]+$/.test(packageName)) {
    return {
      success: false,
      error: `Invalid package name: ${packageName}`,
    };
  }

  const result = await conway.exec(
    `npm install -g ${packageName}`,
    120000,
  );

  if (result.exitCode !== 0) {
    return {
      success: false,
      error: `npm install failed: ${result.stderr}`,
    };
  }

  // Record in database
  const tool: InstalledTool = {
    id: ulid(),
    name: packageName,
    type: "custom",
    config: { source: "npm", installCommand: `npm install -g ${packageName}` },
    installedAt: new Date().toISOString(),
    enabled: true,
  };

  db.installTool(tool);

  logModification(db, "tool_install", `Installed npm package: ${packageName}`, {
    reversible: true,
  });

  return { success: true };
}

/**
 * Configure an MCP server in durable inventory.
 *
 * P-015 owns the real MCP transport/handshake/tool-discovery runtime. Until
 * that runtime verifies a server, configuration alone must not promote the
 * entry into the enabled installed-tool set consumed by the agent loop.
 */
export async function installMcpServer(
  _conway: ConwayClient,
  db: AbosDatabase,
  name: string,
  command: string,
  args?: string[],
  env?: Record<string, string>,
): Promise<{ success: boolean; error?: string }> {
  const tool: InstalledTool = {
    id: ulid(),
    name: `mcp:${name}`,
    type: "mcp",
    config: {
      command,
      args,
      env,
      runtimeTruth: "configured_unverified",
    },
    installedAt: new Date().toISOString(),
    // `enabled` is the legacy runtime-loading gate. Keep nominal MCP disabled
    // until P-015 can establish protocol-level evidence and explicitly enable
    // a real discovered tool surface.
    enabled: false,
  };

  db.installTool(tool);

  logModification(
    db,
    "mcp_install",
    `Configured MCP server (unverified, not runtime-enabled): ${name} (${command})`,
    { reversible: true },
  );

  return { success: true };
}

/**
 * List runtime-enabled installed tools.
 *
 * This API reflects the database's enabled filter; it is not a complete
 * historical/configuration inventory and it is not independent readiness
 * evidence for external dependencies.
 */
export function listInstalledTools(
  db: AbosDatabase,
): InstalledTool[] {
  return db.getInstalledTools();
}

/**
 * Remove (disable) an installed tool.
 */
export function removeTool(
  db: AbosDatabase,
  toolId: string,
): void {
  db.removeTool(toolId);
  logModification(db, "tool_install", `Removed tool: ${toolId}`, {
    reversible: true,
  });
}
