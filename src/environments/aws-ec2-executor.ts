import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { HarnessRegistry } from "../agent/harness-registry.js";
import type { AbosConfig, AbosIdentity } from "../types.js";
import { generateGenesisConfig } from "../replication/genesis.js";
import type { TaskNode, TaskResult } from "../orchestration/task-graph.js";
import { RUNTIME_ROOT } from "../runtime-root.js";
import { createTaskExecutionEnvelope } from "../orchestration/task-execution-envelope.js";
import type { EnvironmentLifecycleManager } from "./lifecycle.js";
import type {
  EnvironmentTaskDispatchOptions,
  EnvironmentTaskDispatchResult,
  EnvironmentTaskExecutionAssessment,
  EnvironmentTaskExecutor,
  EnvironmentTaskSpawnResult,
  EnvironmentTaskSpawnOptions,
  EnvironmentTaskTarget,
} from "./task-executor.js";
import { AwsEnvironmentProvider } from "./aws.js";
import {
  ARTIFACT_MATERIALIZATION_PROTOCOL_VERSION,
  artifactTargetRelativePath,
  isDurableExternalArtifactReference,
  remoteEnvironmentArtifactReference,
  type ArtifactMaterializationRequest,
  type ArtifactMaterializationResult,
} from "./artifact-materialization.js";

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

  async assess(
    task: TaskNode,
    spawnOptions: EnvironmentTaskSpawnOptions = {},
  ): Promise<EnvironmentTaskExecutionAssessment> {
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

    const reusable = this.findReusableResources(
      spawnOptions.excludedResourceIds ?? [],
    );
    const instanceProfile =
      this.options.provider.getConfiguredIamInstanceProfile(
        this.options.resourceMetadata,
      );

    if (reusable.length === 0 && !instanceProfile) {
      return {
        executable: false,
        evidence: [
          ...snapshot.evidence,
          "No reusable AWS EC2 executor is currently owned by ABOS.",
          "A new EC2 SSM executor requires an IAM instance profile before provisioning. Configure ABOS_AWS_EC2_INSTANCE_PROFILE or resourceMetadata.iamInstanceProfile.",
          "Missing SSM instance authorization is currently unavailable/requires authorization, not proof that the objective is impossible.",
        ],
      };
    }

    return {
      // A configured instance profile is authorization evidence for a new
      // executor, but SSM reachability is still verified after provisioning.
      executable: reusable.length > 0 ? true : null,
      evidence: [
        ...snapshot.evidence,
        `AWS managed reusable EC2 executor candidates=${reusable.length}.`,
        reusable.length > 0
          ? "A previously owned AWS EC2 executor can be health-checked for reuse."
          : `New EC2 executor provisioning is authorized with IAM instance profile=${instanceProfile}.`,
      ],
    };
  }

  async spawn(
    task: TaskNode,
    spawnOptions: EnvironmentTaskSpawnOptions = {},
  ): Promise<EnvironmentTaskSpawnResult> {
    const reusable = await this.findHealthyReusableResource(
      spawnOptions.excludedResourceIds ?? [],
    );
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

    const instanceProfile =
      this.options.provider.getConfiguredIamInstanceProfile(
        this.options.resourceMetadata,
      );
    if (!instanceProfile) {
      throw new Error(
        "AWS EC2 Task executor requires an IAM instance profile for SSM before provisioning. No instance was created. Configure ABOS_AWS_EC2_INSTANCE_PROFILE or resourceMetadata.iamInstanceProfile.",
      );
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
      // A newly provisioned VM is only a candidate executor. Keep it Task-scoped
      // until bootstrap succeeds; EnvironmentExecutionBridge promotes the
      // proven executor to until_goal_complete through canonical adopt().
      retentionPolicy: "ephemeral",
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
        iamInstanceProfile: instanceProfile,
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
      this.options.lifecycle.resources.applyMutation(
        bootstrapped.id,
        {
          status: "failed",
          evidence: [
            "AWS EC2 candidate failed to become a runnable Task executor; ephemeral retention is now eligible for cleanup.",
          ],
          metadata: {
            executorBootstrapFailedAt: new Date().toISOString(),
          },
        },
        "executor_bootstrap_failed",
        "Provisioned AWS resource did not become a runnable executor.",
      );
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

  async materializeArtifacts(
    task: TaskNode,
    target: EnvironmentTaskTarget,
    request: ArtifactMaterializationRequest,
  ): Promise<ArtifactMaterializationResult> {
    const instanceId = resolveInstanceId(target.address);
    if (!instanceId) {
      throw new Error(
        `AWS EC2 artifact target address is invalid: ${target.address}`,
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
    const timeoutMs = Math.max(
      task.metadata.timeoutMs,
      120_000,
    );
    const entries: ArtifactMaterializationResult["entries"] = [];
    const evidence: string[] = [];

    for (const source of request.sources) {
      const relative = artifactTargetRelativePath(
        request,
        source,
      );
      const targetPath = path.posix.join(
        installRoot,
        relative,
      );
      const encodedPath = `${targetPath}.b64`;

      try {
        const body = fs.readFileSync(source.localPath);
        const observedSourceDigest = createHash("sha256")
          .update(body)
          .digest("hex");
        if (
          source.integrity.algorithm.toLowerCase() !== "sha256" ||
          source.integrity.digest.toLowerCase() !==
            observedSourceDigest.toLowerCase()
        ) {
          entries.push({
            reference: source.reference,
            state: "unknown",
            evidence: [
              "Parent artifact changed after the materialization plan was prepared; AWS upload was not attempted.",
            ],
          });
          continue;
        }

        const initialized =
          await this.options.provider.runSsmCommands(
            instanceId,
            [[
              "set -euo pipefail",
              `mkdir -p -- ${shellQuote(path.posix.dirname(targetPath))}`,
              `: > ${shellQuote(encodedPath)}`,
            ].join("\n")],
            resource?.region ?? null,
            timeoutMs,
          );
        if (initialized.Status !== "Success") {
          throw new Error(
            `remote artifact staging initialization failed with SSM status=${initialized.Status ?? "unknown"}: ${initialized.StandardErrorContent ?? ""}`,
          );
        }

        const encoded = body.toString("base64");
        const chunkChars = 12_000;
        for (
          let offset = 0;
          offset < encoded.length;
          offset += chunkChars
        ) {
          const chunk = encoded.slice(
            offset,
            offset + chunkChars,
          );
          const uploaded =
            await this.options.provider.runSsmCommands(
              instanceId,
              [
                `set -euo pipefail\nprintf %s ${shellQuote(chunk)} >> ${shellQuote(encodedPath)}`,
              ],
              resource?.region ?? null,
              timeoutMs,
            );
          if (uploaded.Status !== "Success") {
            throw new Error(
              `remote artifact chunk upload failed at base64 offset=${offset} status=${uploaded.Status ?? "unknown"}: ${uploaded.StandardErrorContent ?? ""}`,
            );
          }
        }

        const finalized =
          await this.options.provider.runSsmCommands(
            instanceId,
            [[
              "set -euo pipefail",
              `base64 -d -- ${shellQuote(encodedPath)} > ${shellQuote(targetPath)}`,
              `chmod 600 -- ${shellQuote(targetPath)}`,
              `rm -f -- ${shellQuote(encodedPath)}`,
              `printf 'ABOS_MATERIALIZED_BYTES=%s\\nABOS_MATERIALIZED_SHA256=%s\\n' "$(stat -c %s ${shellQuote(targetPath)})" "$(sha256sum ${shellQuote(targetPath)} | awk '{print $1}')"`,
            ].join("\n")],
            resource?.region ?? null,
            timeoutMs,
          );
        if (finalized.Status !== "Success") {
          throw new Error(
            `remote artifact finalization failed with SSM status=${finalized.Status ?? "unknown"}: ${finalized.StandardErrorContent ?? ""}`,
          );
        }

        const observation =
          parseAwsMaterializationObservation(
            finalized.StandardOutputContent ?? "",
          );
        if (!observation) {
          entries.push({
            reference: source.reference,
            state: "unknown",
            evidence: [
              "AWS target did not return valid size/hash materialization markers.",
            ],
          });
          continue;
        }

        const verified =
          observation.bytes === source.bytes &&
          observation.sha256.toLowerCase() ===
            source.integrity.digest.toLowerCase();

        entries.push({
          reference: source.reference,
          state: verified ? "available" : "unknown",
          targetPath: verified ? targetPath : null,
          integrity: {
            algorithm: "sha256",
            digest: observation.sha256,
          },
          evidence: [
            `AWS target observed bytes=${observation.bytes} sha256=${observation.sha256}.`,
            ...(verified
              ? ["AWS target artifact matches parent manifest."]
              : [
                  `AWS target verification mismatch: expected bytes=${source.bytes} sha256=${source.integrity.digest}.`,
                ]),
          ],
          metadata: {
            instanceId,
            installRoot,
          },
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        entries.push({
          reference: source.reference,
          state: "unavailable",
          evidence: [
            `AWS target artifact materialization failed: ${message}`,
          ],
          metadata: {
            instanceId,
            installRoot,
          },
        });
        evidence.push(
          `AWS artifact "${source.reference}" could not be materialized: ${message}`,
        );
        try {
          await this.options.provider.runSsmCommands(
            instanceId,
            [
              `rm -f -- ${shellQuote(encodedPath)}`,
            ],
            resource?.region ?? null,
            timeoutMs,
          );
        } catch {
          // Cleanup failure does not change the already-unavailable transfer
          // observation and must not be represented as successful delivery.
        }
      }
    }

    return {
      protocolVersion:
        ARTIFACT_MATERIALIZATION_PROTOCOL_VERSION,
      entries,
      evidence,
      metadata: {
        transport: "aws_ssm_chunked_base64",
        instanceId,
        installRoot,
      },
    };
  }

  async dispatch(
    task: TaskNode,
    target: EnvironmentTaskTarget,
    options: EnvironmentTaskDispatchOptions = {},
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
      JSON.stringify(
        createTaskExecutionEnvelope(
          task,
          options.continuationContext,
        ),
      ),
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

    const durableArtifacts = result.artifacts.filter(
      isDurableExternalArtifactReference,
    );
    const localRemoteArtifacts = result.artifacts.filter(
      (artifact) =>
        !isDurableExternalArtifactReference(artifact),
    );
    let semanticArtifacts = [...result.artifacts];
    let artifactCollectionState =
      localRemoteArtifacts.length > 0 ? "pending" : "none";
    let remoteArtifacts = [...localRemoteArtifacts];
    let collectedArtifacts: unknown[] = [];
    const collectionEvidence: string[] = [];

    if (resource && localRemoteArtifacts.length > 0) {
      this.options.lifecycle.resources.applyMutation(
        resource.id,
        {
          evidence: [
            `Task ${task.id} reported ${localRemoteArtifacts.length} executor-local artifact(s); collection started before retention can release the resource.`,
          ],
          metadata: {
            remoteArtifacts: localRemoteArtifacts,
            artifactCollectionState: "pending",
            artifactHost: executorAddress(instanceId),
          },
        },
        "artifact_discovered",
        "Remote Task artifacts require materialization on the parent host.",
      );

      try {
        const collection = await this.options.lifecycle.collect(resource.id);
        const collectionMetadata = collection.metadata ?? {};
        remoteArtifacts = stringArray(
          collectionMetadata.remoteArtifacts,
        );
        artifactCollectionState =
          typeof collectionMetadata.artifactCollectionState === "string"
            ? collectionMetadata.artifactCollectionState
            : remoteArtifacts.length === 0
              ? "collected"
              : "pending";
        collectedArtifacts = Array.isArray(
          collectionMetadata.collectedArtifacts,
        )
          ? collectionMetadata.collectedArtifacts
          : [];

        semanticArtifacts = [
          ...durableArtifacts,
          ...collection.artifacts,
          ...remoteArtifacts.map((artifact) =>
            remoteEnvironmentArtifactReference(
              "aws",
              executorAddress(instanceId),
              artifact,
            )
          ),
        ];
        collectionEvidence.push(...(collection.evidence ?? []));
      } catch (error) {
        semanticArtifacts = [
          ...durableArtifacts,
          ...localRemoteArtifacts.map((artifact) =>
            remoteEnvironmentArtifactReference(
              "aws",
              executorAddress(instanceId),
              artifact,
            )
          ),
        ];
        collectionEvidence.push(
          `Automatic AWS artifact collection failed: ${error instanceof Error ? error.message : String(error)}. Remote artifacts remain preserved/pending rather than being reported as local.`,
        );
      }
    } else if (localRemoteArtifacts.length === 0) {
      semanticArtifacts = durableArtifacts;
    }

    const semanticResult: TaskResult = {
      ...result,
      artifacts: semanticArtifacts,
    };

    return {
      result: semanticResult,
      evidence: [
        `Task ${task.id} executed through AWS SSM on EC2 ${instanceId}.`,
        `Remote semantic result success=${result.success} durationMs=${result.duration}.`,
        ...collectionEvidence,
      ],
      metadata: {
        delivery: "aws_ssm",
        continuationDelivered: options.continuationContext != null,
        continuationProtocolVersion:
          options.continuationContext?.protocolVersion ?? null,
        commandId: invocation.CommandId ?? null,
        instanceId,
        responseCode: invocation.ResponseCode ?? null,
        remoteArtifacts,
        collectedArtifacts,
        artifactCollectionState,
        artifactHost: executorAddress(instanceId),
      },
    };
  }

  private findReusableResources(excludedResourceIds: string[] = []) {
    const excluded = new Set(excludedResourceIds);
    const releaseStates = new Set([
      "artifact_hold",
      "destroy_requested",
      "pending_observation",
      "released",
    ]);

    return this.options.lifecycle.resources
      .list()
      .filter(
        (resource) =>
          resource.provider === "aws" &&
          !excluded.has(resource.id) &&
          resource.type === "aws-ec2-instance" &&
          resource.metadata.executorKind === "aws-ec2-ssm" &&
          ["ready", "running", "suspended"].includes(resource.status) &&
          resource.metadata.artifactCollectionState !== "pending" &&
          !releaseStates.has(
            typeof resource.metadata.retentionReleaseState === "string"
              ? resource.metadata.retentionReleaseState
              : "",
          ),
      );
  }

  private async findHealthyReusableResource(
    excludedResourceIds: string[] = [],
  ) {
    for (const candidate of this.findReusableResources(excludedResourceIds)) {
      let current = candidate;
      if (current.status === "suspended") {
        current = await this.options.lifecycle.resume(current.id);
        if (!["ready", "running"].includes(current.status)) {
          continue;
        }
      }

      const observed = await this.options.lifecycle.health(current.id);
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

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter(Boolean)
    : [];
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

function parseAwsMaterializationObservation(
  output: string,
): { bytes: number; sha256: string } | null {
  const bytesMatch =
    /(?:^|\n)ABOS_MATERIALIZED_BYTES=(\d+)(?:\n|$)/.exec(
      output,
    );
  const hashMatch =
    /(?:^|\n)ABOS_MATERIALIZED_SHA256=([0-9a-fA-F]{64})(?:\n|$)/.exec(
      output,
    );
  if (!bytesMatch || !hashMatch) return null;

  const bytes = Number(bytesMatch[1]);
  if (!Number.isSafeInteger(bytes) || bytes < 0) {
    return null;
  }

  return {
    bytes,
    sha256: hashMatch[1].toLowerCase(),
  };
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}
