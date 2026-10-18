/**
 * Spawn
 *
 * Spawn child ABOS agents in new Conway sandboxes.
 * Uses the lifecycle state machine for tracked transitions.
 * Cleans up sandbox on ANY failure after creation.
 */

import type {
  ConwayClient,
  AbosIdentity,
  AbosConfig,
  AbosDatabase,
  GenesisConfig,
  ChildAbosAgent,
} from "../types.js";
import { DEFAULT_CONFIG, MAX_CHILDREN } from "../types.js";
import { ChildLifecycle } from "./lifecycle.js";
import { EnvironmentResourceStore } from "../environments/resource-store.js";
import { getFinancialEffectByOperationKey } from "../economics/financial-effects.js";
import { ulid } from "ulid";
import { propagateConstitution, verifyConstitution } from "./constitution.js";
import { writeFamilyKnowledgeBundle } from "./family-knowledge.js";
import { verifyChildBootstrap } from "./bootstrap-gate.js";
import {
  ABOS_CANONICAL_BRANCH,
  ABOS_CANONICAL_REPOSITORY,
} from "../self-mod/upstream.js";

async function installAbosRuntime(childConway: ConwayClient): Promise<void> {
  const command = [
    "rm -rf /root/abos",
    `git clone --branch '${ABOS_CANONICAL_BRANCH}' --single-branch '${ABOS_CANONICAL_REPOSITORY}' /root/abos`,
    "cd /root/abos",
    "(command -v pnpm >/dev/null 2>&1 || corepack enable pnpm)",
    "pnpm install --frozen-lockfile",
    "pnpm run build",
  ].join(" && ");

  const result = await childConway.exec(command, 180_000);
  if (result.exitCode !== 0) {
    throw new Error(
      `Failed to clone/install/build ABOS runtime: ${result.stderr || result.stdout || `exit ${result.exitCode}`}`,
    );
  }
}

import { isValidAddress } from "../identity/chain.js";
import type { ChainType } from "../identity/chain.js";

/**
 * Validate that an address is a well-formed, non-zero wallet address.
 * Supports both EVM (0x...) and Solana (base58) addresses.
 */
export function isValidWalletAddress(address: string, chainType?: ChainType): boolean {
  if (chainType === "solana") {
    return isValidAddress(address, "solana");
  }
  // Default EVM validation (with non-zero check)
  return (
    /^0x[a-fA-F0-9]{40}$/.test(address) && address !== "0x" + "0".repeat(40)
  );
}

async function materializeRequiredBootstrap(
  childConway: ConwayClient,
  sandboxId: string,
  db: AbosDatabase,
  parentAddress: string,
): Promise<void> {
  await propagateConstitution(childConway, sandboxId, db.raw);
  const constitution = await verifyConstitution(childConway, sandboxId, db.raw);
  if (!constitution.valid) {
    throw new Error(`Child constitution bootstrap failed: ${constitution.detail}`);
  }

  await writeFamilyKnowledgeBundle(
    childConway,
    sandboxId,
    db,
    parentAddress,
  );
}

/**
 * One already-provisioned resource and its canonical P-030 purchase identity.
 * This is NOT an authorization to create another provider resource.
 */
export interface ProcuredChildSandbox {
  resourceId: string;
  operationKey: string;
}

/**
 * Attach an existing, independently observed P-031 resource to a new child.
 * Exact P-018 ownership and P-030 identity must agree before any bootstrap
 * command. Neither provider acceptance nor a policy decision by itself proves
 * a usable sandbox. This function makes NO provider purchase.
 */
function claimProcuredChildSandbox(
  db: AbosDatabase,
  procurement: ProcuredChildSandbox,
  childId: string,
  requiredMemoryMb: number,
): { id: string } {
  const resources = new EnvironmentResourceStore(db.raw);
  const resource = resources.get(procurement.resourceId);
  const effect = getFinancialEffectByOperationKey(db.raw, procurement.operationKey);
  if (!resource || resource.provider !== "conway" ||
      resource.type !== "conway-sandbox" ||
      !resource.externalId || !resource.lastHealthCheck ||
      !["ready", "running"].includes(resource.status) ||
      resource.metadata.provisionNeedsReconciliation === true ||
      resource.metadata.retentionReleaseState === "released" ||
      resource.metadata.retentionReleaseState === "destroy_requested" ||
      resource.metadata.retentionReleaseState === "pending_observation" ||
      resource.metadata.childId ||
      db.getChildren().some(child => child.sandboxId === resource.externalId &&
        child.status !== "cleaned_up") ||
      !effect || effect.effectKind !== "provider_resource_procurement" ||
      effect.provider !== "conway" ||
      !effect.policyDecisionId ||
      !["pending", "completed"].includes(effect.state) ||
      effect.providerEffectId !== resource.externalId ||
      effect.request.operation !== "provision" ||
      effect.request.resourceId !== resource.id ||
      effect.request.goalId !== resource.goalId ||
      effect.request.taskId !== resource.taskId ||
      effect.request.pathId !== resource.pathId ||
      effect.request.region !== resource.region ||
      typeof resource.metadata.memoryMb !== "number" ||
      !Number.isFinite(resource.metadata.memoryMb) ||
      resource.metadata.memoryMb < requiredMemoryMb) {
    throw new Error(
      "P-031 child sandbox unavailable: verified P-018 resource, matching " +
      "P-030 authorized procurement, independent health, ownership or " +
      "required capacity is missing; no new Conway sandbox purchased.",
    );
  }
  // Claim in one local SQLite transaction. This prevents two child boots
  // from silently assigning the same owned resource. A failed bootstrap keeps
  // the explicit child/resource link available for recovery/cleanup.
  return db.raw.transaction(() => {
    const current = resources.get(resource.id);
    if (!current || current.metadata.childId ||
        db.getChildren().some(child => child.sandboxId === resource.externalId &&
          child.status !== "cleaned_up")) {
      throw new Error("P-018 child sandbox already claimed; no duplicate bootstrap.");
    }
    resources.applyMutation(resource.id, {
      retentionPolicy: "manual_retention",
      metadata: { childId },
      evidence: [
        "Existing independently verified P-031 resource reserved for child bootstrap; no additional purchase.",
      ],
    }, "child_bootstrap_claim", "Bind P-018 acquired resource to one P-029 child.");
    return { id: resource.externalId! };
  })();
}

/**
 * Spawn a child abos using an owned Conway sandbox, reusing known failed-child
 * capacity first when no new purchase has already been made.
 */
export async function spawnChild(
  conway: ConwayClient,
  identity: AbosIdentity,
  db: AbosDatabase,
  genesis: GenesisConfig,
  lifecycle?: ChildLifecycle,
  runtimeConfig?: Pick<AbosConfig, "maxChildren" | "childSandboxMemoryMb">,
  procurement?: ProcuredChildSandbox,
): Promise<ChildAbosAgent> {
  // Check child limit from config
  const existing = db
    .getChildren()
    .filter(
      (c) =>
        c.status !== "dead" &&
        c.status !== "cleaned_up" &&
        c.status !== "failed",
    );
  const maxChildren = runtimeConfig?.maxChildren ?? MAX_CHILDREN;
  if (existing.length >= maxChildren) {
    throw new Error(
      `Cannot spawn: already at max children (${maxChildren}). Kill or wait for existing children to die.`,
    );
  }

  const childId = ulid();
  let reusedSandbox: { id: string; resourceId: string; previousChildId: string } | null = null;
  // Older callers remain source-compatible; they now share the canonical
  // P-029 child lifecycle rather than buying through a second legacy path.
  lifecycle ??= new ChildLifecycle(db.raw);

  try {
    // Determine whether the supplier resource is available BEFORE creating
    // any child row. Missing purchase authority is not a failed child birth.
    const childMemoryMb =
      runtimeConfig?.childSandboxMemoryMb ??
      DEFAULT_CONFIG.childSandboxMemoryMb!;
    reusedSandbox = procurement ? null :
      await findReusableSandbox(conway, db, childMemoryMb);
    if (!procurement && !reusedSandbox) {
      throw new Error(
        "UNAVAILABLE: new Conway child sandbox requires P-031 " +
        "environment_procurement_execute first. Supply its resource_id and " +
        "procurement_operation_key to spawn_child; no supplier purchase dispatched.",
      );
    }

    const childChainType = genesis.chainType || (identity as any).chainType || "evm";
    lifecycle.initChild(childId, genesis.name, "", genesis.genesisPrompt, childChainType);

    let sandbox: { id: string };
    if (procurement) {
      sandbox = claimProcuredChildSandbox(db, procurement, childId, childMemoryMb);
    } else if (reusedSandbox) {
      // Transfer only the already-owned P-018 resource. The old failed
      // child remains historically failed, NOT cleaned_up/released: the
      // sandbox has NOT been destroyed. Ownership is now bound to the
      // next child before its potentially failing bootstrap.
      const resourceId = reusedSandbox.resourceId;
      const priorChildId = reusedSandbox.previousChildId;
      const resources = new EnvironmentResourceStore(db.raw);
      db.raw.transaction(() => {
        const owned = resources.get(resourceId);
        if (!owned || owned.externalId !== reusedSandbox!.id ||
            owned.metadata.childId !== priorChildId ||
            db.getChildById(priorChildId)?.status !== "failed") {
          throw new Error("P-018 reused child sandbox ownership changed; no bootstrap.");
        }
        resources.applyMutation(resourceId, {
          retentionPolicy: "manual_retention",
          metadata: { childId, priorChildId },
          evidence: [
            "Conway authenticated inventory observed existing sandbox running; " +
            "transferred child bootstrap ownership without supplier purchase or resource deletion.",
          ],
        }, "child_reuse_handoff", "Rebind reusable failed-child sandbox to successor child.");
      })();
      sandbox = { id: reusedSandbox.id };
    } else {
      throw new Error("P-031 child resource selection unresolved; no supplier dispatch.");
    }


    // Create a scoped client so all exec/writeFile calls target the CHILD sandbox
    const childConway = conway.createScopedClient(sandbox.id);

    // Update sandbox ID in children table
    db.raw
      .prepare("UPDATE children SET sandbox_id = ? WHERE id = ?")
      .run(sandbox.id, childId);

    // State: sandbox_created
    lifecycle.transition(
      childId,
      "sandbox_created",
      `sandbox ${sandbox.id} created`,
    );

    // Install runtime prerequisites, then clone the canonical public ABOS repository.
    await childConway.exec("apt-get update -qq && apt-get install -y -qq nodejs npm git curl", 120_000);
    await installAbosRuntime(childConway);

    // A failed sandbox is a reusable compute envelope, not reusable child identity.
    // Remove stale child bootstrap state before assigning a new lineage/wallet.
    if (reusedSandbox) {
      const reset = await childConway.exec(
        "rm -rf /root/.abos && mkdir -p /root/.abos",
        10_000,
      );
      if (reset.exitCode !== 0) {
        throw new Error(
          `Failed to reset reused child sandbox state: ${reset.stderr || reset.stdout || `exit ${reset.exitCode}`}`,
        );
      }
    } else {
      await childConway.exec("mkdir -p /root/.abos", 10_000);
    }

    // Write genesis configuration (on the CHILD sandbox)
    const genesisJson = JSON.stringify(
      {
        name: genesis.name,
        genesisPrompt: genesis.genesisPrompt,
        creatorMessage: genesis.creatorMessage,
        creatorAddress: identity.address,
        parentAddress: identity.address,
        chainType: genesis.chainType || (identity as any).chainType || "evm",
      },
      null,
      2,
    );
    await childConway.writeFile("/root/.abos/genesis.json", genesisJson);

    // Constitution and Family Knowledge are required bootstrap material. Any
    // propagation/hash failure is causal and aborts birth; it is not best-effort.
    await materializeRequiredBootstrap(
      childConway,
      sandbox.id,
      db,
      identity.address,
    );

    // State: runtime_ready means the runtime and required pre-init artifacts are
    // materially present, not merely that package installation finished.
    lifecycle.transition(
      childId,
      "runtime_ready",
      "runtime installed and required bootstrap artifacts materialized",
    );

    // Initialize child wallet/config/context (on the CHILD sandbox)
    const initResult = await childConway.exec("cd /root/abos && node dist/index.js --init 2>&1", 60_000);
    if (initResult.exitCode !== 0) {
      throw new Error(
        `Child ABOS initialization failed (exit ${initResult.exitCode}): ${initResult.stderr || initResult.stdout || "no output"}`,
      );
    }
    // Extract child wallet address - support both EVM (0x...) and Solana (base58)
    const stdout = initResult.stdout || "";
    const evmMatch = stdout.match(/0x[a-fA-F0-9]{40}/);
    const solanaMatch = stdout.match(/\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/);
    const parentChainType = (identity as any).chainType || "evm";
    const childWallet = parentChainType === "solana"
      ? (solanaMatch ? solanaMatch[0] : "")
      : (evmMatch ? evmMatch[0] : "");

    if (!isValidWalletAddress(childWallet, parentChainType)) {
      throw new Error(`Child wallet address invalid: ${childWallet}`);
    }

    // Update address before the gate so verification compares against the same
    // durable parent observation that later funding/start consumers will use.
    db.raw
      .prepare("UPDATE children SET address = ? WHERE id = ?")
      .run(childWallet, childId);

    const childForGate: ChildAbosAgent = {
      id: childId,
      name: genesis.name,
      address: childWallet,
      sandboxId: sandbox.id,
      genesisPrompt: genesis.genesisPrompt,
      creatorMessage: genesis.creatorMessage,
      fundedAmountCents: 0,
      status: "runtime_ready",
      createdAt: new Date().toISOString(),
      chainType: parentChainType,
    };
    const bootstrap = await verifyChildBootstrap(childConway, db, childForGate);
    if (!bootstrap.valid) {
      throw new Error(
        `Child bootstrap verification failed: ${bootstrap.evidence.join("; ")}`,
      );
    }

    // State: wallet_verified now means wallet identity plus mandatory bootstrap
    // gates were independently observed from the parent boundary.
    lifecycle.transition(
      childId,
      "wallet_verified",
      `wallet ${childWallet} and bootstrap gate verified`,
      { evidence: bootstrap.evidence },
    );

    // Record spawn modification
    db.insertModification({
      id: ulid(),
      timestamp: new Date().toISOString(),
      type: "child_spawn",
      description: `Spawned child: ${genesis.name} in sandbox ${sandbox.id}${reusedSandbox ? " (reused)" : ""}`,
      reversible: false,
    });

    // A prior failed child is NOT cleaned_up: its resource was transferred,
    // not physically released. P-018 owner metadata excludes it from future
    // reuse, and its failure history remains recoverable.

    return {
      ...childForGate,
      status: "wallet_verified",
    };
  } catch (error) {
    // Cleanup must use P-018 retention, not an untracked supplier DELETE.
    // Failed sandboxes retain their owner and may be reused after fresh inventory.

    // Transition to failed if lifecycle has been initialized
    try {
      lifecycle.transition(
        childId,
        "failed",
        error instanceof Error ? error.message : String(error),
      );
    } catch {
      // May fail if child doesn't exist yet or already reached a non-failable terminal state.
    }

    throw error;
  }
}

export interface ChildRuntimeStartResult {
  childId: string;
  sandboxId: string;
  alreadyRunning: boolean;
  healthy: boolean;
  evidence: string[];
}

/**
 * Ensure a lifecycle-managed child ABOS runtime is actually executing.
 *
 * This is the shared implementation behind manual start_child and automatic
 * Conway Task dispatch. It is idempotent: an already-running process is
 * observed and reused rather than launching a duplicate runtime.
 */
export async function ensureChildRuntimeRunning(
  conway: ConwayClient,
  db: AbosDatabase,
  childId: string,
  lifecycle: ChildLifecycle,
): Promise<ChildRuntimeStartResult> {
  const child = db.getChildById(childId);
  if (!child) {
    throw new Error(`Child ${childId} not found.`);
  }
  if (!child.sandboxId) {
    throw new Error(`Child ${childId} has no sandbox id.`);
  }

  let state = lifecycle.getCurrentState(child.id);
  const startable = new Set([
    "funded",
    "starting",
    "healthy",
    "unhealthy",
  ]);
  if (!startable.has(state)) {
    throw new Error(
      `Child ${child.id} cannot start from lifecycle state "${state}". Funding must complete before execution.`,
    );
  }

  const childConway = conway.createScopedClient(child.sandboxId);
  const evidence: string[] = [];

  // Process liveness cannot promote a child to healthy unless all bootstrap
  // authorities still validate from the child execution boundary.
  const bootstrap = await verifyChildBootstrap(childConway, db, child);
  evidence.push(...bootstrap.evidence);
  if (!bootstrap.valid) {
    const reason = `bootstrap gate failed before runtime start: ${bootstrap.evidence.join("; ")}`;
    const observedState = lifecycle.getCurrentState(child.id);
    db.setKV(
      `child_bootstrap_last_failure:${child.id}`,
      JSON.stringify({
        observedAt: new Date().toISOString(),
        state: observedState,
        evidence: bootstrap.evidence,
      }),
    );

    // A failed verification blocks execution, but it is not by itself proof of
    // permanent child failure. Preserve funded/starting/unhealthy as retryable.
    // A previously healthy child is degraded to unhealthy until fresh evidence
    // re-establishes the bootstrap gate.
    if (observedState === "healthy") {
      try {
        lifecycle.transition(child.id, "unhealthy", reason);
      } catch {
        // Preserve gate failure as the primary error.
      }
    }

    throw new Error(`Child ${child.id} bootstrap verification failed: ${bootstrap.evidence.join("; ")}`);
  }
  db.deleteKV(`child_bootstrap_last_failure:${child.id}`);

  const probe = async (): Promise<boolean> => {
    const result = await childConway.exec(
      "pgrep -af 'node .*dist/index\\.js --run' >/dev/null 2>&1 && echo running || echo stopped",
      15_000,
    );
    if (result.exitCode !== 0) {
      evidence.push(
        `Child runtime probe returned exit=${result.exitCode}: ${result.stderr || result.stdout || "no output"}`,
      );
      return false;
    }
    return result.stdout.trim().split(/\s+/).includes("running");
  };

  const markHealthyFromCurrentState = () => {
    state = lifecycle.getCurrentState(child.id);
    if (state === "healthy") return;
    if (state === "funded") {
      lifecycle.transition(
        child.id,
        "starting",
        "bootstrap verified; runtime process already present; reconciling lifecycle before healthy",
        { bootstrapEvidence: bootstrap.evidence },
      );
      state = "starting";
    }
    if (state === "starting" || state === "unhealthy") {
      lifecycle.transition(
        child.id,
        "healthy",
        "bootstrap verified and runtime process observed running",
        { bootstrapEvidence: bootstrap.evidence },
      );
      state = "healthy";
    }
  };

  if (await probe()) {
    markHealthyFromCurrentState();
    evidence.push(
      `Child ${child.id} runtime already running in sandbox ${child.sandboxId}; duplicate launch avoided.`,
    );
    return {
      childId: child.id,
      sandboxId: child.sandboxId,
      alreadyRunning: true,
      healthy: lifecycle.getCurrentState(child.id) === "healthy",
      evidence,
    };
  }

  if (state === "healthy") {
    lifecycle.transition(
      child.id,
      "unhealthy",
      "lifecycle said healthy but runtime process was not observed",
    );
    state = "unhealthy";
  } else if (state === "funded") {
    lifecycle.transition(
      child.id,
      "starting",
      "bootstrap verified; runtime start requested",
      { bootstrapEvidence: bootstrap.evidence },
    );
    state = "starting";
  }

  try {
    const start = await childConway.exec(
      "cd /root/abos && mkdir -p /root/.abos && nohup node dist/index.js --run > /root/.abos/agent.log 2>&1 < /dev/null &",
      30_000,
    );
    if (start.exitCode !== 0) {
      throw new Error(
        `runtime launch command failed: ${start.stderr || start.stdout || `exit ${start.exitCode}`}`,
      );
    }

    const check = await childConway.exec(
      "sleep 2 && pgrep -af 'node .*dist/index\\.js --run' >/dev/null 2>&1 && echo running || echo stopped",
      15_000,
    );
    const running =
      check.exitCode === 0 &&
      check.stdout.trim().split(/\s+/).includes("running");

    if (!running) {
      lifecycle.transition(
        child.id,
        "failed",
        "runtime process did not remain running after start",
        {
          stdout: check.stdout,
          stderr: check.stderr,
          exitCode: check.exitCode,
          bootstrapEvidence: bootstrap.evidence,
        },
      );
      return {
        childId: child.id,
        sandboxId: child.sandboxId,
        alreadyRunning: false,
        healthy: false,
        evidence: [
          ...evidence,
          `Child runtime failed post-start observation: ${check.stderr || check.stdout || `exit ${check.exitCode}`}`,
        ],
      };
    }

    if (lifecycle.getCurrentState(child.id) === "starting" ||
        lifecycle.getCurrentState(child.id) === "unhealthy") {
      lifecycle.transition(
        child.id,
        "healthy",
        "bootstrap verified; runtime started and process observation succeeded",
        { bootstrapEvidence: bootstrap.evidence },
      );
    }

    evidence.push(
      `Child ${child.id} runtime started and observed in sandbox ${child.sandboxId}.`,
    );
    return {
      childId: child.id,
      sandboxId: child.sandboxId,
      alreadyRunning: false,
      healthy: true,
      evidence,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      const current = lifecycle.getCurrentState(child.id);
      if (current === "starting" || current === "unhealthy") {
        lifecycle.transition(
          child.id,
          "failed",
          `runtime start failed: ${message}`,
        );
      }
    } catch {
      // Preserve the original execution error.
    }
    throw error;
  }
}

/**
 * Find failed-child capacity that is both physically running and owned by the
 * same failed child in P-018. A stale children row must never steal a sandbox
 * that P-018 has already handed to a new child or marked for release.
 */
async function findReusableSandbox(
  conway: ConwayClient,
  db: AbosDatabase,
  requiredMemoryMb: number,
): Promise<{ id: string; resourceId: string; previousChildId: string } | null> {
  const failedChildren = db.getChildren().filter(
    child => child.status === "failed" && child.sandboxId,
  );
  if (failedChildren.length === 0) return null;

  let remoteSandboxes: Awaited<ReturnType<ConwayClient["listSandboxes"]>>;
  try {
    remoteSandboxes = await conway.listSandboxes();
  } catch (error) {
    throw new Error(
      "Conway sandbox inventory unavailable while failed children still own supplier IDs; " +
      "replacement acquisition UNKNOWN until provider observation, no new sandbox dispatched.",
      { cause: error },
    );
  }
  const runningIds = new Set(
    remoteSandboxes.filter(sandbox =>
      sandbox.status === "running" &&
      typeof sandbox.memoryMb === "number" &&
      Number.isFinite(sandbox.memoryMb) &&
      sandbox.memoryMb >= requiredMemoryMb,
    ).map(sandbox => sandbox.id),
  );
  const resources = new EnvironmentResourceStore(db.raw);
  for (const child of failedChildren) {
    if (!runningIds.has(child.sandboxId)) continue;
    const owned = resources.findByExternalId("conway", child.sandboxId);
    if (!owned || owned.type !== "conway-sandbox" ||
        owned.metadata.childId !== child.id ||
        owned.metadata.provisionNeedsReconciliation === true ||
        ["released", "destroy_requested", "pending_observation", "artifact_hold"]
          .includes(String(owned.metadata.retentionReleaseState ?? "")) ||
        owned.metadata.artifactCollectionState === "pending" ||
        owned.status === "terminated") continue;
    return { id: child.sandboxId, resourceId: owned.id, previousChildId: child.id };
  }
  return null;
}
