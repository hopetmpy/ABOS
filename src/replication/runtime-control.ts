/**
 * Observed child runtime process control.
 *
 * This module does not create a second lifecycle authority. It executes and
 * observes process effects inside the child's scoped Conway sandbox, while
 * ChildLifecycle remains the durable state/event authority.
 */

import type { AbosDatabase, ConwayClient } from "../types.js";
import type { ChildLifecycle } from "./lifecycle.js";
import { ensureChildRuntimeRunning } from "./spawn.js";

export type ChildRuntimeObservedState = "running" | "stopped" | "unknown";

export interface ChildRuntimeObservation {
  childId: string;
  sandboxId: string;
  state: ChildRuntimeObservedState;
  evidence: string[];
}

export interface ChildRuntimeMutationResult extends ChildRuntimeObservation {
  success: boolean;
  lifecycleUpdated: boolean;
}

interface LifecycleResolution {
  state: string | null;
  lifecycleUpdated: boolean;
  evidence: string[];
  observation?: ChildRuntimeObservation;
}

const RUNTIME_PATTERN = "node .*dist/index\\.js --run";

function childOrThrow(db: AbosDatabase, childId: string) {
  const child = db.getChildById(childId);
  if (!child) throw new Error(`Child ${childId} not found.`);
  if (!child.sandboxId) throw new Error(`Child ${childId} has no sandbox id.`);
  return child;
}

/**
 * Observe the ABOS runtime process inside the CHILD execution boundary.
 * Transport/probe ambiguity stays UNKNOWN; it is never converted to stopped.
 */
export async function observeChildRuntime(
  conway: ConwayClient,
  db: AbosDatabase,
  childId: string,
): Promise<ChildRuntimeObservation> {
  const child = childOrThrow(db, childId);
  const scoped = conway.createScopedClient(child.sandboxId);

  try {
    const result = await scoped.exec(
      `pgrep -af '${RUNTIME_PATTERN}' >/dev/null 2>&1 && echo running || echo stopped`,
      15_000,
    );

    if (result.exitCode !== 0) {
      return {
        childId,
        sandboxId: child.sandboxId,
        state: "unknown",
        evidence: [
          `Child runtime probe failed with exit=${result.exitCode}: ${result.stderr || result.stdout || "no output"}`,
        ],
      };
    }

    const tokens = result.stdout.trim().split(/\s+/);
    if (tokens.includes("running")) {
      return {
        childId,
        sandboxId: child.sandboxId,
        state: "running",
        evidence: [`Child ${childId} runtime process observed running in sandbox ${child.sandboxId}.`],
      };
    }
    if (tokens.includes("stopped")) {
      return {
        childId,
        sandboxId: child.sandboxId,
        state: "stopped",
        evidence: [`Child ${childId} runtime process observed absent in sandbox ${child.sandboxId}.`],
      };
    }

    return {
      childId,
      sandboxId: child.sandboxId,
      state: "unknown",
      evidence: [`Child runtime probe returned an unclassified response: ${result.stdout || "<empty>"}`],
    };
  } catch (error) {
    return {
      childId,
      sandboxId: child.sandboxId,
      state: "unknown",
      evidence: [
        `Child runtime probe unavailable: ${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }
}

/**
 * Reconcile a pre-V7 child into ChildLifecycle only from fresh child-scoped
 * process evidence. Legacy row labels alone are never promoted into truth.
 */
async function resolveLifecycleForRuntimeEffect(
  conway: ConwayClient,
  db: AbosDatabase,
  childId: string,
  lifecycle: ChildLifecycle,
): Promise<LifecycleResolution> {
  try {
    return {
      state: lifecycle.getCurrentState(childId),
      lifecycleUpdated: false,
      evidence: [],
    };
  } catch (error) {
    const child = childOrThrow(db, childId);
    if (child.status !== "running" && child.status !== "sleeping") {
      return {
        state: null,
        lifecycleUpdated: false,
        evidence: [
          `Lifecycle reconciliation refused for child ${childId}: no lifecycle history and legacy status "${child.status}" is not safely adoptable.`,
          `Original lifecycle lookup: ${error instanceof Error ? error.message : String(error)}`,
        ],
      };
    }

    const observed = await observeChildRuntime(conway, db, childId);
    if (observed.state === "unknown") {
      return {
        state: null,
        lifecycleUpdated: false,
        observation: observed,
        evidence: [
          ...observed.evidence,
          `Legacy child ${childId} was not adopted because runtime truth is UNKNOWN.`,
        ],
      };
    }

    const adoptedState = observed.state === "running" ? "healthy" : "unhealthy";
    try {
      const adopted = lifecycle.adoptObservedLegacyState(
        childId,
        adoptedState,
        `legacy child reconciled from observed runtime ${observed.state}`,
        {
          sandboxId: child.sandboxId,
          runtimeObservation: observed.state,
          evidence: observed.evidence,
        },
      );
      const current = lifecycle.getCurrentState(childId);
      return {
        state: current,
        lifecycleUpdated: adopted,
        observation: observed,
        evidence: [
          ...observed.evidence,
          adopted
            ? `Legacy child ${childId} adopted into lifecycle state ${current}.`
            : `Lifecycle history for child ${childId} was established concurrently; current state ${current} reused.`,
        ],
      };
    } catch (adoptError) {
      return {
        state: null,
        lifecycleUpdated: false,
        observation: observed,
        evidence: [
          ...observed.evidence,
          `Legacy lifecycle adoption failed: ${adoptError instanceof Error ? adoptError.message : String(adoptError)}`,
        ],
      };
    }
  }
}

async function stopObservedProcess(
  conway: ConwayClient,
  db: AbosDatabase,
  childId: string,
): Promise<ChildRuntimeObservation> {
  const before = await observeChildRuntime(conway, db, childId);
  if (before.state !== "running") return before;

  const child = childOrThrow(db, childId);
  const scoped = conway.createScopedClient(child.sandboxId);
  const evidence = [...before.evidence];

  try {
    const stop = await scoped.exec(
      `pkill -TERM -f '[n]ode .*dist/index\\.js --run' || true`,
      15_000,
    );
    evidence.push(
      `Child runtime TERM requested in sandbox ${child.sandboxId}; exit=${stop.exitCode}.`,
    );
  } catch (error) {
    return {
      childId,
      sandboxId: child.sandboxId,
      state: "unknown",
      evidence: [
        ...evidence,
        `Child runtime stop command unavailable: ${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }

  // A command acknowledgement is not the post-condition. Give SIGTERM a
  // bounded window to settle, then classify from a child-scoped process probe.
  // This is observation, not a blind retry of the side effect.
  try {
    const settle = await scoped.exec(
      `for i in 1 2 3 4 5; do if ! pgrep -af '${RUNTIME_PATTERN}' >/dev/null 2>&1; then echo stopped; exit 0; fi; sleep 1; done; echo running`,
      10_000,
    );
    if (settle.exitCode !== 0) {
      return {
        childId,
        sandboxId: child.sandboxId,
        state: "unknown",
        evidence: [
          ...evidence,
          `Child runtime post-stop probe failed with exit=${settle.exitCode}: ${settle.stderr || settle.stdout || "no output"}`,
        ],
      };
    }

    const tokens = settle.stdout.trim().split(/\s+/);
    if (tokens.includes("stopped")) {
      return {
        childId,
        sandboxId: child.sandboxId,
        state: "stopped",
        evidence: [
          ...evidence,
          `Child ${childId} runtime process absence observed after bounded TERM wait.`,
        ],
      };
    }
    if (tokens.includes("running")) {
      return {
        childId,
        sandboxId: child.sandboxId,
        state: "running",
        evidence: [
          ...evidence,
          `Child ${childId} runtime still observed running after bounded TERM wait.`,
        ],
      };
    }

    return {
      childId,
      sandboxId: child.sandboxId,
      state: "unknown",
      evidence: [
        ...evidence,
        `Child runtime post-stop probe returned an unclassified response: ${settle.stdout || "<empty>"}`,
      ],
    };
  } catch (error) {
    return {
      childId,
      sandboxId: child.sandboxId,
      state: "unknown",
      evidence: [
        ...evidence,
        `Child runtime post-stop observation unavailable: ${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }
}

/**
 * Permanently stop a lifecycle-managed child.
 *
 * `stopped` is persisted only after process absence is observed. Pre-V7
 * running/sleeping children may be adopted into lifecycle first, but only from
 * fresh child-scoped process evidence.
 */
export async function ensureChildRuntimeStopped(
  conway: ConwayClient,
  db: AbosDatabase,
  childId: string,
  lifecycle: ChildLifecycle,
): Promise<ChildRuntimeMutationResult> {
  const resolution = await resolveLifecycleForRuntimeEffect(
    conway,
    db,
    childId,
    lifecycle,
  );
  let lifecycleState = resolution.state;
  let lifecycleUpdated = resolution.lifecycleUpdated;

  if (!lifecycleState) {
    const child = childOrThrow(db, childId);
    return {
      childId,
      sandboxId: child.sandboxId,
      state: resolution.observation?.state ?? "unknown",
      success: false,
      lifecycleUpdated,
      evidence: resolution.evidence,
    };
  }

  if (!["healthy", "unhealthy", "stopped"].includes(lifecycleState)) {
    const child = childOrThrow(db, childId);
    return {
      childId,
      sandboxId: child.sandboxId,
      state: "unknown",
      success: false,
      lifecycleUpdated,
      evidence: [
        ...resolution.evidence,
        `Permanent stop refused from lifecycle state ${lifecycleState}; no process effect was attempted.`,
      ],
    };
  }

  const observed = await stopObservedProcess(conway, db, childId);
  if (observed.state !== "stopped") {
    return {
      ...observed,
      success: false,
      lifecycleUpdated,
      evidence: [...resolution.evidence, ...observed.evidence],
    };
  }

  if (lifecycleState === "stopped") {
    return {
      ...observed,
      success: true,
      lifecycleUpdated,
      evidence: [...resolution.evidence, ...observed.evidence],
    };
  }

  lifecycle.transition(
    childId,
    "stopped",
    "runtime process absence observed after permanent stop",
    { sandboxId: observed.sandboxId, evidence: observed.evidence },
  );
  lifecycleState = "stopped";
  lifecycleUpdated = true;

  return {
    ...observed,
    success: lifecycleState === "stopped",
    lifecycleUpdated,
    evidence: [...resolution.evidence, ...observed.evidence],
  };
}

/**
 * Recover/ensure a child runtime after health failure or supervisor restart.
 *
 * Unlike an explicit restart, recovery is idempotent: if a late-success has
 * already left the child process running, the existing start primitive only
 * reconciles lifecycle state and does not terminate or launch another process.
 */
export async function recoverChildRuntime(
  conway: ConwayClient,
  db: AbosDatabase,
  childId: string,
  lifecycle: ChildLifecycle,
): Promise<ChildRuntimeMutationResult> {
  const resolution = await resolveLifecycleForRuntimeEffect(
    conway,
    db,
    childId,
    lifecycle,
  );
  const lifecycleState = resolution.state;
  let lifecycleUpdated = resolution.lifecycleUpdated;

  if (!lifecycleState) {
    const child = childOrThrow(db, childId);
    return {
      childId,
      sandboxId: child.sandboxId,
      state: resolution.observation?.state ?? "unknown",
      success: false,
      lifecycleUpdated,
      evidence: resolution.evidence,
    };
  }

  if (!["funded", "starting", "healthy", "unhealthy"].includes(lifecycleState)) {
    const child = childOrThrow(db, childId);
    return {
      childId,
      sandboxId: child.sandboxId,
      state: "unknown",
      success: false,
      lifecycleUpdated,
      evidence: [
        ...resolution.evidence,
        `Recovery refused from lifecycle state ${lifecycleState}; no process effect was attempted.`,
      ],
    };
  }

  const evidence = [...resolution.evidence];
  try {
    const started = await ensureChildRuntimeRunning(conway, db, childId, lifecycle);
    evidence.push(...started.evidence);
    const finalObservation = await observeChildRuntime(conway, db, childId);
    evidence.push(...finalObservation.evidence);
    const finalLifecycleState = lifecycle.getCurrentState(childId);
    lifecycleUpdated =
      lifecycleUpdated ||
      finalLifecycleState !== lifecycleState ||
      !started.alreadyRunning;

    return {
      ...finalObservation,
      success: started.healthy && finalObservation.state === "running",
      lifecycleUpdated,
      evidence,
    };
  } catch (error) {
    const child = childOrThrow(db, childId);
    return {
      childId,
      sandboxId: child.sandboxId,
      state: "unknown",
      success: false,
      lifecycleUpdated,
      evidence: [
        ...evidence,
        `Child runtime recovery failed: ${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }
}

/**
 * Restart a lifecycle-managed child without using terminal `stopped` as an
 * intermediate state.
 *
 * The old process is reconciled/stopped first. Only observed absence can move
 * healthy -> unhealthy for the recovery window. The existing canonical start
 * primitive then performs start + post-start observation and owns promotion to
 * healthy. Pre-V7 running/sleeping children are first adopted from fresh
 * process evidence, never from the legacy row label alone.
 */
export async function restartChildRuntime(
  conway: ConwayClient,
  db: AbosDatabase,
  childId: string,
  lifecycle: ChildLifecycle,
): Promise<ChildRuntimeMutationResult> {
  const resolution = await resolveLifecycleForRuntimeEffect(
    conway,
    db,
    childId,
    lifecycle,
  );
  let lifecycleState = resolution.state;
  let lifecycleUpdated = resolution.lifecycleUpdated;

  if (!lifecycleState) {
    const child = childOrThrow(db, childId);
    return {
      childId,
      sandboxId: child.sandboxId,
      state: resolution.observation?.state ?? "unknown",
      success: false,
      lifecycleUpdated,
      evidence: resolution.evidence,
    };
  }

  if (!["funded", "starting", "healthy", "unhealthy"].includes(lifecycleState)) {
    const child = childOrThrow(db, childId);
    return {
      childId,
      sandboxId: child.sandboxId,
      state: "unknown",
      success: false,
      lifecycleUpdated,
      evidence: [
        ...resolution.evidence,
        `Restart refused from lifecycle state ${lifecycleState}; no process effect was attempted.`,
      ],
    };
  }

  const evidence: string[] = [...resolution.evidence];
  const first = await observeChildRuntime(conway, db, childId);
  evidence.push(...first.evidence);
  if (first.state === "unknown") {
    return { ...first, success: false, lifecycleUpdated, evidence };
  }

  if (first.state === "running") {
    const stopped = await stopObservedProcess(conway, db, childId);
    evidence.push(...stopped.evidence);
    if (stopped.state !== "stopped") {
      return {
        ...stopped,
        success: false,
        lifecycleUpdated,
        evidence,
      };
    }
  }

  // Re-read after the stop because another observer may have reconciled state.
  lifecycleState = lifecycle.getCurrentState(childId);
  if (lifecycleState === "healthy") {
    lifecycle.transition(
      childId,
      "unhealthy",
      "runtime process absence observed during restart recovery",
      { sandboxId: first.sandboxId },
    );
    lifecycleState = "unhealthy";
    lifecycleUpdated = true;
  }

  try {
    const started = await ensureChildRuntimeRunning(conway, db, childId, lifecycle);
    evidence.push(...started.evidence);
    const finalObservation = await observeChildRuntime(conway, db, childId);
    evidence.push(...finalObservation.evidence);

    return {
      ...finalObservation,
      success: started.healthy && finalObservation.state === "running",
      lifecycleUpdated:
        lifecycleUpdated || lifecycle.getCurrentState(childId) === "healthy",
      evidence,
    };
  } catch (error) {
    const child = childOrThrow(db, childId);
    return {
      childId,
      sandboxId: child.sandboxId,
      state: "unknown",
      success: false,
      lifecycleUpdated,
      evidence: [
        ...evidence,
        `Child runtime restart failed: ${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }
}
