
import type { AbosTool } from "../types.js";
import {
  getLocalBrowserRuntime,
  type LocalBrowserRuntime,
  type SemanticBrowserTarget,
  type SemanticBrowserAction,
} from "./local-runtime.js";

const targetSchema = {
  type: "object",
  description: "Semantic target. Provide exactly one of role, label, text, or placeholder. role may be paired with accessible name.",
  properties: {
    role: { type: "string", description: "ARIA role, e.g. button, link, textbox" },
    name: { type: "string", description: "Accessible name used with role" },
    label: { type: "string", description: "Associated accessible label" },
    text: { type: "string", description: "Visible text" },
    placeholder: { type: "string", description: "Input placeholder" },
    exact: { type: "boolean", description: "Require an exact semantic match (default true)" },
  },
  additionalProperties: false,
} as const;

function target(args: Record<string, unknown>): SemanticBrowserTarget {
  const value = args.target;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("browser action requires a semantic target object");
  }
  return value as SemanticBrowserTarget;
}

function encode(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

/**
 * Structured local-browser tools. The tool surface deliberately exposes no
 * arbitrary page-JavaScript or raw CDP command escape hatch; actions remain
 * role/label/text/placeholder based and are backed by one process-local runtime.
 */
export function createStructuredBrowserTools(
  runtime: LocalBrowserRuntime = getLocalBrowserRuntime(),
): AbosTool[] {
  return [
    {
      name: "browser_open",
      description: "Open a process-local structured browser session on the local host. Uses an already-installed browser; ABOS never downloads one implicitly.",
      category: "browser",
      riskLevel: "caution",
      externalOutput: true,
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "Optional initial HTTPS URL, or loopback HTTP URL" },
        },
      },
      execute: async (args) => encode(await runtime.open(typeof args.url === "string" ? args.url : undefined)),
    },
    {
      name: "browser_navigate",
      description: "Navigate an existing structured browser session. Remote URLs require HTTPS; HTTP is allowed only on loopback.",
      category: "browser",
      riskLevel: "caution",
      externalOutput: true,
      parameters: {
        type: "object",
        properties: {
          session_id: { type: "string" },
          url: { type: "string" },
        },
        required: ["session_id", "url"],
      },
      execute: async (args) => encode(await runtime.navigate(args.session_id as string, args.url as string)),
    },
    {
      name: "browser_snapshot",
      description: "Capture an AI-oriented accessibility snapshot of an existing structured browser session.",
      category: "browser",
      riskLevel: "safe",
      externalOutput: true,
      parameters: {
        type: "object",
        properties: { session_id: { type: "string" } },
        required: ["session_id"],
      },
      execute: async (args) => encode(await runtime.snapshot(args.session_id as string)),
    },
    {
      name: "browser_act",
      description: "Perform a semantic browser action by ARIA role/name, label, visible text, or placeholder. No arbitrary JavaScript or raw CDP is exposed.",
      category: "browser",
      riskLevel: "caution",
      externalOutput: true,
      parameters: {
        type: "object",
        properties: {
          session_id: { type: "string" },
          action: { type: "string", enum: ["click", "fill", "press", "check", "uncheck", "select"] },
          target: targetSchema,
          value: { type: "string", description: "Required for fill, press, and select" },
        },
        required: ["session_id", "action", "target"],
      },
      execute: async (args) => encode(await runtime.act(
        args.session_id as string,
        args.action as SemanticBrowserAction,
        target(args),
        typeof args.value === "string" ? args.value : undefined,
      )),
    },
    {
      name: "browser_upload",
      description: "Upload local files through a semantic file-input target. Paths are confined to the local ABOS home and sensitive credential files remain policy-protected.",
      category: "browser",
      riskLevel: "caution",
      externalOutput: true,
      parameters: {
        type: "object",
        properties: {
          session_id: { type: "string" },
          target: targetSchema,
          paths: { type: "array", items: { type: "string" }, minItems: 1 },
        },
        required: ["session_id", "target", "paths"],
      },
      execute: async (args) => encode(await runtime.upload(
        args.session_id as string,
        target(args),
        Array.isArray(args.paths) ? args.paths.filter((entry): entry is string => typeof entry === "string") : [],
      )),
    },
    {
      name: "browser_download",
      description: "Trigger a semantic download and materialize it under ~/Downloads/ABOS with a unique verified filename.",
      category: "browser",
      riskLevel: "caution",
      externalOutput: true,
      parameters: {
        type: "object",
        properties: {
          session_id: { type: "string" },
          target: targetSchema,
          filename: { type: "string", description: "Optional basename hint; path components are not accepted as authority" },
        },
        required: ["session_id", "target"],
      },
      execute: async (args) => encode(await runtime.download(
        args.session_id as string,
        target(args),
        typeof args.filename === "string" ? args.filename : undefined,
      )),
    },
    {
      name: "browser_close",
      description: "Close and invalidate one process-local structured browser session.",
      category: "browser",
      riskLevel: "safe",
      externalOutput: false,
      parameters: {
        type: "object",
        properties: { session_id: { type: "string" } },
        required: ["session_id"],
      },
      execute: async (args) => {
        await runtime.close(args.session_id as string);
        return `Browser session closed: ${args.session_id as string}`;
      },
    },
  ];
}
