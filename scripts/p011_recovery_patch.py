from pathlib import Path


def replace_once(path: str, before: str, after: str) -> None:
    p = Path(path)
    source = p.read_text()
    count = source.count(before)
    if count != 1:
        raise RuntimeError(f"Expected exactly one anchor in {path}, found {count}: {before[:100]!r}")
    p.write_text(source.replace(before, after, 1))


recover_function = r'''/**
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

'''

replace_once(
    "src/replication/runtime-control.ts",
    '''/**\n * Restart a lifecycle-managed child without using terminal `stopped` as an\n''',
    recover_function + '''/**\n * Restart a lifecycle-managed child without using terminal `stopped` as an\n''',
)

replace_once(
    "src/heartbeat/tasks.ts",
    '''    observeChildRuntime,\n    restartChildRuntime,\n    ensureChildRuntimeStopped,\n''',
    '''    observeChildRuntime,\n    recoverChildRuntime,\n    ensureChildRuntimeStopped,\n''',
)

replace_once(
    "src/heartbeat/tasks.ts",
    '''      return restartChildRuntime(taskCtx.conway, taskCtx.db, childId, lifecycle);\n''',
    '''      // Auto-heal is an idempotent recovery request, not a force restart.\n      // A late-success observed running is reused instead of terminated.\n      return recoverChildRuntime(taskCtx.conway, taskCtx.db, childId, lifecycle);\n''',
)

print("P-011 recovery wiring patch applied")
