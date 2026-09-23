import type { AbosTool } from "../types.js";
import {
  getLocalGuiRuntime,
  type GuiSelector,
  type GuiSemanticAction,
  type LocalGuiRuntime,
} from "./local-runtime.js";

const selectorSchema = {
  type: "object",
  description: "Exact semantic desktop selector. Provide one or more current UIAutomation fields; zero or multiple matches fail closed.",
  properties: {
    name: { type: "string" },
    automationId: { type: "string" },
    controlType: { type: "string", description: "UIAutomation control type, e.g. Button, Edit, Window" },
    className: { type: "string" },
    processId: { type: "integer" },
  },
  additionalProperties: false,
} as const;

function encode(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function selector(args: Record<string, unknown>): GuiSelector {
  const value = args.target;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("gui_act requires a semantic target object");
  }
  return value as GuiSelector;
}

export function createGuiTools(
  runtime: LocalGuiRuntime = getLocalGuiRuntime(),
): AbosTool[] {
  return [
    {
      name: "gui_snapshot",
      description: "Observe the current local desktop through a bounded UIAutomation accessibility snapshot. Returned window/control text is external and untrusted.",
      category: "environment",
      riskLevel: "safe",
      externalOutput: true,
      parameters: {
        type: "object",
        properties: {
          max_depth: { type: "integer", minimum: 0, maximum: 6, description: "Accessibility traversal depth; default 4" },
          max_nodes: { type: "integer", minimum: 1, maximum: 500, description: "Maximum returned nodes; default 200" },
        },
        additionalProperties: false,
      },
      execute: async (args) => encode(runtime.snapshot({
        maxDepth: typeof args.max_depth === "number" ? args.max_depth : undefined,
        maxNodes: typeof args.max_nodes === "number" ? args.max_nodes : undefined,
      })),
    },
    {
      name: "gui_capture",
      description: "Capture the current virtual screen to a verified PNG under the local ABOS home. No caller-controlled output path is accepted.",
      category: "environment",
      riskLevel: "caution",
      externalOutput: true,
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      execute: async () => encode(runtime.capture()),
    },
    {
      name: "gui_act",
      description: "Perform one semantic UIAutomation action against exactly one current desktop element. Targets are re-resolved each call; no stale handles or silent coordinate fallback are used.",
      category: "environment",
      riskLevel: "caution",
      externalOutput: true,
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["focus", "invoke", "set_value", "toggle", "select", "expand", "collapse"] },
          target: selectorSchema,
          value: { type: "string", description: "Required only for set_value" },
        },
        required: ["action", "target"],
        additionalProperties: false,
      },
      execute: async (args) => encode(runtime.act(
        args.action as GuiSemanticAction,
        selector(args),
        typeof args.value === "string" ? args.value : undefined,
      )),
    },
    {
      name: "gui_input",
      description: "Send explicit low-level local GUI input. This is the coordinate/keyboard last-resort surface; it never runs as a silent fallback from gui_act.",
      category: "environment",
      riskLevel: "caution",
      externalOutput: false,
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["pointer_move", "pointer_click", "type_text", "key_press"] },
          x: { type: "integer" },
          y: { type: "integer" },
          button: { type: "string", enum: ["left", "right", "middle"] },
          text: { type: "string" },
          key: { type: "string" },
          modifiers: {
            type: "array",
            items: { type: "string", enum: ["CTRL", "ALT", "SHIFT", "WIN"] },
            uniqueItems: true,
          },
        },
        required: ["action"],
        additionalProperties: false,
      },
      execute: async (args) => {
        const action = args.action;
        if (action === "pointer_move") {
          return encode(runtime.input({ action, x: Number(args.x), y: Number(args.y) }));
        }
        if (action === "pointer_click") {
          return encode(runtime.input({
            action,
            x: Number(args.x),
            y: Number(args.y),
            button: typeof args.button === "string" ? args.button as "left" | "right" | "middle" : undefined,
          }));
        }
        if (action === "type_text") {
          if (typeof args.text !== "string") throw new Error("gui_input type_text requires text");
          return encode(runtime.input({ action, text: args.text }));
        }
        if (action === "key_press") {
          if (typeof args.key !== "string") throw new Error("gui_input key_press requires key");
          let modifiers: Array<"CTRL" | "ALT" | "SHIFT" | "WIN"> | undefined;
          if (Array.isArray(args.modifiers)) {
            const allowed = new Set(["CTRL", "ALT", "SHIFT", "WIN"]);
            if (args.modifiers.some((entry) => typeof entry !== "string" || !allowed.has(entry))) {
              throw new Error("gui_input key_press received an unsupported modifier");
            }
            modifiers = args.modifiers as Array<"CTRL" | "ALT" | "SHIFT" | "WIN">;
          }
          return encode(runtime.input({ action, key: args.key, modifiers }));
        }
        throw new Error(`Unsupported gui_input action: ${String(action)}`);
      },
    },
  ];
}
