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
import {
  getLocalComputerRuntime,
  type LocalComputerRuntime,
} from "../platform/local-computer-runtime.js";
import {
  getLocalGuiRuntime,
  type LocalGuiRuntime,
} from "../gui/local-runtime.js";

export class LocalEnvironmentProvider implements EnvironmentProvider {
  readonly id = "local";

  constructor(
    private readonly browserRuntime: Pick<LocalBrowserRuntime, "probe"> = getLocalBrowserRuntime(),
    private readonly computerRuntime: Pick<LocalComputerRuntime, "probe"> = getLocalComputerRuntime(),
    private readonly guiRuntime: Pick<LocalGuiRuntime, "probe"> = getLocalGuiRuntime(),
  ) {}

  async inspect(): Promise<EnvironmentSnapshot> {
    const observedAt = new Date().toISOString();
    const browser = await this.browserRuntime.probe();
    const computer = this.computerRuntime.probe();
    const gui = this.guiRuntime.probe();
    const evidence = [
      `platform=${process.platform}`,
      `arch=${process.arch}`,
      `node=${process.version}`,
      `cpus=${os.cpus().length}`,
      `freeMemoryBytes=${os.freemem()}`,
      ...browser.evidence.map((entry) => `browser:${entry}`),
      ...computer.evidence.map((entry) => `process:${entry}`),
      ...gui.accessibility.evidence.map((entry) => `gui-accessibility:${entry}`),
      ...gui.screen.evidence.map((entry) => `gui-screen:${entry}`),
      ...gui.input.evidence.map((entry) => `gui-input:${entry}`),
    ];
    const constraints: string[] = [];
    if (!browser.available) {
      constraints.push(
        "Structured browser is currently unavailable on this host; other local capabilities are assessed independently.",
      );
    }
    if (!computer.available) {
      constraints.push(
        "Local process execution/lifecycle is currently unavailable on this host because no usable shell was observed.",
      );
    }
    if (!gui.accessibility.available) {
      constraints.push(
        "Local desktop accessibility/semantic GUI control is currently unavailable on this host; screen and input capabilities are assessed independently.",
      );
    }
    if (!gui.screen.available) {
      constraints.push(
        "Local screen capture is currently unavailable on this host.",
      );
    }
    if (!gui.input.available) {
      constraints.push(
        "Local low-level GUI input is currently unavailable or not authorized on this host.",
      );
    }

    return {
      id: this.id,
      label: "Local host",
      availability: "available",
      evidence,
      costModel: "host-provided",
      constraints,
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
        localProcessAvailable: computer.available,
        localProcessObservedAt: computer.observedAt,
        localProcessShell: computer.shell,
        guiAccessibilityAvailable: gui.accessibility.available,
        guiScreenAvailable: gui.screen.available,
        guiInputAvailable: gui.input.available,
        guiObservedAt: gui.observedAt,
        guiScreenBounds: gui.screen.bounds,
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
          description: "Execute and manage local processes and CLI tools exposed to ABOS.",
          requirements: ["shell", "cli", "process", "process lifecycle"],
          provides: ["shell", "cli", "process", "process lifecycle", "cwd", "environment overrides"],
          permissions: [],
          effects: ["process_execution", "process_termination"],
          environment: "local",
          available: computer.available,
          state: computer.available ? "verified_available" : "unavailable",
          observedAt: computer.observedAt,
          authority: "local-computer-runtime:process-probe",
          evidence: [...computer.evidence],
          metadata: { shell: computer.shell },
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
        {
          id: "local:gui-accessibility",
          type: "executor",
          provider: "local-gui",
          description: "Observe the local desktop accessibility tree and perform semantic GUI actions against uniquely re-resolved UI elements.",
          requirements: ["desktop", "gui", "accessibility", "semantic gui interaction"],
          provides: ["desktop accessibility", "gui observation", "semantic gui interaction"],
          permissions: ["desktop-observation", "desktop-interaction"],
          effects: ["desktop_observation", "desktop_semantic_interaction"],
          environment: "local",
          available: gui.accessibility.available,
          state: gui.accessibility.available ? "verified_available" : "unavailable",
          observedAt: gui.observedAt,
          authority: "local-gui-runtime:accessibility-probe",
          evidence: [...gui.accessibility.evidence],
        },
        {
          id: "local:gui-screen",
          type: "executor",
          provider: "local-gui",
          description: "Capture the observed local virtual screen to verified PNG evidence confined to the ABOS home.",
          requirements: ["screen", "screenshot", "gui observation"],
          provides: ["screen capture", "screenshot", "visual gui observation"],
          permissions: ["screen-capture", "local-file-write"],
          effects: ["screen_capture", "file_write"],
          environment: "local",
          available: gui.screen.available,
          state: gui.screen.available ? "verified_available" : "unavailable",
          observedAt: gui.observedAt,
          authority: "local-gui-runtime:screen-probe",
          evidence: [...gui.screen.evidence],
          metadata: { bounds: gui.screen.bounds },
        },
        {
          id: "local:gui-input",
          type: "executor",
          provider: "local-gui",
          description: "Send explicit low-level pointer or keyboard input to the current local interactive desktop. This is never a silent semantic fallback.",
          requirements: ["gui input", "mouse", "keyboard", "desktop interaction"],
          provides: ["pointer input", "keyboard input", "explicit gui input"],
          permissions: ["desktop-input"],
          effects: ["desktop_low_level_input"],
          environment: "local",
          available: gui.input.available,
          state: gui.input.available ? "verified_available" : "unavailable",
          observedAt: gui.observedAt,
          authority: "local-gui-runtime:input-probe",
          evidence: [...gui.input.evidence],
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
