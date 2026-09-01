import { execFile } from "node:child_process";
import type {
  CommandResult,
  EnvironmentCommandRunner,
  EnvironmentProvider,
  EnvironmentSnapshot,
} from "./types.js";

const defaultRunner: EnvironmentCommandRunner = (
  command,
  args,
  timeoutMs,
) => new Promise<CommandResult>((resolve) => {
  execFile(command, args, { timeout: timeoutMs, encoding: "utf8" }, (error, stdout, stderr) => {
    const err = error as (Error & { code?: string | number }) | null;
    const exitCode = typeof err?.code === "number" ? err.code : err ? 1 : 0;
    resolve({
      stdout: stdout ?? "",
      stderr: stderr ?? (err?.message ?? ""),
      exitCode,
    });
  });
});

export class AwsEnvironmentProvider implements EnvironmentProvider {
  readonly id = "aws";

  constructor(private readonly runner: EnvironmentCommandRunner = defaultRunner) {}

  async inspect(): Promise<EnvironmentSnapshot> {
    const version = await this.runner("aws", ["--version"], 10_000);
    if (version.exitCode !== 0) {
      return {
        id: this.id,
        label: "Amazon Web Services",
        availability: "unavailable",
        capabilities: this.capabilities(false),
        evidence: [version.stderr || "AWS CLI is not installed or not executable."],
        costModel: "AWS account billing",
        constraints: ["AWS CLI must be installed before this environment can execute."],
        observedAt: new Date().toISOString(),
      };
    }

    const identity = await this.runner(
      "aws",
      ["sts", "get-caller-identity", "--output", "json"],
      15_000,
    );

    if (identity.exitCode !== 0) {
      return {
        id: this.id,
        label: "Amazon Web Services",
        availability: "requires_authorization",
        capabilities: this.capabilities(false),
        evidence: [
          version.stdout || version.stderr,
          identity.stderr || "AWS credentials are not currently usable.",
        ].filter(Boolean),
        costModel: "AWS account billing",
        constraints: ["Valid AWS authorization is required."],
        observedAt: new Date().toISOString(),
      };
    }

    let callerIdentity: Record<string, unknown> = {};
    try {
      callerIdentity = JSON.parse(identity.stdout) as Record<string, unknown>;
    } catch {
      callerIdentity = { raw: identity.stdout.trim() };
    }

    return {
      id: this.id,
      label: "Amazon Web Services",
      availability: "available",
      capabilities: this.capabilities(true),
      evidence: [
        version.stdout || version.stderr,
        "AWS STS caller identity verified.",
      ].filter(Boolean),
      costModel: "AWS account billing",
      constraints: [],
      metadata: { callerIdentity },
      observedAt: new Date().toISOString(),
    };
  }

  async execute(args: string[], timeoutMs = 120_000): Promise<CommandResult> {
    return this.runner("aws", args, timeoutMs);
  }

  private capabilities(available: boolean) {
    const capability = (
      id: string,
      description: string,
      requirements: string[],
    ) => ({
      id: `aws:${id}`,
      type: "cloud_resource" as const,
      provider: "aws",
      description,
      requirements,
      permissions: [],
      environment: "aws",
      available,
    });

    return [
      capability("ec2", "Elastic virtual machine compute.", ["compute", "virtual machine", "ec2"]),
      capability("lambda", "Serverless function execution.", ["serverless", "function", "lambda"]),
      capability("ecs", "Managed container execution.", ["container", "ecs"]),
      capability("s3", "Object storage.", ["object storage", "s3", "storage"]),
      capability("sqs", "Managed message queues.", ["queue", "messaging", "sqs"]),
      capability("dynamodb", "Managed key-value/document database.", ["database", "dynamodb"]),
      capability("rds", "Managed relational database.", ["relational database", "rds"]),
    ];
  }
}
