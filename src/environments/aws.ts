import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import type {
  CommandResult,
  EnvironmentCollectionResult,
  EnvironmentCommandRunner,
  EnvironmentEstimate,
  EnvironmentHealthResult,
  EnvironmentMutationResult,
  EnvironmentPreparationResult,
  EnvironmentProvider,
  EnvironmentProvisionRequest,
  EnvironmentProvisionResult,
  EnvironmentReconcileResult,
  EnvironmentRequirements,
  EnvironmentResource,
  EnvironmentResourceStatus,
  EnvironmentSatisfaction,
  EnvironmentSnapshot,
} from "./types.js";

const DEFAULT_COMMAND_TIMEOUT_MS = 120_000;
const DEFAULT_INSTANCE_TYPE = "t3.micro";
const DEFAULT_MANAGED_TAG_KEY = "abos:managed";
const DEFAULT_MANAGED_TAG_VALUE = "true";
const DEFAULT_ABOS_REPOSITORY = "https://github.com/hopetmpy/ABOS.git";
const DEFAULT_ABOS_REF = "main";
const DEFAULT_ABOS_INSTALL_ROOT = "/opt/abos";

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

export interface AwsEnvironmentProviderOptions {
  runner?: EnvironmentCommandRunner;
  defaultRegion?: string;
  defaultInstanceType?: string;
  defaultArchitecture?: "x86_64" | "arm64";
  defaultImageId?: string;
  defaultIamInstanceProfile?: string;
  managedTagKey?: string;
  managedTagValue?: string;
  commandTimeoutMs?: number;
  ssmReadyAttempts?: number;
  ssmReadyIntervalMs?: number;
}

interface AwsEc2Observation {
  InstanceId?: string;
  State?: { Name?: string };
  PrivateIpAddress?: string;
  PublicIpAddress?: string;
  InstanceType?: string;
  ImageId?: string;
  LaunchTime?: string;
  SubnetId?: string;
  VpcId?: string;
  Architecture?: string;
  Placement?: { AvailabilityZone?: string };
  Tags?: Array<{ Key?: string; Value?: string }>;
}

interface AwsSsmInvocation {
  CommandId?: string;
  Status?: string;
  StandardOutputContent?: string;
  StandardErrorContent?: string;
  ResponseCode?: number;
}

interface AwsSsmInstanceInfo {
  PingStatus?: string;
  PlatformType?: string;
  AgentVersion?: string;
}

export class AwsEnvironmentProvider implements EnvironmentProvider {
  readonly id = "aws";

  private readonly runner: EnvironmentCommandRunner;
  private readonly options: AwsEnvironmentProviderOptions;

  constructor(input: EnvironmentCommandRunner | AwsEnvironmentProviderOptions = {}) {
    if (typeof input === "function") {
      this.runner = input;
      this.options = {};
    } else {
      this.options = input;
      this.runner = input.runner ?? defaultRunner;
    }
  }

  getConfiguredIamInstanceProfile(
    metadata?: Record<string, unknown>,
  ): string | null {
    return metadataString(metadata, "iamInstanceProfile") ??
      this.options.defaultIamInstanceProfile ??
      process.env.ABOS_AWS_EC2_INSTANCE_PROFILE ??
      null;
  }

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

    const callerIdentity = parseJson<Record<string, unknown>>(identity.stdout) ?? {
      raw: identity.stdout.trim(),
    };
    const region = await this.resolveRegion();

    return {
      id: this.id,
      label: "Amazon Web Services",
      availability: "available",
      capabilities: this.capabilities(true),
      evidence: [
        version.stdout || version.stderr,
        "AWS STS caller identity verified.",
        ...(region ? [`AWS region resolved as ${region}.`] : [
          "AWS region is not pinned by ABOS; provider/default CLI resolution will be used when an operation requires one.",
        ]),
      ].filter(Boolean),
      costModel: "AWS account billing",
      constraints: [],
      metadata: { callerIdentity, region },
      observedAt: new Date().toISOString(),
    };
  }

  async canSatisfy(
    requirements: EnvironmentRequirements,
    snapshot?: EnvironmentSnapshot,
  ): Promise<EnvironmentSatisfaction> {
    const observed = snapshot ?? await this.inspect();
    const required = requirements.requiredCapabilities
      .map(normalize)
      .filter(Boolean);

    const missing = required.filter((requirement) =>
      !observed.capabilities.some((capability) => {
        if (!capability.available) return false;
        const text = normalize([
          capability.id,
          capability.type,
          capability.provider,
          capability.description,
          ...capability.requirements,
        ].join(" "));
        return capabilityMatches(text, requirement);
      })
    );

    const unavailable = observed.availability === "unavailable";
    const unauthorized = observed.availability === "requires_authorization";

    return {
      satisfiable: unavailable || unauthorized
        ? false
        : missing.length === 0,
      capabilityFit: required.length === 0
        ? 1
        : (required.length - missing.length) / required.length,
      missingCapabilities: missing,
      constraints: observed.constraints,
      evidence: [
        ...observed.evidence,
        `aws capability fit=${required.length - missing.length}/${required.length}`,
      ],
      metadata: {
        region:
          requirements.region ??
          observed.metadata?.region ??
          null,
      },
    };
  }

  async estimate(
    requirements: EnvironmentRequirements,
  ): Promise<EnvironmentEstimate> {
    const region = requirements.region ?? await this.resolveRegion();
    const instanceType =
      metadataString(requirements.metadata, "instanceType") ??
      this.options.defaultInstanceType ??
      process.env.ABOS_AWS_EC2_INSTANCE_TYPE ??
      DEFAULT_INSTANCE_TYPE;

    const evidence: string[] = [];
    const metadata: Record<string, unknown> = {
      instanceType,
      region,
    };

    let reusableResourceCount: number | null = null;
    try {
      const reusable = await this.listReusableInstanceIds(region);
      reusableResourceCount = reusable.length;
      metadata.reusableInstanceIds = reusable;
      evidence.push(`AWS reusable managed EC2 instances observed=${reusable.length}.`);
    } catch (error) {
      evidence.push(
        `AWS reusable EC2 inventory unavailable: ${errorMessage(error)}`,
      );
    }

    let hourlyCostCents = positiveNumber(
      requirements.metadata?.hourlyCostCents,
    );
    if (hourlyCostCents == null) {
      try {
        hourlyCostCents = await this.lookupLinuxOnDemandHourlyCostCents(
          instanceType,
          region,
        );
      } catch (error) {
        evidence.push(
          `AWS Pricing lookup unavailable: ${errorMessage(error)}`,
        );
      }
    } else {
      evidence.push(
        `Using caller-supplied hourly cost evidence=${hourlyCostCents} cents/hour.`,
      );
    }

    if (hourlyCostCents != null) {
      metadata.hourlyCostCents = hourlyCostCents;
      metadata.pricingScope = "EC2 Linux On-Demand compute only; excludes storage, network, public IPv4, taxes, discounts, credits, and other AWS charges.";
    }

    let estimatedCostCents: number | null = null;
    if (
      hourlyCostCents != null &&
      requirements.expectedDurationMs != null &&
      requirements.expectedDurationMs >= 0
    ) {
      estimatedCostCents = Math.ceil(
        hourlyCostCents * (requirements.expectedDurationMs / 3_600_000),
      );
      evidence.push(
        `AWS EC2 compute-only estimated task cost=${estimatedCostCents} cents for expectedDurationMs=${requirements.expectedDurationMs}; full AWS invoice cost remains unknown until billing evidence is available.`,
      );
    } else {
      evidence.push(
        "AWS EC2 task cost remains unknown because duration or pricing evidence is incomplete.",
      );
    }

    return {
      estimatedCostCents,
      costCoverage: estimatedCostCents == null ? "unknown" : "partial",
      reusableResourceCount,
      evidence,
      metadata,
    };
  }

  async prepare(
    requirements: EnvironmentRequirements,
  ): Promise<EnvironmentPreparationResult> {
    const snapshot = await this.inspect();
    const region =
      requirements.region ??
      (typeof snapshot.metadata?.region === "string"
        ? snapshot.metadata.region
        : null);

    return {
      ready: snapshot.availability === "available",
      evidence: [
        ...snapshot.evidence,
        ...(region
          ? [`AWS operations will target region=${region} unless explicitly overridden.`]
          : [
              "No ABOS-specific AWS region is pinned. AWS CLI/provider defaults remain available to resolve region at execution time.",
            ]),
      ],
      metadata: {
        ...snapshot.metadata,
        region,
      },
    };
  }

  async provision(
    request: EnvironmentProvisionRequest,
  ): Promise<EnvironmentProvisionResult> {
    if (!isEc2ResourceRequest(request)) {
      throw new Error(
        `AWS provider does not currently expose generic lifecycle provisioning for resourceType="${request.resourceType}". EC2 is implemented; other AWS services remain discoverable capabilities, not impossible objectives.`,
      );
    }

    const region =
      request.region ??
      metadataString(request.metadata, "region") ??
      await this.resolveRegion();
    const instanceType =
      metadataString(request.metadata, "instanceType") ??
      this.options.defaultInstanceType ??
      process.env.ABOS_AWS_EC2_INSTANCE_TYPE ??
      DEFAULT_INSTANCE_TYPE;
    const architecture =
      metadataArchitecture(request.metadata?.architecture) ??
      this.options.defaultArchitecture ??
      "x86_64";
    const imageId =
      metadataString(request.metadata, "imageId") ??
      this.options.defaultImageId ??
      process.env.ABOS_AWS_EC2_IMAGE_ID ??
      await this.resolveAmazonLinuxImage(region, architecture);
    const iamInstanceProfile =
      this.getConfiguredIamInstanceProfile(request.metadata);

    const args = [
      "ec2",
      "run-instances",
      "--image-id",
      imageId,
      "--instance-type",
      instanceType,
      "--min-count",
      "1",
      "--max-count",
      "1",
      "--client-token",
      ec2ClientToken(request.resourceId),
      "--tag-specifications",
      JSON.stringify([
        {
          ResourceType: "instance",
          Tags: buildTags(request, {
            managedTagKey:
              this.options.managedTagKey ?? DEFAULT_MANAGED_TAG_KEY,
            managedTagValue:
              this.options.managedTagValue ?? DEFAULT_MANAGED_TAG_VALUE,
          }),
        },
      ]),
    ];

    const subnetId = metadataString(request.metadata, "subnetId");
    if (subnetId) {
      args.push("--subnet-id", subnetId);
    }

    const securityGroupIds = metadataStringArray(
      request.metadata?.securityGroupIds,
    );
    if (securityGroupIds.length > 0) {
      args.push("--security-group-ids", ...securityGroupIds);
    }

    if (iamInstanceProfile) {
      args.push(
        "--iam-instance-profile",
        iamInstanceProfile.startsWith("arn:")
          ? `Arn=${iamInstanceProfile}`
          : `Name=${iamInstanceProfile}`,
      );
    }

    const keyName = metadataString(request.metadata, "keyName");
    if (keyName) {
      args.push("--key-name", keyName);
    }

    const userData = metadataString(request.metadata, "userData");
    if (userData) {
      args.push("--user-data", userData);
    }

    const shutdownBehavior = metadataString(
      request.metadata,
      "instanceInitiatedShutdownBehavior",
    );
    if (shutdownBehavior === "stop" || shutdownBehavior === "terminate") {
      args.push(
        "--instance-initiated-shutdown-behavior",
        shutdownBehavior,
      );
    }

    args.push(
      "--query",
      "Instances[0].{InstanceId:InstanceId,State:State.Name,PrivateIpAddress:PrivateIpAddress,PublicIpAddress:PublicIpAddress,InstanceType:InstanceType,ImageId:ImageId,LaunchTime:LaunchTime,SubnetId:SubnetId,VpcId:VpcId,Architecture:Architecture,Placement:Placement}",
      "--output",
      "json",
      ...regionArgs(region),
    );

    const created = await this.runAws(args);
    requireAwsSuccess(created, "EC2 run-instances");
    const initial = parseJson<AwsEc2Observation>(created.stdout);
    const instanceId = initial?.InstanceId;
    if (!instanceId) {
      throw new Error(
        "AWS EC2 run-instances succeeded but returned no InstanceId.",
      );
    }

    const waited = await this.runAws([
      "ec2",
      "wait",
      "instance-running",
      "--instance-ids",
      instanceId,
      ...regionArgs(region),
    ], this.commandTimeoutMs());
    requireAwsSuccess(waited, `EC2 wait instance-running ${instanceId}`);

    const observed = await this.describeInstance(instanceId, region);
    const instance = observed.instance ?? initial;
    const providerState = instance.State?.Name ?? "running";

    return {
      externalId: instanceId,
      type: "aws-ec2-instance",
      status: providerState === "running" ? "ready" : mapEc2State(providerState),
      region,
      capabilities: [
        "remote compute",
        "virtual machine",
        "ec2",
        "linux",
      ],
      estimatedCostCents: request.selectionEstimateCents ?? null,
      credentialsReference: iamInstanceProfile
        ? `iam-instance-profile:${iamInstanceProfile}`
        : "aws:default-credential-chain",
      providerState,
      evidence: [
        `AWS EC2 instance ${instanceId} created.`,
        `EC2 state=${providerState} instanceType=${instance.InstanceType ?? instanceType} imageId=${instance.ImageId ?? imageId}.`,
        ...(iamInstanceProfile
          ? [`IAM instance profile attached: ${iamInstanceProfile}.`]
          : [
              "No EC2 IAM instance profile was configured. Generic EC2 execution exists, but SSM bootstrap/dispatch may remain unavailable until authorization changes.",
            ]),
      ],
      metadata: {
        instanceId,
        instanceType: instance.InstanceType ?? instanceType,
        imageId: instance.ImageId ?? imageId,
        architecture: instance.Architecture ?? architecture,
        privateIpAddress: instance.PrivateIpAddress ?? null,
        publicIpAddress: instance.PublicIpAddress ?? null,
        subnetId: instance.SubnetId ?? subnetId ?? null,
        vpcId: instance.VpcId ?? null,
        availabilityZone: instance.Placement?.AvailabilityZone ?? null,
        iamInstanceProfile,
        executorKind: request.metadata?.executorKind ?? null,
        hourlyCostCents: positiveNumber(request.metadata?.hourlyCostCents),
        accruedComputeEstimateCents: 0,
        billingStartedAt: instance.LaunchTime ?? new Date().toISOString(),
        costEstimateScope: "EC2 compute only; actual AWS billed cost is not claimed.",
      },
    };
  }

  async bootstrap(
    resource: EnvironmentResource,
    requirements: EnvironmentRequirements,
  ): Promise<EnvironmentMutationResult> {
    const instanceId = requireInstanceId(resource);
    const region =
      requirements.region ??
      resource.region ??
      metadataString(requirements.metadata, "region") ??
      await this.resolveRegion();

    let commands = metadataStringArray(requirements.metadata?.bootstrapCommands);
    if (commands.length === 0) {
      commands = metadataStringArray(resource.metadata.bootstrapCommands);
    }
    if (commands.length === 0) {
      commands = buildDefaultAbosBootstrapCommands(requirements.metadata);
    }
    if (commands.length === 0) {
      throw new Error(
        "AWS EC2 bootstrap has no commands or ABOS genesis payload. Bootstrap capability is available, but no authorized bootstrap plan was supplied.",
      );
    }

    await this.waitForSsmOnline(instanceId, region);

    const invocation = await this.runSsmCommands(
      instanceId,
      commands,
      region,
      Math.max(
        this.commandTimeoutMs(),
        requirements.expectedDurationMs ?? 0,
      ),
    );

    if (invocation.Status !== "Success") {
      throw new Error(
        `AWS SSM bootstrap failed for ${instanceId}: status=${invocation.Status ?? "unknown"} responseCode=${invocation.ResponseCode ?? "unknown"} stderr=${(invocation.StandardErrorContent ?? "").slice(0, 500)}`,
      );
    }

    return {
      status: "running",
      providerState: "ssm:Success",
      evidence: [
        `AWS SSM bootstrap completed for EC2 instance ${instanceId}.`,
        ...(invocation.StandardOutputContent
          ? [`bootstrap stdout: ${invocation.StandardOutputContent.slice(0, 1000)}`]
          : []),
      ],
      metadata: {
        ssmCommandId: invocation.CommandId ?? null,
        ssmStatus: invocation.Status ?? null,
        bootstrapCompletedAt: new Date().toISOString(),
      },
    };
  }

  async execute(args: string[], timeoutMs = this.commandTimeoutMs()): Promise<CommandResult> {
    return this.runner("aws", args, timeoutMs);
  }

  async health(resource: EnvironmentResource): Promise<EnvironmentHealthResult> {
    const instanceId = requireInstanceId(resource);
    const observed = await this.describeInstance(
      instanceId,
      resource.region ?? await this.resolveRegion(),
    );

    if (!observed.instance) {
      return {
        healthy: false,
        status: resource.status === "terminating" || resource.status === "terminated"
          ? "terminated"
          : "unknown",
        providerState: "not_observed",
        evidence: [
          `AWS EC2 instance ${instanceId} was not observed by DescribeInstances.`,
          ...observed.evidence,
        ],
      };
    }

    const state = observed.instance.State?.Name ?? "unknown";
    const requiresSsm =
      resource.metadata.executorKind === "aws-ec2-ssm" ||
      resource.metadata.ssmRequired === true;
    let ssm: AwsSsmInstanceInfo | null = null;
    const evidence = [
      `AWS EC2 instance ${instanceId} state=${state}.`,
      ...observed.evidence,
    ];

    if (state === "running") {
      try {
        ssm = await this.describeSsmInstance(
          instanceId,
          resource.region ?? await this.resolveRegion(),
        );
        evidence.push(
          ssm
            ? `AWS SSM PingStatus=${ssm.PingStatus ?? "unknown"}.`
            : "AWS SSM inventory did not return the instance.",
        );
      } catch (error) {
        evidence.push(`AWS SSM health observation unavailable: ${errorMessage(error)}`);
      }
    }

    const ec2Status = mapEc2State(state);
    const healthy =
      state === "running"
        ? requiresSsm
          ? ssm?.PingStatus === "Online"
          : true
        : state === "pending"
          ? null
          : false;

    const cost = observeComputeEstimate(resource, state, new Date());
    if (cost.evidence) evidence.push(cost.evidence);

    return {
      healthy,
      status:
        healthy === false && state === "running"
          ? "degraded"
          : ec2Status,
      providerState: state,
      evidence,
      metadata: {
        ...observationMetadata(observed.instance),
        ...cost.metadata,
        ssmPingStatus: ssm?.PingStatus ?? null,
        ssmAgentVersion: ssm?.AgentVersion ?? null,
        ssmPlatformType: ssm?.PlatformType ?? null,
      },
    };
  }

  async collect(resource: EnvironmentResource): Promise<EnvironmentCollectionResult> {
    const instanceId = requireInstanceId(resource);
    const observed = await this.describeInstance(
      instanceId,
      resource.region ?? await this.resolveRegion(),
    );

    return {
      artifacts: [],
      evidence: observed.instance
        ? [
            `Collected AWS EC2 control-plane observation for ${instanceId}.`,
            `state=${observed.instance.State?.Name ?? "unknown"} privateIp=${observed.instance.PrivateIpAddress ?? "unknown"} publicIp=${observed.instance.PublicIpAddress ?? "unknown"}.`,
          ]
        : [
            `AWS EC2 instance ${instanceId} is not currently observable; no artifact inventory was fabricated.`,
            ...observed.evidence,
          ],
      metadata: observed.instance
        ? observationMetadata(observed.instance)
        : {},
    };
  }

  async resize(
    resource: EnvironmentResource,
    changes: Record<string, unknown>,
  ): Promise<EnvironmentMutationResult> {
    const instanceId = requireInstanceId(resource);
    const region = resource.region ?? await this.resolveRegion();
    const instanceType = typeof changes.instanceType === "string" &&
      changes.instanceType.trim()
      ? changes.instanceType.trim()
      : null;

    if (!instanceType) {
      throw new Error(
        "AWS EC2 resize currently requires changes.instanceType. Other resize dimensions remain undiscovered/unimplemented rather than being treated as impossible.",
      );
    }

    const before = await this.describeInstance(instanceId, region);
    if (!before.instance) {
      throw new Error(`Cannot resize unobserved EC2 instance ${instanceId}.`);
    }

    const wasRunning = before.instance.State?.Name === "running";
    if (wasRunning) {
      await this.stopInstance(instanceId, region);
    }

    const modified = await this.runAws([
      "ec2",
      "modify-instance-attribute",
      "--instance-id",
      instanceId,
      "--instance-type",
      JSON.stringify({ Value: instanceType }),
      ...regionArgs(region),
    ]);
    requireAwsSuccess(modified, `EC2 modify-instance-attribute ${instanceId}`);

    if (wasRunning) {
      await this.startInstance(instanceId, region);
    }

    const cost = observeComputeEstimate(resource, "stopped", new Date());
    return {
      status: wasRunning ? "running" : "suspended",
      providerState: wasRunning ? "running" : "stopped",
      evidence: [
        `AWS EC2 instance ${instanceId} resized to instanceType=${instanceType}.`,
        `Previous running state preserved=${wasRunning}.`,
        ...(cost.evidence ? [cost.evidence] : []),
      ],
      metadata: {
        instanceType,
        ...cost.metadata,
        billingStartedAt: wasRunning ? new Date().toISOString() : null,
      },
    };
  }

  async suspend(resource: EnvironmentResource): Promise<EnvironmentMutationResult> {
    const instanceId = requireInstanceId(resource);
    const region = resource.region ?? await this.resolveRegion();
    await this.stopInstance(instanceId, region);
    const cost = observeComputeEstimate(resource, "stopped", new Date());
    return {
      status: "suspended",
      providerState: "stopped",
      evidence: [
        `AWS EC2 instance ${instanceId} stopped.`,
        ...(cost.evidence ? [cost.evidence] : []),
      ],
      metadata: {
        ...cost.metadata,
        billingStartedAt: null,
      },
    };
  }

  async resume(resource: EnvironmentResource): Promise<EnvironmentMutationResult> {
    const instanceId = requireInstanceId(resource);
    const region = resource.region ?? await this.resolveRegion();
    await this.startInstance(instanceId, region);
    return {
      status: "running",
      providerState: "running",
      evidence: [`AWS EC2 instance ${instanceId} started; compute-cost estimation clock resumed.`],
      metadata: {
        billingStartedAt: new Date().toISOString(),
      },
    };
  }

  async destroy(resource: EnvironmentResource): Promise<EnvironmentMutationResult> {
    const instanceId = requireInstanceId(resource);
    const region = resource.region ?? await this.resolveRegion();

    const terminated = await this.runAws([
      "ec2",
      "terminate-instances",
      "--instance-ids",
      instanceId,
      "--output",
      "json",
      ...regionArgs(region),
    ]);
    requireAwsSuccess(terminated, `EC2 terminate-instances ${instanceId}`);

    const waited = await this.runAws([
      "ec2",
      "wait",
      "instance-terminated",
      "--instance-ids",
      instanceId,
      ...regionArgs(region),
    ], this.commandTimeoutMs());
    requireAwsSuccess(waited, `EC2 wait instance-terminated ${instanceId}`);

    const cost = observeComputeEstimate(resource, "terminated", new Date());
    return {
      status: "terminated",
      providerState: "terminated",
      evidence: [
        `AWS EC2 instance ${instanceId} terminated and waiter confirmed termination.`,
        ...(cost.evidence ? [cost.evidence] : []),
      ],
      metadata: {
        ...cost.metadata,
        billingStartedAt: null,
      },
    };
  }

  async recover(resource: EnvironmentResource): Promise<EnvironmentMutationResult> {
    const instanceId = requireInstanceId(resource);
    const region = resource.region ?? await this.resolveRegion();
    const observed = await this.describeInstance(instanceId, region);
    if (!observed.instance) {
      return {
        status: "unknown",
        providerState: "not_observed",
        evidence: [
          `AWS EC2 recovery cannot currently observe ${instanceId}; state remains UNKNOWN.`,
          ...observed.evidence,
        ],
      };
    }

    const state = observed.instance.State?.Name ?? "unknown";
    if (state === "stopped") {
      await this.startInstance(instanceId, region);
      return {
        status: "running",
        providerState: "running",
        evidence: [`AWS EC2 recovery restarted stopped instance ${instanceId}.`],
      };
    }

    if (state === "running") {
      return {
        status: "running",
        providerState: state,
        evidence: [`AWS EC2 recovery observed ${instanceId} already running; no mutation was required.`],
      };
    }

    return {
      status: mapEc2State(state),
      providerState: state,
      evidence: [
        `AWS EC2 recovery observed state=${state}; no destructive guess or blind recreate was performed.`,
      ],
    };
  }

  async reconcile(resource: EnvironmentResource): Promise<EnvironmentReconcileResult> {
    const region = resource.region ?? await this.resolveRegion();
    let instanceId = resource.externalId ??
      (typeof resource.metadata.instanceId === "string"
        ? resource.metadata.instanceId
        : null);

    if (!instanceId) {
      const discovered = await this.findInstancesByResourceId(resource.id, region);
      if (discovered.length === 1 && discovered[0].InstanceId) {
        instanceId = discovered[0].InstanceId;
        const state = discovered[0].State?.Name ?? "unknown";
        return {
          resource: {
            ...resource,
            externalId: instanceId,
            status: mapEc2State(state),
            providerState: state,
            region: region ?? resource.region,
            metadata: {
              ...resource.metadata,
              ...observationMetadata(discovered[0]),
              reconciledByResourceTag: true,
            },
            updatedAt: new Date().toISOString(),
          },
          actualExists: true,
          action: "adopt_by_resource_tag",
          evidence: [
            `Recovered AWS EC2 instance ${instanceId} from ownership tag abos:resource-id=${resource.id} after external id was not persisted.`,
          ],
        };
      }

      if (discovered.length > 1) {
        return {
          resource: {
            ...resource,
            status: "unknown",
            providerState: "ambiguous_resource_tag",
            updatedAt: new Date().toISOString(),
          },
          actualExists: null,
          action: "mark_unknown_ambiguous_ownership",
          evidence: [
            `Multiple AWS EC2 instances claim ownership tag abos:resource-id=${resource.id}: ${discovered.map((entry) => entry.InstanceId ?? "unknown").join(", ")}. ABOS will not guess which resource is authoritative.`,
          ],
        };
      }

      return {
        resource: {
          ...resource,
          status: "unknown",
          providerState: "not_observed_by_resource_tag",
          updatedAt: new Date().toISOString(),
        },
        actualExists: false,
        action: "mark_unknown_unresolved_provision",
        evidence: [
          `No AWS EC2 instance was found for ownership tag abos:resource-id=${resource.id}. ABOS will not blindly recreate it during reconciliation.`,
        ],
      };
    }

    const observed = await this.describeInstance(instanceId, region);

    if (!observed.instance) {
      const terminated =
        resource.status === "terminating" ||
        resource.status === "terminated";
      return {
        resource: {
          ...resource,
          status: terminated ? "terminated" : "unknown",
          providerState: "not_observed",
          updatedAt: new Date().toISOString(),
        },
        actualExists: false,
        action: terminated ? "confirm_absent_after_termination" : "mark_unknown",
        evidence: [
          `AWS EC2 instance ${instanceId} was not returned by DescribeInstances.`,
          ...(terminated
            ? ["Prior ABOS state was terminating/terminated, so absence is consistent with completed destruction."]
            : ["Absence alone is not used to invent a replacement or claim objective impossibility."]),
          ...observed.evidence,
        ],
      };
    }

    const state = observed.instance.State?.Name ?? "unknown";
    return {
      resource: {
        ...resource,
        status: mapEc2State(state),
        providerState: state,
        region: region ?? resource.region,
        metadata: {
          ...resource.metadata,
          ...observationMetadata(observed.instance),
        },
        updatedAt: new Date().toISOString(),
      },
      actualExists: true,
      action: "refresh_from_ec2",
      evidence: [
        `AWS EC2 resource ${instanceId} reconciled from provider state=${state}.`,
      ],
    };
  }

  async runSsmCommands(
    instanceId: string,
    commands: string[],
    region?: string | null,
    timeoutMs = this.commandTimeoutMs(),
  ): Promise<AwsSsmInvocation> {
    if (commands.length === 0) {
      throw new Error("AWS SSM command list cannot be empty.");
    }

    const sent = await this.runAws([
      "ssm",
      "send-command",
      "--instance-ids",
      instanceId,
      "--document-name",
      "AWS-RunShellScript",
      "--comment",
      "ABOS environment lifecycle execution",
      "--parameters",
      JSON.stringify({ commands }),
      "--output",
      "json",
      ...regionArgs(region),
    ], timeoutMs);
    requireAwsSuccess(sent, `SSM send-command ${instanceId}`);

    const commandId = parseJson<{ Command?: { CommandId?: string } }>(
      sent.stdout,
    )?.Command?.CommandId;
    if (!commandId) {
      throw new Error(
        `AWS SSM send-command succeeded for ${instanceId} but returned no CommandId.`,
      );
    }

    const waited = await this.runAws([
      "ssm",
      "wait",
      "command-executed",
      "--command-id",
      commandId,
      "--instance-id",
      instanceId,
      ...regionArgs(region),
    ], timeoutMs);

    const invocationResult = await this.runAws([
      "ssm",
      "get-command-invocation",
      "--command-id",
      commandId,
      "--instance-id",
      instanceId,
      "--output",
      "json",
      ...regionArgs(region),
    ], timeoutMs);
    requireAwsSuccess(
      invocationResult,
      `SSM get-command-invocation ${commandId}`,
    );

    const invocation =
      parseJson<AwsSsmInvocation>(invocationResult.stdout) ?? {};
    invocation.CommandId = invocation.CommandId ?? commandId;

    if (waited.exitCode !== 0 && invocation.Status === "Success") {
      return invocation;
    }

    if (waited.exitCode !== 0 && !invocation.Status) {
      throw new Error(
        `AWS SSM command waiter failed for ${commandId}: ${waited.stderr || waited.stdout}`,
      );
    }

    return invocation;
  }

  private async runAws(
    args: string[],
    timeoutMs = this.commandTimeoutMs(),
  ): Promise<CommandResult> {
    return this.runner("aws", args, timeoutMs);
  }

  private commandTimeoutMs(): number {
    return positiveNumber(this.options.commandTimeoutMs) ??
      DEFAULT_COMMAND_TIMEOUT_MS;
  }

  private async resolveRegion(): Promise<string | null> {
    const configured =
      this.options.defaultRegion ??
      process.env.AWS_REGION ??
      process.env.AWS_DEFAULT_REGION ??
      null;
    if (configured?.trim()) {
      return configured.trim();
    }

    const result = await this.runner(
      "aws",
      ["configure", "get", "region"],
      5_000,
    );
    if (result.exitCode === 0 && result.stdout.trim()) {
      return result.stdout.trim();
    }
    return null;
  }

  private async resolveAmazonLinuxImage(
    region: string | null,
    architecture: "x86_64" | "arm64",
  ): Promise<string> {
    const parameter = architecture === "arm64"
      ? "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64"
      : "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64";

    const result = await this.runAws([
      "ssm",
      "get-parameter",
      "--name",
      parameter,
      "--query",
      "Parameter.Value",
      "--output",
      "text",
      ...regionArgs(region),
    ]);
    requireAwsSuccess(result, `SSM get-parameter ${parameter}`);

    const imageId = result.stdout.trim();
    if (!imageId) {
      throw new Error(
        `AWS public AMI parameter ${parameter} returned an empty image id.`,
      );
    }
    return imageId;
  }

  private async listReusableInstanceIds(
    region: string | null,
  ): Promise<string[]> {
    const result = await this.runAws([
      "ec2",
      "describe-instances",
      "--filters",
      `Name=tag:${this.options.managedTagKey ?? DEFAULT_MANAGED_TAG_KEY},Values=${this.options.managedTagValue ?? DEFAULT_MANAGED_TAG_VALUE}`,
      "Name=instance-state-name,Values=pending,running,stopping,stopped",
      "--query",
      "Reservations[].Instances[].InstanceId",
      "--output",
      "json",
      ...regionArgs(region),
    ]);
    requireAwsSuccess(result, "EC2 describe-instances reusable inventory");
    const parsed = parseJson<unknown>(result.stdout);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  }

  private async lookupLinuxOnDemandHourlyCostCents(
    instanceType: string,
    region: string | null,
  ): Promise<number | null> {
    if (!region) {
      return null;
    }

    const result = await this.runAws([
      "pricing",
      "get-products",
      "--region",
      "us-east-1",
      "--service-code",
      "AmazonEC2",
      "--filters",
      `Type=TERM_MATCH,Field=instanceType,Value=${instanceType}`,
      "Type=TERM_MATCH,Field=operatingSystem,Value=Linux",
      "Type=TERM_MATCH,Field=tenancy,Value=Shared",
      "Type=TERM_MATCH,Field=preInstalledSw,Value=NA",
      "Type=TERM_MATCH,Field=capacitystatus,Value=Used",
      `Type=TERM_MATCH,Field=regionCode,Value=${region}`,
      "--max-results",
      "20",
      "--output",
      "json",
    ]);
    requireAwsSuccess(result, `Pricing get-products ${instanceType} ${region}`);

    const payload = parseJson<{ PriceList?: unknown[] }>(result.stdout);
    const usd = extractLowestOnDemandUsd(payload?.PriceList ?? []);
    if (usd == null) {
      return null;
    }
    return Number((usd * 100).toFixed(6));
  }

  private async findInstancesByResourceId(
    resourceId: string,
    region: string | null,
  ): Promise<AwsEc2Observation[]> {
    const result = await this.runAws([
      "ec2",
      "describe-instances",
      "--filters",
      `Name=tag:abos:resource-id,Values=${resourceId}`,
      "Name=instance-state-name,Values=pending,running,stopping,stopped,shutting-down",
      "--query",
      "Reservations[].Instances[]",
      "--output",
      "json",
      ...regionArgs(region),
    ]);
    requireAwsSuccess(
      result,
      `EC2 describe-instances ownership tag ${resourceId}`,
    );
    const parsed = parseJson<unknown>(result.stdout);
    return Array.isArray(parsed)
      ? parsed.filter(
          (entry): entry is AwsEc2Observation =>
            !!entry && typeof entry === "object",
        )
      : [];
  }

  private async describeInstance(
    instanceId: string,
    region: string | null,
  ): Promise<{ instance: AwsEc2Observation | null; evidence: string[] }> {
    const result = await this.runAws([
      "ec2",
      "describe-instances",
      "--instance-ids",
      instanceId,
      "--query",
      "Reservations[0].Instances[0]",
      "--output",
      "json",
      ...regionArgs(region),
    ]);

    if (result.exitCode !== 0) {
      if (/InvalidInstanceID\.NotFound|does not exist/i.test(result.stderr)) {
        return {
          instance: null,
          evidence: [
            `EC2 provider reported instance ${instanceId} not found.`,
          ],
        };
      }
      throw new Error(
        `EC2 describe-instances ${instanceId} failed: ${result.stderr || result.stdout}`,
      );
    }

    const parsed = parseJson<AwsEc2Observation | null>(result.stdout);
    return {
      instance: parsed && typeof parsed === "object" ? parsed : null,
      evidence: [],
    };
  }

  private async waitForSsmOnline(
    instanceId: string,
    region: string | null,
  ): Promise<AwsSsmInstanceInfo> {
    const attempts = Math.max(
      1,
      Math.floor(this.options.ssmReadyAttempts ?? 20),
    );
    const intervalMs = Math.max(
      0,
      Math.floor(this.options.ssmReadyIntervalMs ?? 5_000),
    );
    let lastObservation = "not observed";

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const info = await this.describeSsmInstance(instanceId, region);
        if (info?.PingStatus === "Online") {
          return info;
        }
        lastObservation = info
          ? `PingStatus=${info.PingStatus ?? "unknown"}`
          : "instance absent from SSM inventory";
      } catch (error) {
        lastObservation = errorMessage(error);
      }

      if (attempt < attempts && intervalMs > 0) {
        await sleep(intervalMs);
      }
    }

    throw new Error(
      `AWS EC2 instance ${instanceId} did not become SSM Online after ${attempts} observation(s): ${lastObservation}`,
    );
  }

  private async describeSsmInstance(
    instanceId: string,
    region: string | null,
  ): Promise<AwsSsmInstanceInfo | null> {
    const result = await this.runAws([
      "ssm",
      "describe-instance-information",
      "--filters",
      `Key=InstanceIds,Values=${instanceId}`,
      "--query",
      "InstanceInformationList[0].{PingStatus:PingStatus,PlatformType:PlatformType,AgentVersion:AgentVersion}",
      "--output",
      "json",
      ...regionArgs(region),
    ]);
    requireAwsSuccess(
      result,
      `SSM describe-instance-information ${instanceId}`,
    );
    const parsed = parseJson<AwsSsmInstanceInfo | null>(result.stdout);
    return parsed && typeof parsed === "object" ? parsed : null;
  }

  private async stopInstance(
    instanceId: string,
    region: string | null,
  ): Promise<void> {
    const stopped = await this.runAws([
      "ec2",
      "stop-instances",
      "--instance-ids",
      instanceId,
      "--output",
      "json",
      ...regionArgs(region),
    ]);
    requireAwsSuccess(stopped, `EC2 stop-instances ${instanceId}`);

    const waited = await this.runAws([
      "ec2",
      "wait",
      "instance-stopped",
      "--instance-ids",
      instanceId,
      ...regionArgs(region),
    ], this.commandTimeoutMs());
    requireAwsSuccess(waited, `EC2 wait instance-stopped ${instanceId}`);
  }

  private async startInstance(
    instanceId: string,
    region: string | null,
  ): Promise<void> {
    const started = await this.runAws([
      "ec2",
      "start-instances",
      "--instance-ids",
      instanceId,
      "--output",
      "json",
      ...regionArgs(region),
    ]);
    requireAwsSuccess(started, `EC2 start-instances ${instanceId}`);

    const waited = await this.runAws([
      "ec2",
      "wait",
      "instance-running",
      "--instance-ids",
      instanceId,
      ...regionArgs(region),
    ], this.commandTimeoutMs());
    requireAwsSuccess(waited, `EC2 wait instance-running ${instanceId}`);
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
      capability("ec2", "Elastic virtual machine compute.", [
        "compute",
        "remote compute",
        "virtual machine",
        "linux",
        "ec2",
      ]),
      capability("ssm", "Managed remote command and instance control plane.", [
        "remote command",
        "systems manager",
        "ssm",
        "bootstrap",
      ]),
      capability("lambda", "Serverless function execution.", [
        "serverless",
        "function",
        "lambda",
      ]),
      capability("ecs", "Managed container execution.", [
        "container",
        "ecs",
      ]),
      capability("s3", "Object storage.", [
        "object storage",
        "s3",
        "storage",
      ]),
      capability("sqs", "Managed message queues.", [
        "queue",
        "messaging",
        "sqs",
      ]),
      capability("dynamodb", "Managed key-value/document database.", [
        "database",
        "dynamodb",
      ]),
      capability("rds", "Managed relational database.", [
        "relational database",
        "rds",
      ]),
    ];
  }
}

function isEc2ResourceRequest(request: EnvironmentProvisionRequest): boolean {
  const normalizedType = normalize(request.resourceType);
  const service = normalize(
    typeof request.metadata?.service === "string"
      ? request.metadata.service
      : "",
  );
  return service === "ec2" ||
    ["ec2", "ec2-instance", "aws-ec2", "aws-ec2-instance"].includes(
      normalizedType,
    );
}

function ec2ClientToken(resourceId: string): string {
  const digest = createHash("sha256")
    .update(resourceId, "utf8")
    .digest("hex")
    .slice(0, 48);
  return `abos-${digest}`;
}

function buildTags(
  request: EnvironmentProvisionRequest,
  managed: { managedTagKey: string; managedTagValue: string },
): Array<{ Key: string; Value: string }> {
  const tags = new Map<string, string>();
  tags.set(managed.managedTagKey, managed.managedTagValue);
  tags.set("abos:resource-id", request.resourceId);

  if (request.goalId) tags.set("abos:goal-id", request.goalId);
  if (request.pathId) tags.set("abos:path-id", request.pathId);
  if (request.taskId) tags.set("abos:task-id", request.taskId);

  const name =
    metadataString(request.metadata, "name") ??
    `abos-${request.resourceId.slice(-12).toLowerCase()}`;
  tags.set("Name", name);

  const custom = request.metadata?.tags;
  if (custom && typeof custom === "object" && !Array.isArray(custom)) {
    for (const [key, value] of Object.entries(custom)) {
      if (typeof value === "string" && key.trim()) {
        tags.set(key.trim(), value);
      }
    }
  }

  return [...tags.entries()].map(([Key, Value]) => ({ Key, Value }));
}

function buildDefaultAbosBootstrapCommands(
  metadata: Record<string, unknown> | undefined,
): string[] {
  const genesisBase64 =
    typeof metadata?.genesisBase64 === "string" &&
    metadata.genesisBase64.trim()
      ? metadata.genesisBase64.trim()
      : null;
  if (!genesisBase64) {
    return [];
  }

  const repository =
    metadataString(metadata, "repositoryUrl") ??
    DEFAULT_ABOS_REPOSITORY;
  const ref =
    metadataString(metadata, "repositoryRef") ??
    DEFAULT_ABOS_REF;
  const installRoot =
    metadataString(metadata, "installRoot") ??
    DEFAULT_ABOS_INSTALL_ROOT;

  const script = [
    "set -euo pipefail",
    "if ! command -v git >/dev/null 2>&1; then sudo dnf install -y git || sudo yum install -y git; fi",
    "if ! command -v curl >/dev/null 2>&1; then sudo dnf install -y curl || sudo yum install -y curl; fi",
    "NODE_MAJOR=\"$(node -p 'process.versions.node.split(\\\".\\\")[0]' 2>/dev/null || true)\"",
    "if [ \"$NODE_MAJOR\" != \"22\" ]; then curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -; sudo dnf install -y nodejs || sudo yum install -y nodejs; fi",
    "node -e 'if (Number(process.versions.node.split(\".\")[0]) !== 22) { process.exit(22) }'",
    `if [ ! -d ${shellQuote(installRoot)}/.git ]; then sudo mkdir -p ${shellQuote(installRoot)}; sudo chown -R "$(id -u):$(id -g)" ${shellQuote(installRoot)}; git clone ${shellQuote(repository)} ${shellQuote(installRoot)}; fi`,
    `cd ${shellQuote(installRoot)}`,
    "git fetch --all --tags --prune",
    `git checkout --detach ${shellQuote(ref)}`,
    `test "$(git rev-parse HEAD)" = "$(git rev-parse ${shellQuote(ref)})"`,
    "if command -v corepack >/dev/null 2>&1; then corepack enable; corepack prepare pnpm@10.28.1 --activate; elif ! command -v pnpm >/dev/null 2>&1; then npm install -g pnpm@10.28.1; fi",
    "pnpm install --frozen-lockfile",
    "pnpm run build",
    "mkdir -p \"$HOME/.abos\"",
    `printf %s ${shellQuote(genesisBase64)} | base64 -d > "$HOME/.abos/genesis.json"`,
    "chmod 600 \"$HOME/.abos/genesis.json\"",
    "node dist/index.js --init",
  ].join("\n");

  return [script];
}

function observeComputeEstimate(
  resource: EnvironmentResource,
  providerState: string,
  observedAt: Date,
): {
  metadata: Record<string, unknown>;
  evidence?: string;
} {
  const hourlyCostCents = positiveNumber(resource.metadata.hourlyCostCents);
  const accumulated = positiveNumber(
    resource.metadata.accruedComputeEstimateCents,
  ) ?? 0;
  const startedAt = typeof resource.metadata.billingStartedAt === "string"
    ? Date.parse(resource.metadata.billingStartedAt)
    : Number.NaN;

  if (hourlyCostCents == null || !Number.isFinite(startedAt)) {
    return {
      metadata: {
        costEstimateObservedAt: observedAt.toISOString(),
        costEstimateScope: "EC2 compute only; rate or billing start is unknown, so no billed cost is fabricated.",
      },
    };
  }

  const elapsedMs = Math.max(0, observedAt.getTime() - startedAt);
  const additional = normalize(providerState) === "running" ||
    resource.metadata.billingStartedAt
    ? hourlyCostCents * (elapsedMs / 3_600_000)
    : 0;
  const total = Number((accumulated + additional).toFixed(6));
  const running = normalize(providerState) === "running";

  return {
    metadata: {
      hourlyCostCents,
      accruedComputeEstimateCents: total,
      billingStartedAt: running ? observedAt.toISOString() : null,
      costEstimateObservedAt: observedAt.toISOString(),
      costEstimateScope: "EC2 compute only; actual AWS billed cost is not claimed.",
    },
    evidence: `AWS EC2 compute-only accrued estimate=${total.toFixed(4)} cents at observed provider state=${providerState}; full billed cost remains UNKNOWN without billing evidence.`,
  };
}

function observationMetadata(
  instance: AwsEc2Observation,
): Record<string, unknown> {
  return {
    instanceId: instance.InstanceId ?? null,
    state: instance.State?.Name ?? null,
    privateIpAddress: instance.PrivateIpAddress ?? null,
    publicIpAddress: instance.PublicIpAddress ?? null,
    instanceType: instance.InstanceType ?? null,
    imageId: instance.ImageId ?? null,
    launchTime: instance.LaunchTime ?? null,
    subnetId: instance.SubnetId ?? null,
    vpcId: instance.VpcId ?? null,
    architecture: instance.Architecture ?? null,
    availabilityZone: instance.Placement?.AvailabilityZone ?? null,
  };
}

function requireInstanceId(resource: EnvironmentResource): string {
  const instanceId =
    resource.externalId ??
    (typeof resource.metadata.instanceId === "string"
      ? resource.metadata.instanceId
      : null);
  if (!instanceId) {
    throw new Error(
      `AWS EC2 resource ${resource.id} has no external instance id.`,
    );
  }
  return instanceId;
}

function mapEc2State(state: string): EnvironmentResourceStatus {
  switch (normalize(state)) {
    case "pending":
      return "provisioning";
    case "running":
      return "running";
    case "stopping":
    case "stopped":
      return "suspended";
    case "shutting-down":
    case "terminated":
      return "terminated";
    default:
      return "unknown";
  }
}

function regionArgs(region?: string | null): string[] {
  return region ? ["--region", region] : [];
}

function requireAwsSuccess(result: CommandResult, operation: string): void {
  if (result.exitCode === 0) return;
  throw new Error(
    `${operation} failed (exit=${result.exitCode}): ${result.stderr || result.stdout || "no provider output"}`,
  );
}

function parseJson<T>(value: string): T | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "null") return null;
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    return null;
  }
}

function metadataString(
  metadata: Record<string, unknown> | undefined,
  key: string,
): string | null {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim()
    ? value.trim()
    : null;
}

function metadataStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter(Boolean)
    : [];
}

function metadataArchitecture(
  value: unknown,
): "x86_64" | "arm64" | null {
  return value === "x86_64" || value === "arm64" ? value : null;
}

function positiveNumber(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0
    ? value
    : null;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function capabilityMatches(haystack: string, requirement: string): boolean {
  if (!requirement) return true;
  if (haystack.includes(requirement)) return true;
  const terms = requirement
    .split(/[^a-z0-9]+/u)
    .filter((term) => term.length >= 3);
  return terms.length > 0 && terms.every((term) => haystack.includes(term));
}

function extractLowestOnDemandUsd(priceList: unknown[]): number | null {
  const prices: number[] = [];

  for (const raw of priceList) {
    const product =
      typeof raw === "string"
        ? parseJson<Record<string, unknown>>(raw)
        : raw && typeof raw === "object"
          ? raw as Record<string, unknown>
          : null;
    if (!product) continue;

    const terms = product.terms;
    if (!terms || typeof terms !== "object" || Array.isArray(terms)) continue;
    const onDemand = (terms as Record<string, unknown>).OnDemand;
    if (!onDemand || typeof onDemand !== "object" || Array.isArray(onDemand)) {
      continue;
    }

    for (const offer of Object.values(onDemand as Record<string, unknown>)) {
      if (!offer || typeof offer !== "object" || Array.isArray(offer)) continue;
      const dimensions = (offer as Record<string, unknown>).priceDimensions;
      if (
        !dimensions ||
        typeof dimensions !== "object" ||
        Array.isArray(dimensions)
      ) {
        continue;
      }

      for (const dimension of Object.values(
        dimensions as Record<string, unknown>,
      )) {
        if (
          !dimension ||
          typeof dimension !== "object" ||
          Array.isArray(dimension)
        ) {
          continue;
        }

        const pricePerUnit = (dimension as Record<string, unknown>).pricePerUnit;
        if (
          !pricePerUnit ||
          typeof pricePerUnit !== "object" ||
          Array.isArray(pricePerUnit)
        ) {
          continue;
        }

        const usd = (pricePerUnit as Record<string, unknown>).USD;
        const parsed = typeof usd === "string" ? Number(usd) : Number.NaN;
        if (Number.isFinite(parsed) && parsed >= 0) {
          prices.push(parsed);
        }
      }
    }
  }

  return prices.length > 0 ? Math.min(...prices) : null;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
