
import os from "node:os";
import type {
  EnvironmentEstimate,
  EnvironmentHealthResult,
  EnvironmentPreparationResult,
  EnvironmentProvider,
  EnvironmentReconcileResult,
  EnvironmentRequirements,
  EnvironmentSatisfaction,
  EnvironmentSnapshot,
} from "./types.js";
import {
  getLocalBrowserRuntime,
  type LocalBrowserRuntime,
} from "../browser/local-runtime.js";

export class LocalEnvironmentProvider implements EnvironmentProvider {
  readonly id = "local";

  constructor(
    private readonly browserRuntime: Pick<LocalBrowserRuntime, "probe"> = getLocalBrowserRuntime(),
  ) {}

  async inspect(): Promise<EnvironmentSnapshot> {
    const observedAt = new Date().toISOString();
    const browser = await this.browserRuntime.probe();
    const evidence = [
      `platform=${process.platform}`,
      `arch=${process.arch}`,
      `node=${process.version}`,
      `cpus=${os.cpus().length}`,
      `freeMemoryBytes=${os.freemem()}`,
      ...browser.evidence.map((entry) => `browser:${entry}`),
    ];

    return {
      id: this.id,
      label: "Local host",
      availability: "available",
      evidence,
      costModel: "host-provided",
      constraints: browser.available
        ? []
        : ["Structured browser is currently unavailable on this host; filesystem/process capabilities remain available."],
      observedAt,
      metadata: {
        platform: process.platform,
        arch: process.arch,
        cwd: process.cwd(),
        totalMemoryBytes: os.totalmem(),
        freeMemoryBytes: os.freemem(),
        structuredBrowserAvailable: browser.available,
        structuredBrowserObservedAt: browser.observedAt,
        structuredBrowserTarget: browser.target?.label ?? null,
      },
      capabilities: [
        {
          id: "local:filesystem",
          type: "executor",
          provider: "local",
          description: "Read and write files on the local ABOS host within policy boundaries.",
          requirements: ["filesystem"],
          provides: ["filesystem"],
          permissions: [],
          environment: "local",
          available: true,
        },
        {
          id: "local:process",
          type: "executor",
          provider: "local",
          description: "Execute local processes and CLI tools exposed to ABOS.",
          requirements: ["shell", "cli", "process"],
          provides: ["shell", "cli", "process"],
          permissions: [],
          environment: "local",
          available: true,
        },
        {
          id: "local:structured-browser",
          type: "browser",
          provider: "local-browser",
          description: "Structured semantic browser control using an already-installed local host browser through Playwright Core.",
          requirements: ["browser", "structured browser", "web interaction"],
          provides: ["browser", "structured browser", "web interaction"],
          permissions: ["network", "local-file-upload", "local-file-download"],
          effects: ["network_navigation", "browser_interaction", "file_upload", "file_download"],
          environment: "local",
          available: browser.available,
          state: browser.available ? "verified_available" : "unavailable",
          observedAt: browser.observedAt,
          authority: "local-browser:launch-probe",
          evidence: [...browser.evidence],
          metadata: {
            browserTarget: browser.target?.label ?? null,
            browserVersion: browser.browserVersion ?? null,
          },
        },
      ],
    };
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
        if (!capability.available) return false;
        const text = [
          capability.id,
          capability.description,
          ...capability.requirements,
          ...(capability.provides ?? []),
        ].join(" ").toLowerCase();
        return text.includes(requirement);
      })
    );

    return {
      satisfiable: missing.length === 0,
      capabilityFit: required.length === 0
        ? 1
        : (required.length - missing.length) / required.length,
      missingCapabilities: missing,
      evidence: [
        `local capability fit=${required.length - missing.length}/${required.length}`,
      ],
    };
  }

  async estimate(): Promise<EnvironmentEstimate> {
    return {
      estimatedCostCents: 0,
      costCoverage: "complete",
      reusableResourceCount: 1,
      evidence: [
        "Local host is already present; ABOS does not attribute provider billing to host reuse.",
      ],
      metadata: {
        totalMemoryBytes: os.totalmem(),
        freeMemoryBytes: os.freemem(),
        cpus: os.cpus().length,
      },
    };
  }

  async prepare(): Promise<EnvironmentPreparationResult> {
    const snapshot = await this.inspect();
    return {
      ready: snapshot.availability === "available" || snapshot.availability === "degraded",
      evidence: snapshot.evidence,
      metadata: snapshot.metadata,
    };
  }

  async health(
    resource: Parameters<NonNullable<EnvironmentProvider["health"]>>[0],
  ): Promise<EnvironmentHealthResult> {
    if (resource.type !== "local-host") {
      return {
        healthy: null,
        status: "unknown",
        providerState: "runtime_owned_executor",
        evidence: [
          "Local host health does not prove an in-process Task executor is still alive; worker liveness remains a runtime observation.",
        ],
      };
    }

    return {
      healthy: true,
      status: "running",
      providerState: "process_alive",
      evidence: [
        `node=${process.version}`,
        `freeMemoryBytes=${os.freemem()}`,
      ],
      metadata: {
        platform: process.platform,
        arch: process.arch,
        cpus: os.cpus().length,
      },
    };
  }

  async reconcile(resource: Parameters<NonNullable<EnvironmentProvider["reconcile"]>>[0]): Promise<EnvironmentReconcileResult> {
    if (resource.type !== "local-host") {
      return {
        resource: {
          ...resource,
          status: "unknown",
          providerState: "runtime_restarted_or_unobserved",
          updatedAt: new Date().toISOString(),
        },
        actualExists: null,
        action: "mark_unknown",
        evidence: [
          "A persisted local Task executor cannot be inferred alive from host presence after restart; task-level recovery must observe it explicitly.",
        ],
      };
    }

    const nextStatus = resource.status === "unknown"
      ? "ready"
      : resource.status;

    return {
      resource: {
        ...resource,
        status: nextStatus,
        providerState: "host_present",
        updatedAt: new Date().toISOString(),
      },
      actualExists: true,
      action: "none",
      evidence: [
        "Local host is present in the current ABOS process environment.",
      ],
    };
  }
}
