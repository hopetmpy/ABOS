import { execFileSync } from "node:child_process";
import { HarnessRegistry } from "../agent/harness-registry.js";
import type { AbosConfig, AbosIdentity } from "../types.js";
import { generateGenesisConfig } from "../replication/genesis.js";
import type { TaskNode, TaskResult } from "../orchestration/task-graph.js";
import { RUNTIME_ROOT } from "../runtime-root.js";
import type { EnvironmentLifecycleManager } from "./lifecycle.js";
import type {
  EnvironmentTaskDispatchResult,
  EnvironmentTaskExecutionAssessment,
  EnvironmentTaskExecutor,
  EnvironmentTaskSpawnResult,
  EnvironmentTaskTarget,
} from "./task-executor.js";
import { AwsEnvironmentProvider } from "./aws.js";

const DEFAULT_INSTALL_ROOT = "/opt/abos";
const DEFAULT_REPOSITORY = "https://github.com/hopetmpy/ABOS.git";
const DEFAULT_REPOSITORY_REF = "main";
const TASK_RESULT_MARKER = "ABOS_TASK_RESULT_BASE64=";

export interface AwsEc2TaskExecutorOptions {
  provider: AwsEnvironmentProvider;
  lifecycle: EnvironmentLifecycleManager;
  identity: AbosIdentity;
  config: AbosConfig;
  repositoryUrl?: string;
  repositoryRef?: string;
  installRoot?: string;
  resourceMetadata?: Record<string, unknown>;
}

/**
 * EC2 Task executor transported over AWS Systems Manager.
 *
 * This adapter owns AWS-specific spawn/bootstrap/dispatch mechanics. The
 * Orchestrator sees only the open EnvironmentTaskExecutor contract.
 */
export class AwsEc2TaskExecutor implements EnvironmentTaskExecutor {
  readonly environmentId = "aws";

  constructor(private readonly options: AwsEc2TaskExecutorOptions) {}

  async assess(task: TaskNode): Promise<EnvironmentTaskExecutionAssessment> {
    const harnessId = new HarnessRegistry().getHarnessIdForRole(task.agentRole);
    if (harnessId === "orchestrator") {
      return {
        executable: false,
        evidence: [
          "AWS EC2 one-shot execution currently lacks the live delegated-worker scheduler required by the orchestrator harness.",
          "This is a currently unavailable execution capability, not proof that the objective is impossible.",
        ],
      };
    }

    const snapshot = await this.options.provider.inspect();
    if (
      snapshot.availability === "unavailable" ||
      snapshot.availability === "requires_authorization"
    ) {
      return {
        executable: false,
        evidence: [
          ...snapshot.evidence,
          `AWS Task executor preflight availability=${snapshot.availability}.`,
        ],
      };
    }

    const reusable = this.findReusableResources();
    return {
      // SSM reachability for a newly provisioned instance is intentionally
      // discovered during the real bootstrap attempt. UNKNOWN remains eligible.
      executable: reusable.length > 0 ? true : null,
      evidence: [
        ...snapshot.evidence,
        `AWS managed reusable EC2 executor candidates=${reusable.length}.`,
        reusable.length > 0
          ? "A previously owned AWS EC2 executor can be health-checked for reuse."
          : "No reusable executor is known. EC2 + SSM execution remains eligible for a real provisioning/bootstrap attempt.",
      ],
    };
  }

  async spawn(task: TaskNode): Promise<EnvironmentTaskSpawnResult> {
    const reusable = await this.findHealthyReusableResource();
    if (reusable?.externalId) {
      return {
        address: executorAddress(reusable.externalId),
        name: resourceName(reusable.metadata) ?? `aws-ec2-${reusable.externalId}`,
        sandboxId: reusable.externalId,
        resourceExternalId: reusable.externalId,
        resourceType: "aws-ec2-instance",
        evidence: [
          `Reusing healthy ABOS-owned AWS EC2 executor ${reusable.externalId}.`,
        ],
        metadata: {
          executorKind: "aws-ec2-ssm",
          reusedResourceId: reusable.id,
          region: reusable.region,
        },
      };
    }

    const name = workerName(task);
    const repositoryRef = this.options.repositoryRef ?? resolveRuntimeGitRef();
    const estimate = await this.options.provider.estimate({
      requiredCapabilities: ["remote compute", "linux", "ssm"],
      expectedDurationMs: task.metadata.timeoutMs,
      goalId: task.goalId,
      pathId: task.strategicPathId ?? null,
      taskId: task.id,
      metadata: this.options.resourceMetadata,
    });

    const provisioned = await this.options.lifecycle.provision("aws", {
      resourceType: "ec2",
      retentionPolicy: "until_goal_complete",
      requiredCapabilities: [
        "remote compute",
        "virtual machine",
        "linux",
        "ec2",
        "ssm",
        "task executor",
      ],
      requiredOperations: [
        "provision",
        "bootstrap",
        "health",
        "reconcile",
        "suspend",
        "resume",
        "destroy",
      ],
      expectedDurationMs: task.metadata.timeoutMs,
      goalId: task.goalId,
      pathId: task.strategicPathId ?? null,
      taskId: task.id,
      selectionEstimateCents: estimate.estimatedCostCents ?? null,
      selectionEvidence: estimate.evidence,
      metadata: {
        ...(this.options.resourceMetadata ?? {}),
        ...(typeof estimate.metadata?.hourlyCostCents === "number"
          ? { hourlyCostCents: estimate.metadata.hourlyCostCents }
          : {}),
        service: "ec2",
        name,
        executorKind: "aws-ec2-ssm",
        ssmRequired: true,
      },
    });

    if (!provisioned.externalId) {
      throw new Error(
        "AWS lifecycle provision returned no EC2 external id; executor identity is unavailable.",
      );
    }

    const genesis = generateGenesisConfig(
      this.options.identity,
      this.options.config,
      {
        name,
        specialization: [
          "You are an ABOS execution worker running in an external environment.",
          "Retain the parent's broad capability model and knowledge. Your immediate assignment is supplied separately as a Task envelope.",
          `Current task context: ${task.title} — ${task.description}`,
        ].join("\n"),
        message: `Provisioned as an AWS EC2 executor for parent task ${task.id}.`,
      },
    );
    const genesisBase64 = Buffer.from(
      JSON.stringify(genesis),
      "utf8",
    ).toString("base64");

    const bootstrapped = await this.options.lifecycle.bootstrap(
      provisioned.id,
      {
        requiredCapabilities: ["task executor", "ssm"],
        expectedDurationMs: Math.max(task.metadata.timeoutMs, 300_000),
        region: provisioned.region,
        goalId: task.goalId,
        pathId: task.strategicPathId ?? null,
        taskId: task.id,
        metadata: {
          genesisBase64,
          repositoryUrl:
            this.options.repositoryUrl ??
            DEFAULT_REPOSITORY,
          repositoryRef:
            repositoryRef,
          installRoot:
            this.options.installRoot ??
            DEFAULT_INSTALL_ROOT,
        },
      },
    );

    if (!["running", "ready"].includes(bootstrapped.status)) {
      throw new Error(
        `AWS EC2 bootstrap did not produce a runnable executor: status=${bootstrapped.status} providerState=${bootstrapped.providerState ?? "unknown"}.`,
      );
    }

    this.options.lifecycle.resources.applyMutation(
      bootstrapped.id,
      {
        evidence: [
          `AWS EC2 executor ${provisioned.externalId} prepared for Task dispatch.`,
        ],
        metadata: {
          executorKind: "aws-ec2-ssm",
          ssmRequired: true,
          executorAddress: executorAddress(provisioned.externalId),
          executorName: name,
          installRoot:
            this.options.installRoot ??
            DEFAULT_INSTALL_ROOT,
          repositoryRef:
            repositoryRef,
        },
      },
      "executor_ready",
      "AWS EC2 resource became a provider-neutral ABOS Task executor.",
    );

    return {
      address: executorAddress(provisioned.externalId),
      name,
      sandboxId: provisioned.externalId,
      resourceExternalId: provisioned.externalId,
      resourceType: "aws-ec2-instance",
      evidence: [
        ...bootstrapped.evidence,
        `AWS EC2 executor ${provisioned.externalId} is ready for Task ${task.id}.`,
      ],
      metadata: {
        executorKind: "aws-ec2-ssm",
        resourceId: bootstrapped.id,
        region: bootstrapped.region,
      },
    };
  }

  async dispatch(
    task: TaskNode,
    target: EnvironmentTaskTarget,
  ): Promise<EnvironmentTaskDispatchResult> {
    const instanceId = resolveInstanceId(target.address);
    if (!instanceId) {
      throw new Error(
        `AWS EC2 executor address is invalid: ${target.address}`,
      );
    }

    const resource = this.options.lifecycle.resources
      .list({ includeTerminated: true })
      .find(
        (entry) =>
          entry.provider === "aws" &&
          entry.externalId === instanceId,
      );

    const installRoot =
      (resource && typeof resource.metadata.installRoot === "string"
        ? resource.metadata.installRoot
        : null) ??
      this.options.installRoot ??
      DEFAULT_INSTALL_ROOT;
    const remoteTaskPath =
      `$HOME/.abos/tasks/${safeTaskFileName(task.id)}.json`;
    const taskBase64 = Buffer.from(
      JSON.stringify(task),
      "utf8",
    ).toString("base64");

    const script = [
      "set -euo pipefail",
      'mkdir -p "$HOME/.abos/tasks"',
      `printf %s ${shellQuote(taskBase64)} | base64 -d > "${remoteTaskPath}"`,
      `cd ${shellQuote(installRoot)}`,
      `node dist/index.js --execute-task-file "${remoteTaskPath}"`,
    ].join("\n");

    const invocation = await this.options.provider.runSsmCommands(
      instanceId,
      [script],
      resource?.region ?? null,
      Math.max(task.metadata.timeoutMs + 60_000, 120_000),
    );

    if (invocation.Status !== "Success") {
      throw new Error(
        `AWS SSM Task transport failed for ${instanceId}: status=${invocation.Status ?? "unknown"} responseCode=${invocation.ResponseCode ?? "unknown"} stderr=${(invocation.StandardErrorContent ?? "").slice(0, 1000)}`,
      );
    }

    const result = parseTaskResult(invocation.StandardOutputContent ?? "");
    if (!result) {
      throw new Error(
        `AWS EC2 Task process completed but emitted no valid ${TASK_RESULT_MARKER} marker. stdout=${(invocation.StandardOutputContent ?? "").slice(0, 1500)}`,
      );
    }

    return {
      result,
      evidence: [
        `Task ${task.id} executed through AWS SSM on EC2 ${instanceId}.`,
        `Remote semantic result success=${result.success} durationMs=${result.duration}.`,
      ],
      metadata: {
        delivery: "aws_ssm",
        commandId: invocation.CommandId ?? null,
        instanceId,
        responseCode: invocation.ResponseCode ?? null,
      },
    };
  }

  private findReusableResources() {
    return this.options.lifecycle.resources
      .list()
      .filter(
        (resource) =>
          resource.provider === "aws" &&
          resource.type === "aws-ec2-instance" &&
          resource.metadata.executorKind === "aws-ec2-ssm" &&
          ["ready", "running", "degraded"].includes(resource.status),
      );
  }

  private async findHealthyReusableResource() {
    for (const candidate of this.findReusableResources()) {
      const observed = await this.options.lifecycle.health(candidate.id);
      if (["ready", "running"].includes(observed.status)) {
        return observed;
      }
    }
    return null;
  }
}

function resolveRuntimeGitRef(): string {
  try {
    const value = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: RUNTIME_ROOT,
      encoding: "utf8",
      timeout: 5_000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return /^[0-9a-f]{40}$/i.test(value) ? value : DEFAULT_REPOSITORY_REF;
  } catch {
    return DEFAULT_REPOSITORY_REF;
  }
}

function executorAddress(instanceId: string): string {
  return `aws://ec2/${instanceId}`;
}

function resolveInstanceId(address: string): string | null {
  const match = /^aws:\/\/ec2\/([^/]+)$/i.exec(address.trim());
  return match?.[1] ?? null;
}

function workerName(task: TaskNode): string {
  const role = (task.agentRole ?? "generalist")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 20) || "generalist";
  const suffix = task.id
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(-10) || Date.now().toString(36);
  return `aws-${role}-${suffix}`.slice(0, 63);
}

function resourceName(metadata: Record<string, unknown>): string | null {
  return typeof metadata.executorName === "string" &&
    metadata.executorName.trim()
    ? metadata.executorName.trim()
    : null;
}

function safeTaskFileName(taskId: string): string {
  const normalized = taskId
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .slice(0, 100);
  return normalized || "task";
}

function parseTaskResult(stdout: string): TaskResult | null {
  const markerLine = stdout
    .split(/\r?\n/u)
    .reverse()
    .find((line) => line.trim().startsWith(TASK_RESULT_MARKER));
  if (!markerLine) return null;

  const encoded = markerLine
    .trim()
    .slice(TASK_RESULT_MARKER.length)
    .trim();
  if (!encoded) return null;

  try {
    const parsed = JSON.parse(
      Buffer.from(encoded, "base64").toString("utf8"),
    ) as Partial<TaskResult>;
    if (
      typeof parsed.success !== "boolean" ||
      typeof parsed.output !== "string" ||
      !Array.isArray(parsed.artifacts) ||
      !parsed.artifacts.every((entry) => typeof entry === "string") ||
      typeof parsed.costCents !== "number" ||
      !Number.isFinite(parsed.costCents) ||
      typeof parsed.duration !== "number" ||
      !Number.isFinite(parsed.duration)
    ) {
      return null;
    }

    return {
      success: parsed.success,
      output: parsed.output,
      artifacts: parsed.artifacts,
      costCents: parsed.costCents,
      duration: parsed.duration,
    };
  } catch {
    return null;
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}
