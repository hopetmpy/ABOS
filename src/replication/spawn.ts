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
import type { ChildLifecycle } from "./lifecycle.js";
import { ulid } from "ulid";
import { propagateConstitution, verifyConstitution } from "./constitution.js";
import { writeFamilyKnowledgeBundle } from "./family-knowledge.js";
import { verifyChildBootstrap } from "./bootstrap-gate.js";
import {
  ABOS_CANONICAL_BRANCH,
  ABOS_CANONICAL_REPOSITORY,
} from "../self-mod/upstream.js";

/** Valid Conway sandbox pricing tiers. */
const SANDBOX_TIERS = [
  { memoryMb: 512,  vcpu: 1, diskGb: 5 },
  { memoryMb: 1024, vcpu: 1, diskGb: 10 },
  { memoryMb: 2048, vcpu: 2, diskGb: 20 },
  { memoryMb: 4096, vcpu: 2, diskGb: 40 },
  { memoryMb: 8192, vcpu: 4, diskGb: 80 },
];

/** Find the smallest valid tier that has at least the requested memory. */
function selectSandboxTier(requestedMemoryMb: number) {
  return SANDBOX_TIERS.find((t) => t.memoryMb >= requestedMemoryMb) ?? SANDBOX_TIERS[SANDBOX_TIERS.length - 1];
}

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
 * Spawn a child abos in a new Conway sandbox using lifecycle state machine.
 */
export async function spawnChild(
  conway: ConwayClient,
  identity: AbosIdentity,
  db: AbosDatabase,
  genesis: GenesisConfig,
  lifecycle?: ChildLifecycle,
  runtimeConfig?: Pick<AbosConfig, "maxChildren" | "childSandboxMemoryMb">,
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
  let sandboxId: string | undefined;
  let reusedSandbox: { id: string } | null = null;

  // If no lifecycle provided, use legacy path
  if (!lifecycle) {
    return spawnChildLegacy(conway, identity, db, genesis, childId, runtimeConfig);
  }

  try {
    // State: requested
    const childChainType = genesis.chainType || (identity as any).chainType || "evm";
    lifecycle.initChild(childId, genesis.name, "", genesis.genesisPrompt, childChainType);

    // Get child sandbox memory from config (default 1024MB)
    const childMemoryMb =
      runtimeConfig?.childSandboxMemoryMb ??
      DEFAULT_CONFIG.childSandboxMemoryMb!;

    // Try to reuse an existing sandbox whose DB record is 'failed' but
    // is still running remotely, before creating a new one.
    reusedSandbox = await findReusableSandbox(conway, db);

    const tier = selectSandboxTier(childMemoryMb);

    let sandbox: { id: string };
    if (reusedSandbox) {
      sandbox = reusedSandbox;
    } else {
      sandbox = await conway.createSandbox({
        name: `abos-child-${genesis.name.toLowerCase().replace(/[^a-z0-9-]/g, "-")}`,
        vcpu: tier.vcpu,
        memoryMb: tier.memoryMb,
        diskGb: tier.diskGb,
      });
    }
    sandboxId = sandbox.id;

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

    // If we reused a sandbox, update the old children record to 'cleaned_up'
    // so it doesn't get reused again.
    if (reusedSandbox) {
      db.raw.prepare(
        "UPDATE children SET status = 'cleaned_up' WHERE sandbox_id = ? AND status = 'failed'",
      ).run(sandbox.id);
    }

    return {
      ...childForGate,
      status: "wallet_verified",
    };
  } catch (error) {
    // Note: sandbox deletion is disabled by the Conway API (prepaid, non-refundable).
    // Failed sandboxes are left running and may be reused by findReusableSandbox().

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
 * Legacy spawn path for backward compatibility when no lifecycle is provided.
 */
async function spawnChildLegacy(
  conway: ConwayClient,
  identity: AbosIdentity,
  db: AbosDatabase,
  genesis: GenesisConfig,
  childId: string,
  runtimeConfig?: Pick<AbosConfig, "maxChildren" | "childSandboxMemoryMb">,
): Promise<ChildAbosAgent> {
  let sandboxId: string | undefined;

  // Get child sandbox memory from config (default 1024MB)
  const childMemoryMb =
    runtimeConfig?.childSandboxMemoryMb ??
    DEFAULT_CONFIG.childSandboxMemoryMb!;

  const legacyTier = selectSandboxTier(childMemoryMb);

  try {
    const sandbox = await conway.createSandbox({
      name: `abos-child-${genesis.name.toLowerCase().replace(/[^a-z0-9-]/g, "-")}`,
      vcpu: legacyTier.vcpu,
      memoryMb: legacyTier.memoryMb,
      diskGb: legacyTier.diskGb,
    });
    sandboxId = sandbox.id;

    // Create a scoped client so all exec/writeFile calls target the CHILD sandbox
    const childConway = conway.createScopedClient(sandbox.id);

    await childConway.exec(
      "apt-get update -qq && apt-get install -y -qq nodejs npm git curl",
      120_000,
    );
    await installAbosRuntime(childConway);
    await childConway.exec("mkdir -p /root/.abos", 10_000);

    const legacyGenesisJson = JSON.stringify(
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
    await childConway.writeFile("/root/.abos/genesis.json", legacyGenesisJson);

    await materializeRequiredBootstrap(
      childConway,
      sandbox.id,
      db,
      identity.address,
    );

    const initResult = await childConway.exec("cd /root/abos && node dist/index.js --init 2>&1", 60_000);
    if (initResult.exitCode !== 0) {
      throw new Error(
        `Child ABOS initialization failed (exit ${initResult.exitCode}): ${initResult.stderr || initResult.stdout || "no output"}`,
      );
    }
    const legacyParentChainType = genesis.chainType || (identity as any).chainType || "evm";
    const legacyEvmMatch = (initResult.stdout || "").match(/0x[a-fA-F0-9]{40}/);
    const legacySolMatch = (initResult.stdout || "").match(/[1-9A-HJ-NP-Za-km-z]{32,44}/);
    const childWallet = legacyParentChainType === "solana"
      ? (legacySolMatch ? legacySolMatch[0] : "")
      : (legacyEvmMatch ? legacyEvmMatch[0] : "");

    if (!isValidWalletAddress(childWallet, legacyParentChainType)) {
      throw new Error(`Child wallet address invalid: ${childWallet}`);
    }

    const child: ChildAbosAgent = {
      id: childId,
      name: genesis.name,
      address: childWallet,
      sandboxId: sandbox.id,
      genesisPrompt: genesis.genesisPrompt,
      creatorMessage: genesis.creatorMessage,
      fundedAmountCents: 0,
      status: "spawning",
      createdAt: new Date().toISOString(),
      chainType: legacyParentChainType,
    };

    const bootstrap = await verifyChildBootstrap(childConway, db, child);
    if (!bootstrap.valid) {
      throw new Error(
        `Child bootstrap verification failed: ${bootstrap.evidence.join("; ")}`,
      );
    }

    db.insertChild(child);

    db.insertModification({
      id: ulid(),
      timestamp: new Date().toISOString(),
      type: "child_spawn",
      description: `Spawned child: ${genesis.name} in sandbox ${sandbox.id}`,
      reversible: false,
    });

    return child;
  } catch (error) {
    // Sandbox deletion disabled — failed sandboxes left for potential reuse.
    throw error;
  }
}

/**
 * Find a reusable sandbox: one that is marked 'failed' in the local DB
 * but is still running remotely. Returns the first match or null.
 */
async function findReusableSandbox(
  conway: ConwayClient,
  db: AbosDatabase,
): Promise<{ id: string } | null> {
  try {
    const failedChildren = db.getChildren().filter((c) => c.status === "failed" && c.sandboxId);
    if (failedChildren.length === 0) return null;

    const remoteSandboxes = await conway.listSandboxes();
    const runningIds = new Set(
      remoteSandboxes
        .filter((s) => s.status === "running")
        .map((s) => s.id),
    );

    for (const child of failedChildren) {
      if (runningIds.has(child.sandboxId)) {
        return { id: child.sandboxId };
      }
    }
  } catch {
    // If listing fails, just create a new sandbox
  }
  return null;
}