import type { AbosTool } from "../types.js";
import type { EnvironmentRegistry } from "./registry.js";

const SENSITIVE_AWS_PATTERNS: Array<(args: string[]) => boolean> = [
  (args) => args[0] === "configure" && args.includes("get"),
  (args) => args[0] === "configure" && args.includes("export-credentials"),
  (args) => args[0] === "iam" && args[1] === "create-access-key",
  (args) => args[0] === "secretsmanager" && args[1] === "get-secret-value",
  (args) =>
    args[0] === "ssm" &&
    args[1] === "get-parameter" &&
    args.includes("--with-decryption"),
];

export function createEnvironmentTools(
  registry: EnvironmentRegistry,
): AbosTool[] {
  return [{
    name: "environment_exec",
    description:
      "Execute a provider-native command using an explicitly registered environment. " +
      "Arguments are passed as an argv array without shell interpolation. Use environment " +
      "inspection/capability evidence before choosing a provider.",
    category: "environment",
    riskLevel: "caution",
    parameters: {
      type: "object",
      properties: {
        environment: {
          type: "string",
          description: "Registered environment ID, for example aws.",
        },
        args: {
          type: "array",
          items: { type: "string" },
          description:
            "Provider-native argv after the provider executable. For AWS: ['s3','ls'].",
        },
        timeoutMs: {
          type: "number",
          description: "Execution timeout in milliseconds.",
        },
      },
      required: ["environment", "args"],
    },
    execute: async (args) => {
      const environment = String(args.environment ?? "").trim();
      const argv = Array.isArray(args.args)
        ? args.args.filter((value): value is string => typeof value === "string")
        : [];
      const timeoutMs =
        typeof args.timeoutMs === "number" && Number.isFinite(args.timeoutMs)
          ? Math.max(1_000, Math.min(args.timeoutMs, 900_000))
          : 120_000;

      if (!environment) return "BLOCKED: environment is required.";
      if (argv.length === 0) return "BLOCKED: provider argv must not be empty.";

      // Do not feed raw credential/secret material back into the model context.
      // This does not impose a service allowlist; it excludes only known secret-
      // extraction operations from this generic agent-facing surface.
      if (
        environment === "aws" &&
        SENSITIVE_AWS_PATTERNS.some((predicate) => predicate(argv))
      ) {
        return "BLOCKED: provider command would expose credential or secret material.";
      }

      const snapshot = await registry.get(environment)?.inspect();
      if (!snapshot) return `BLOCKED: unknown environment "${environment}".`;
      if (snapshot.availability === "unavailable") {
        return `UNAVAILABLE: ${environment}: ${snapshot.constraints.join("; ") || "environment unavailable"}`;
      }
      if (snapshot.availability === "requires_authorization") {
        return `UNAVAILABLE: ${environment} requires legitimate authorization before execution.`;
      }

      const result = await registry.execute(environment, argv, timeoutMs);
      return [
        `environment: ${environment}`,
        `exit_code: ${result.exitCode}`,
        `stdout: ${result.stdout}`,
        `stderr: ${result.stderr}`,
      ].join("\n");
    },
  }];
}
