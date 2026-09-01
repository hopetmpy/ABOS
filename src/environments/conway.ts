import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { getHomeDir } from "../platform/home.js";
import type {
  EnvironmentCollectionResult,
  EnvironmentEstimate,
  EnvironmentHealthResult,
  EnvironmentPreparationResult,
  EnvironmentProvider,
  EnvironmentProvisionResult,
  EnvironmentReconcileResult,
  EnvironmentRequirements,
  EnvironmentSatisfaction,
  EnvironmentSnapshot,
} from "./types.js";

export interface ConwaySandboxProbeInfo {
  id: string;
  status: string;
  region: string;
  vcpu: number;
  memoryMb: number;
  diskGb: number;
  createdAt?: string;
}

export interface ConwayPricingProbeTier {
  name: string;
  vcpu: number;
  memoryMb: number;
  diskGb: number;
  monthlyCents: number;
}

export interface ConwaySandboxExecutionProbe {
  exec(
    command: string,
    timeout?: number,
  ): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
  }>;
}

export interface ConwayProbe {
  getCreditsBalance(): Promise<number>;
  getCreditsPricing?(): Promise<ConwayPricingProbeTier[]>;
  createSandbox?(options: {
    name?: string;
    vcpu?: number;
    memoryMb?: number;
    diskGb?: number;
    region?: string;
  }): Promise<ConwaySandboxProbeInfo>;
  listSandboxes?(): Promise<ConwaySandboxProbeInfo[]>;
  createScopedClient?(
    targetSandboxId: string,
  ): ConwaySandboxExecutionProbe;
}

export class ConwayEnvironmentProvider implements EnvironmentProvider {
  readonly id = "conway";
  readonly provision?: NonNullable<EnvironmentProvider["provision"]>;
  readonly health?: NonNullable<EnvironmentProvider["health"]>;
  readonly collect?: NonNullable<EnvironmentProvider["collect"]>;
  readonly reconcile?: NonNullable<EnvironmentProvider["reconcile"]>;

  constructor(private readonly conway: ConwayProbe) {
    if (conway.createSandbox) {
      this.provision = async (request) => this.provisionSandbox(request);
    }

    if (conway.listSandboxes) {
      this.health = async (resource) => this.healthSandbox(resource.externalId);
      this.reconcile = async (resource) => this.reconcileSandbox(resource);
    }

    if (conway.createScopedClient) {
      this.collect = async (resource) =>
        this.collectSandboxArtifacts(resource);
    }
  }

  async inspect(): Promise<EnvironmentSnapshot> {
    try {
      const creditsCents = await this.conway.getCreditsBalance();
      return {
        id: this.id,
        label: "Conway Cloud",
        availability: creditsCents > 0 ? "available" : "degraded",
        evidence: [`creditsCents=${creditsCents}`],
        costModel: "credit-metered",
        constraints: creditsCents <= 0 ? ["No Conway credits available."] : [],
        metadata: { creditsCents },
        observedAt: new Date().toISOString(),
        capabilities: [
          {
            id: "conway:sandbox",
            type: "cloud_resource",
            provider: "conway",
            description: "Provision and operate a remote Linux sandbox.",
            requirements: ["remote compute", "linux", "sandbox"],
            permissions: [],
            environment: "conway",
            available: creditsCents > 0,
          },
          {
            id: "conway:inference",
            type: "service",
            provider: "conway",
            description: "Remote model inference through Conway.",
            requirements: ["inference", "llm"],
            permissions: [],
            environment: "conway",
            available: creditsCents > 0,
          },
        ],
      };
    } catch (error) {
      return {
        id: this.id,
        label: "Conway Cloud",
        availability: "unavailable",
        capabilities: [],
        evidence: [error instanceof Error ? error.message : String(error)],
        costModel: "credit-metered",
        constraints: ["Conway API is currently unreachable or unauthorized."],
        observedAt: new Date().toISOString(),
      };
    }
  }

  async canSatisfy(
    requirements: EnvironmentRequirements,
    snapshot?: EnvironmentSnapshot,
  ): Promise<EnvironmentSatisfaction> {
    const observed = snapshot ?? await this.inspect();
    const required = requirements.requiredCapabilities
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean);

    const missing = required.filter((requirement) =>
      !observed.capabilities.some((capability) => {
        const text = [
          capability.id,
          capability.description,
          ...capability.requirements,
        ].join(" ").toLowerCase();
        return capability.available && text.includes(requirement);
      })
    );

    return {
      satisfiable:
        observed.availability === "unavailable"
          ? false
          : missing.length === 0,
      capabilityFit: required.length === 0
        ? 1
        : (required.length - missing.length) / required.length,
      missingCapabilities: missing,
      constraints: observed.constraints,
      evidence: [
        ...observed.evidence,
        `conway capability fit=${required.length - missing.length}/${required.length}`,
      ],
    };
  }

  async estimate(
    requirements: EnvironmentRequirements,
  ): Promise<EnvironmentEstimate> {
    const evidence: string[] = [];
    let estimatedCostCents: number | null = null;
    let reusableResourceCount: number | null = null;
    const metadata: Record<string, unknown> = {};

    if (this.conway.listSandboxes) {
      try {
        const sandboxes = await this.conway.listSandboxes();
        reusableResourceCount = sandboxes.filter((sandbox) =>
          sandbox.status.toLowerCase() === "running"
        ).length;
        metadata.runningSandboxes = reusableResourceCount;
      } catch (error) {
        evidence.push(
          `sandbox inventory unavailable: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    if (this.conway.getCreditsPricing) {
      try {
        const pricing = await this.conway.getCreditsPricing();
        const requested = requestedShape(requirements.metadata);
        const fitting = pricing
          .filter((tier) =>
            tier.vcpu >= requested.vcpu &&
            tier.memoryMb >= requested.memoryMb &&
            tier.diskGb >= requested.diskGb
          )
          .sort((a, b) => a.monthlyCents - b.monthlyCents);

        const tier = fitting[0] ?? null;
        if (tier) {
          metadata.pricingTier = tier;
          evidence.push(
            `cheapest fitting Conway tier=${tier.name} monthlyCents=${tier.monthlyCents}`,
          );

          if (
            requirements.expectedDurationMs != null &&
            requirements.expectedDurationMs >= 0
          ) {
            const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
            estimatedCostCents = Math.ceil(
              tier.monthlyCents * (requirements.expectedDurationMs / thirtyDaysMs),
            );
          }
        } else if (pricing.length > 0) {
          evidence.push("No currently advertised Conway pricing tier fits the requested shape.");
        }
      } catch (error) {
        evidence.push(
          `pricing unavailable: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    if (estimatedCostCents == null) {
      evidence.push(
        "Task cost remains unknown because duration or provider pricing evidence is incomplete.",
      );
    }

    return {
      estimatedCostCents,
      costCoverage: estimatedCostCents == null ? "unknown" : "complete",
      reusableResourceCount,
      evidence,
      metadata,
    };
  }

  async prepare(): Promise<EnvironmentPreparationResult> {
    const snapshot = await this.inspect();
    return {
      ready: snapshot.availability === "available",
      evidence: snapshot.evidence,
      metadata: snapshot.metadata,
    };
  }

  private async provisionSandbox(
    request: Parameters<NonNullable<EnvironmentProvider["provision"]>>[0],
  ): Promise<EnvironmentProvisionResult> {
    if (!this.conway.createSandbox) {
      throw new Error("Conway sandbox provisioning is not available in the current client.");
    }

    const shape = requestedShape(request.metadata);
    const name =
      typeof request.metadata?.name === "string" && request.metadata.name.trim()
        ? request.metadata.name.trim()
        : `abos-resource-${request.resourceId.slice(-12).toLowerCase()}`;

    const sandbox = await this.conway.createSandbox({
      name,
      ...(shape.vcpu > 0 ? { vcpu: shape.vcpu } : {}),
      ...(shape.memoryMb > 0 ? { memoryMb: shape.memoryMb } : {}),
      ...(shape.diskGb > 0 ? { diskGb: shape.diskGb } : {}),
      ...(request.region ? { region: request.region } : {}),
    });

    return {
      externalId: sandbox.id,
      type: "conway-sandbox",
      status: mapConwayStatus(sandbox.status),
      region: sandbox.region || request.region || null,
      capabilities: ["remote compute", "linux", "sandbox"],
      providerState: sandbox.status,
      evidence: [`Conway sandbox ${sandbox.id} created with status=${sandbox.status}`],
      metadata: {
        vcpu: sandbox.vcpu,
        memoryMb: sandbox.memoryMb,
        diskGb: sandbox.diskGb,
        createdAt: sandbox.createdAt ?? null,
      },
    };
  }

  private async collectSandboxArtifacts(
    resource: Parameters<
      NonNullable<EnvironmentProvider["collect"]>
    >[0],
  ): Promise<EnvironmentCollectionResult> {
    const pending = stringArray(
      resource.metadata.remoteArtifacts,
    );
    const previous = Array.isArray(
      resource.metadata.collectedArtifacts,
    )
      ? resource.metadata.collectedArtifacts
      : [];

    if (pending.length === 0) {
      return {
        artifacts: [],
        evidence: [
          "Conway resource has no pending remote artifacts to collect.",
        ],
        metadata: {
          artifactCollectionState:
            resource.metadata.artifactCollectionState ?? "none",
          remoteArtifacts: [],
          collectedArtifacts: previous,
        },
      };
    }

    if (
      !resource.externalId ||
      !this.conway.createScopedClient
    ) {
      return {
        artifacts: [],
        evidence: [
          "Conway sandbox identity or scoped execution capability is unavailable; remote artifacts remain pending.",
        ],
        metadata: {
          artifactCollectionState: "pending",
          remoteArtifacts: pending,
          collectedArtifacts: previous,
        },
      };
    }

    const scoped = this.conway.createScopedClient(
      resource.externalId,
    );
    const runtimeRoot =
      typeof resource.metadata.installRoot === "string" &&
      resource.metadata.installRoot.trim()
        ? resource.metadata.installRoot.trim()
        : "/root/abos";
    const collected: Array<{
      remotePath: string;
      localPath: string;
      bytes: number;
      sha256: string;
    }> = [];
    const remaining: string[] = [];
    const evidence: string[] = [];
    const chunkBytes = 8_000;

    for (const original of pending) {
      try {
        const observed = await scoped.exec(
          [
            "set -euo pipefail",
            `ROOT=${shellQuote(path.posix.resolve(runtimeRoot))}`,
            `CANDIDATE=${shellQuote(original)}`,
            'case "$CANDIDATE" in /*) ;; *) CANDIDATE="$ROOT/$CANDIDATE" ;; esac',
            'REAL="$(readlink -f -- "$CANDIDATE")"',
            'case "$REAL" in "$ROOT"|"$ROOT"/*) ;; *) echo "artifact path escapes runtime root" >&2; exit 73 ;; esac',
            'test -f "$REAL"',
            'SIZE="$(stat -c %s "$REAL")"',
            'SHA="$(sha256sum "$REAL" | awk \'{print $1}\')"',
            `printf 'ABOS_ARTIFACT_BYTES=%s\\nABOS_ARTIFACT_SHA256=%s\\n' "$SIZE" "$SHA"`,
          ].join("\n"),
          30_000,
        );
        if (observed.exitCode !== 0) {
          throw new Error(
            `remote observation failed: ${observed.stderr || observed.stdout}`,
          );
        }

        const observation =
          parseConwayArtifactObservation(
            observed.stdout,
          );
        if (!observation) {
          throw new Error(
            "remote observation returned no valid size/hash markers",
          );
        }

        const chunks: Buffer[] = [];
        for (
          let offset = 0;
          offset < observation.bytes;
          offset += chunkBytes
        ) {
          const count = Math.min(
            chunkBytes,
            observation.bytes - offset,
          );
          const fetched = await scoped.exec(
            [
              "set -euo pipefail",
              `ROOT=${shellQuote(path.posix.resolve(runtimeRoot))}`,
              `CANDIDATE=${shellQuote(original)}`,
              'case "$CANDIDATE" in /*) ;; *) CANDIDATE="$ROOT/$CANDIDATE" ;; esac',
              'REAL="$(readlink -f -- "$CANDIDATE")"',
              'case "$REAL" in "$ROOT"|"$ROOT"/*) ;; *) exit 73 ;; esac',
              `dd if="$REAL" bs=1 skip=${offset} count=${count} status=none | base64 -w0`,
            ].join("\n"),
            30_000,
          );
          if (fetched.exitCode !== 0) {
            throw new Error(
              `remote chunk fetch failed at offset=${offset}: ${fetched.stderr || fetched.stdout}`,
            );
          }

          const encoded =
            fetched.stdout.replace(/\s+/g, "");
          if (
            !encoded ||
            !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)
          ) {
            throw new Error(
              `remote chunk at offset=${offset} returned invalid base64`,
            );
          }
          chunks.push(Buffer.from(encoded, "base64"));
        }

        const body = Buffer.concat(chunks);
        const sha256 = createHash("sha256")
          .update(body)
          .digest("hex");
        if (
          body.length !== observation.bytes ||
          sha256.toLowerCase() !==
            observation.sha256.toLowerCase()
        ) {
          throw new Error(
            `collected artifact integrity mismatch: expected bytes=${observation.bytes} sha256=${observation.sha256}, received bytes=${body.length} sha256=${sha256}`,
          );
        }

        const goalSegment = safeFilesystemSegment(
          resource.goalId ?? "unbound-goal",
        );
        const resourceSegment =
          safeFilesystemSegment(resource.id);
        const artifactDir = path.join(
          getHomeDir(),
          ".abos",
          "workspace",
          goalSegment,
          "remote-artifacts",
          resourceSegment,
        );
        fs.mkdirSync(artifactDir, {
          recursive: true,
        });
        const basename =
          safeArtifactBasename(original);
        const localPath = path.join(
          artifactDir,
          `${sha256.slice(0, 12)}-${basename}`,
        );
        fs.writeFileSync(localPath, body, {
          mode: 0o600,
        });

        collected.push({
          remotePath: original,
          localPath,
          bytes: body.length,
          sha256,
        });
        evidence.push(
          `Collected Conway artifact "${original}" to "${localPath}" bytes=${body.length} sha256=${sha256}.`,
        );
      } catch (error) {
        remaining.push(original);
        evidence.push(
          `Conway artifact "${original}" remains pending: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return {
      artifacts: collected.map(
        (entry) => entry.localPath,
      ),
      evidence,
      metadata: {
        artifactCollectionState:
          remaining.length === 0
            ? "collected"
            : "pending",
        remoteArtifacts: remaining,
        collectedArtifacts: [
          ...previous,
          ...collected,
        ],
        artifactCollectionObservedAt:
          new Date().toISOString(),
      },
    };
  }

  private async healthSandbox(
    externalId: string | null,
  ): Promise<EnvironmentHealthResult> {
    if (!externalId || !this.conway.listSandboxes) {
      return {
        healthy: null,
        status: "unknown",
        evidence: ["Conway sandbox identity or inventory capability is unavailable."],
      };
    }

    const sandboxes = await this.conway.listSandboxes();
    const sandbox = sandboxes.find((entry) => entry.id === externalId);
    if (!sandbox) {
      return {
        healthy: false,
        status: "unknown",
        providerState: "not_observed",
        evidence: [`Conway sandbox ${externalId} was not returned by provider inventory.`],
      };
    }

    const running = sandbox.status.toLowerCase() === "running";
    return {
      healthy: running,
      status: running ? "running" : mapConwayStatus(sandbox.status),
      providerState: sandbox.status,
      evidence: [`Conway sandbox ${externalId} provider status=${sandbox.status}`],
      metadata: {
        region: sandbox.region,
        vcpu: sandbox.vcpu,
        memoryMb: sandbox.memoryMb,
        diskGb: sandbox.diskGb,
      },
    };
  }

  private async reconcileSandbox(
    resource: Parameters<NonNullable<EnvironmentProvider["reconcile"]>>[0],
  ): Promise<EnvironmentReconcileResult> {
    if (!this.conway.listSandboxes || !resource.externalId) {
      return {
        resource: {
          ...resource,
          status: "unknown",
          providerState: "inventory_unavailable",
          updatedAt: new Date().toISOString(),
        },
        actualExists: null,
        action: "mark_unknown",
        evidence: ["Conway inventory cannot currently verify this resource."],
      };
    }

    const sandboxes = await this.conway.listSandboxes();
    const sandbox = sandboxes.find((entry) => entry.id === resource.externalId);
    if (!sandbox) {
      return {
        resource: {
          ...resource,
          status: "unknown",
          providerState: "not_observed",
          updatedAt: new Date().toISOString(),
        },
        actualExists: false,
        action: "mark_unknown",
        evidence: [
          `Conway inventory did not return resource ${resource.externalId}; absence is not treated as verified destruction.`,
        ],
      };
    }

    return {
      resource: {
        ...resource,
        status: mapConwayStatus(sandbox.status),
        region: sandbox.region || resource.region,
        providerState: sandbox.status,
        metadata: {
          ...resource.metadata,
          vcpu: sandbox.vcpu,
          memoryMb: sandbox.memoryMb,
          diskGb: sandbox.diskGb,
        },
        updatedAt: new Date().toISOString(),
      },
      actualExists: true,
      action: "none",
      evidence: [
        `Conway resource ${resource.externalId} reconciled from provider inventory.`,
      ],
    };
  }
}

function parseConwayArtifactObservation(
  output: string,
): { bytes: number; sha256: string } | null {
  const bytesMatch =
    /(?:^|\n)ABOS_ARTIFACT_BYTES=(\d+)(?:\n|$)/.exec(
      output,
    );
  const hashMatch =
    /(?:^|\n)ABOS_ARTIFACT_SHA256=([0-9a-fA-F]{64})(?:\n|$)/.exec(
      output,
    );
  if (!bytesMatch || !hashMatch) {
    return null;
  }

  const bytes = Number(bytesMatch[1]);
  if (!Number.isSafeInteger(bytes) || bytes < 0) {
    return null;
  }
  return {
    bytes,
    sha256: hashMatch[1].toLowerCase(),
  };
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (entry): entry is string =>
        typeof entry === "string",
    )
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function safeFilesystemSegment(
  value: string,
): string {
  const normalized = value
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
  return normalized || "unbound";
}

function safeArtifactBasename(
  value: string,
): string {
  const basename = path.posix.basename(value);
  const normalized = basename
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  return normalized || "artifact";
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function requestedShape(
  metadata: Record<string, unknown> | undefined,
): { vcpu: number; memoryMb: number; diskGb: number } {
  return {
    vcpu: positiveNumber(metadata?.vcpu),
    memoryMb: positiveNumber(metadata?.memoryMb),
    diskGb: positiveNumber(metadata?.diskGb),
  };
}

function positiveNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : 0;
}

function mapConwayStatus(status: string) {
  switch (status.trim().toLowerCase()) {
    case "running":
    case "healthy":
      return "running" as const;
    case "ready":
      return "ready" as const;
    case "starting":
    case "creating":
    case "provisioning":
      return "provisioning" as const;
    case "stopped":
    case "suspended":
      return "suspended" as const;
    case "failed":
    case "error":
      return "failed" as const;
    default:
      return "unknown" as const;
  }
}
