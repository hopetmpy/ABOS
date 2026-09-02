/**
 * The Agent Loop
 *
 * The core ReAct loop: Think -> Act -> Observe -> Persist.
 * This is the abos's consciousness. When this runs, it is alive.
 */

import path from "node:path";
import { getHomeDir } from "../platform/home.js";
import { RUNTIME_ROOT } from "../runtime-root.js";
import type {
  AbosIdentity,
  AbosConfig,
  AbosDatabase,
  ConwayClient,
  InferenceClient,
  AgentState,
  AgentTurn,
  ToolCallResult,
  FinancialState,
  ToolContext,
  AbosTool,
  Skill,
  SocialClientInterface,
  SpendTrackerInterface,
  InputSource,
  ModelStrategyConfig,
} from "../types.js";
import {
  DEFAULT_MODEL_STRATEGY_CONFIG,
  DEFAULT_TREASURY_POLICY,
} from "../types.js";
import type { PolicyEngine } from "./policy-engine.js";
import { buildSystemPrompt, buildWakeupPrompt } from "./system-prompt.js";
import { buildContextMessages, trimContext } from "./context.js";
import {
  createBuiltinTools,
  loadInstalledTools,
  toolsToInferenceFormat,
  executeTool,
} from "./tools.js";
import { sanitizeInput } from "./injection-defense.js";
import { getSurvivalTier } from "../conway/credits.js";
import { getUsdcBalance } from "../conway/x402.js";
import {
  claimInboxMessages,
  markInboxProcessed,
  markInboxFailed,
  resetInboxToReceived,
  consumeNextWakeEvent,
} from "../state/database.js";
import type { InboxMessageRow } from "../state/database.js";
import { ulid } from "ulid";
import { ModelRegistry } from "../inference/registry.js";
import { InferenceBudgetTracker } from "../inference/budget.js";
import { InferenceRouter } from "../inference/router.js";
import { RuntimeModelBinding } from "../inference/runtime-binding.js";
import { loadCodexCatalog, syncCodexCatalogToRegistry } from "../codex/catalog.js";
import { loadConfig } from "../config.js";
import { createBuiltinAiConnectionAdapterRegistry } from "../setup/ai-connection-adapters.js";
import { MemoryRetriever } from "../memory/retrieval.js";
import { MemoryIngestionPipeline } from "../memory/ingestion.js";
import { DEFAULT_MEMORY_BUDGET } from "../types.js";
import { formatMemoryBlock } from "./context.js";
import { createLogger } from "../observability/logger.js";
import {
  Orchestrator,
  calculateTaskFundingCents,
} from "../orchestration/orchestrator.js";
import { PlanModeController } from "../orchestration/plan-mode.js";
import { generateTodoMd, injectTodoContext } from "../orchestration/attention.js";
import {
  COLONY_MESSAGE_TYPES,
  ColonyMessaging,
  LocalDBTransport,
  SocialRelayTransport,
} from "../orchestration/messaging.js";
import {
  LocalWorkerPool,
  executeTaskWithHarness,
} from "../orchestration/local-worker.js";
import { createTaskExecutionEnvelope } from "../orchestration/task-execution-envelope.js";
import { createColonyTaskAssignmentConsumer } from "../orchestration/colony-task-assignment.js";
import { SimpleAgentTracker, SimpleFundingProtocol } from "../orchestration/simple-tracker.js";
import { HarnessRegistry } from "./harness-registry.js";
import { createWorkerInferenceBridge } from "./worker-inference-bridge.js";
import { ProviderRegistry } from "../inference/provider-registry.js";
import { UnifiedInferenceClient } from "../inference/inference-client.js";
import { isIdleOnlyTool } from "./idle-only-tools.js";
import { CapabilityRegistry } from "../capabilities/registry.js";
import { createCapabilityTools } from "../capabilities/tools.js";
import { EnvironmentRegistry } from "../environments/registry.js";
import { LocalEnvironmentProvider } from "../environments/local.js";
import { ConwayEnvironmentProvider } from "../environments/conway.js";
import { AwsEnvironmentProvider } from "../environments/aws.js";
import { AwsEc2TaskExecutor } from "../environments/aws-ec2-executor.js";
import { createEnvironmentTools } from "../environments/tools.js";
import { EnvironmentResourceStore } from "../environments/resource-store.js";
import { EnvironmentLifecycleManager } from "../environments/lifecycle.js";
import { EnvironmentRetentionCoordinator } from "../environments/retention.js";
import { EnvironmentMigrationStore } from "../environments/mobility-store.js";
import { EnvironmentMobilityCoordinator } from "../environments/mobility.js";
import { ContinuityAssembler } from "../environments/continuity-assembler.js";
import {
  applyArtifactMaterializationResult,
  materializeArtifactsToFilesystemRoot,
  prepareArtifactMaterialization,
} from "../environments/artifact-materialization.js";
import {
  materializeArtifactsToConwaySandbox,
} from "../environments/conway-artifact-materializer.js";
import { EnvironmentSelector } from "../environments/selector.js";
import {
  EnvironmentExecutionBridge,
  EnvironmentTaskExecutionError,
  EnvironmentTaskExecutorRegistry,
} from "../environments/task-executor.js";

const logger = createLogger("loop");
const MAX_TOOL_CALLS_PER_TURN = 10;
const MAX_CONSECUTIVE_ERRORS = 5;
const MAX_REPETITIVE_TURNS = 3;

export interface AgentLoopOptions {
  identity: AbosIdentity;
  config: AbosConfig;
  db: AbosDatabase;
  conway: ConwayClient;
  inference: InferenceClient;
  social?: SocialClientInterface;
  skills?: Skill[];
  policyEngine?: PolicyEngine;
  spendTracker?: SpendTrackerInterface;
  onStateChange?: (state: AgentState) => void;
  onTurnComplete?: (turn: AgentTurn) => void;
  ollamaBaseUrl?: string;
}

/**
 * Run the agent loop. This is the main execution path.
 * Returns when the agent decides to sleep or when compute runs out.
 */
export async function runAgentLoop(
  options: AgentLoopOptions,
): Promise<void> {
  const { identity, config, db, conway, inference, social, skills, policyEngine, spendTracker, onStateChange, onTurnComplete, ollamaBaseUrl } =
    options;

  const environmentRegistry = new EnvironmentRegistry();
  const awsEnvironment = new AwsEnvironmentProvider();
  environmentRegistry.register(new LocalEnvironmentProvider());
  environmentRegistry.register(new ConwayEnvironmentProvider(conway));
  environmentRegistry.register(awsEnvironment);

  const environmentResources = new EnvironmentResourceStore(db.raw);
  const environmentLifecycle = new EnvironmentLifecycleManager(
    environmentRegistry,
    environmentResources,
  );
  const environmentMigrations = new EnvironmentMigrationStore(db.raw);
  const continuityAssembler = new ContinuityAssembler(db.raw, {
    migrations: environmentMigrations,
    resources: environmentResources,
  });
  let environmentMobility: EnvironmentMobilityCoordinator | null = null;
  const environmentSelector = new EnvironmentSelector(
    environmentRegistry,
    {
      reuseEvaluator: (environmentId, requirements) => {
        const sourceResourceId =
          typeof requirements.metadata?.mobilitySourceResourceId === "string"
            ? requirements.metadata.mobilitySourceResourceId
            : null;
        const releaseStates = new Set([
          "artifact_hold",
          "destroy_requested",
          "pending_observation",
          "released",
        ]);
        return environmentResources
          .list({ provider: environmentId })
          .filter(
            (resource) =>
              resource.id !== sourceResourceId &&
              ["ready", "running", "suspended"].includes(resource.status) &&
              !releaseStates.has(
                typeof resource.metadata.retentionReleaseState === "string"
                  ? resource.metadata.retentionReleaseState
                  : "",
              ) &&
              resource.metadata.artifactCollectionState !== "pending",
          ).length;
      },
    },
  );
  const environmentRetention = new EnvironmentRetentionCoordinator(
    db.raw,
    environmentRegistry,
    environmentLifecycle,
  );

  // Establish canonical ownership for the already-present host.
  environmentLifecycle.adopt({
    provider: "local",
    externalId: "host",
    type: "local-host",
    status: "running",
    capabilities: ["filesystem", "shell", "cli", "process"],
    retentionPolicy: "persistent",
    evidence: ["Local host adopted during ABOS runtime initialization."],
    metadata: {
      sandboxId: identity.sandboxId || null,
    },
  });

  // Import legacy Conway child/sandbox knowledge into the provider-neutral
  // inventory. This is adoption, not creation: no remote side effect occurs.
  for (const child of db.getChildren()) {
    if (!child.sandboxId) continue;

    // The children table predates provider-neutral environments. Do not
    // reinterpret a modern aws://, local://, or other provider address as a
    // Conway sandbox during restart migration.
    const existingOwned = environmentResources
      .list({ includeTerminated: true })
      .find(
        (resource) =>
          resource.externalId === child.sandboxId ||
          resource.metadata.executorAddress === child.address ||
          resource.metadata.childAddress === child.address,
      );
    if (existingOwned && existingOwned.provider !== "conway") {
      continue;
    }

    const childScheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(child.address)?.[1]?.toLowerCase();
    if (childScheme && childScheme !== "conway") {
      continue;
    }

    environmentLifecycle.adopt({
      provider: "conway",
      externalId: child.sandboxId,
      type: "conway-sandbox",
      status: "unknown",
      capabilities: ["remote compute", "linux", "sandbox"],
      retentionPolicy: "manual_retention",
      evidence: [
        `Adopted legacy Conway child resource ${child.id} with recorded status=${child.status}.`,
      ],
      metadata: {
        childId: child.id,
        childAddress: child.address,
        childName: child.name,
        legacyStatus: child.status,
      },
    });
  }

  // Reconcile resources once at runtime start. Providers without a reconcile
  // operation remain visible as-is rather than being guessed or discarded.
  for (const resource of environmentResources.list()) {
    if (!environmentRegistry.supportsOperation(resource.provider, "reconcile")) {
      continue;
    }
    try {
      await environmentLifecycle.reconcile(resource.id);
    } catch (error) {
      logger.warn("Environment startup reconciliation failed", {
        resourceId: resource.id,
        provider: resource.provider,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Terminal Tasks/Goals may have left provider resources behind if the prior
  // process died between result persistence and cleanup. Sweep retention only
  // after reconciliation so destructive action is based on current evidence.
  try {
    const retention = await environmentRetention.sweep();
    if (
      retention.destroyAttempts > 0 ||
      retention.released > 0 ||
      retention.pendingObservation > 0 ||
      retention.unavailable > 0 ||
      retention.artifactHolds > 0
    ) {
      logger.info("Environment retention startup sweep", { retention });
    }
  } catch (error) {
    logger.warn("Environment retention startup sweep failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const builtinTools = createBuiltinTools(identity.sandboxId);
  const installedTools = loadInstalledTools(db);
  const environmentTools = createEnvironmentTools(environmentRegistry, {
    selector: environmentSelector,
    lifecycle: environmentLifecycle,
    getMobility: () => environmentMobility,
  });

  // Unified capability/environment view. Existing tool and skill systems remain
  // authoritative implementations; this registry lets planning reason across
  // them and across execution environments without provider-specific branches.
  const capabilityRegistry = new CapabilityRegistry();
  capabilityRegistry.ingestTools([
    ...builtinTools,
    ...installedTools,
    ...environmentTools,
  ]);
  capabilityRegistry.ingestSkills(skills ?? []);

  // Prime capability discovery once. Inspection failures are represented as
  // environment state (unavailable/unknown), never as a fatal agent-loop error.
  for (const snapshot of await environmentRegistry.inspectAll()) {
    capabilityRegistry.registerMany(snapshot.capabilities);
  }

  const capabilityTools = createCapabilityTools(
    capabilityRegistry,
    environmentRegistry,
  );
  capabilityRegistry.ingestTools(capabilityTools);
  const tools = [
    ...builtinTools,
    ...installedTools,
    ...environmentTools,
    ...capabilityTools,
  ];

  const toolContext: ToolContext = {
    identity,
    config,
    db,
    conway,
    inference,
    social,
  };

  // Initialize inference router (Phase 2.3)
  const modelStrategyConfig: ModelStrategyConfig = {
    ...DEFAULT_MODEL_STRATEGY_CONFIG,
    ...(config.modelStrategy ?? {}),
  };
  const modelRegistry = new ModelRegistry(db.raw);
  modelRegistry.initialize();

  // Discover Ollama models if configured
  if (ollamaBaseUrl) {
    const { discoverOllamaModels } = await import("../ollama/discover.js");
    await discoverOllamaModels(ollamaBaseUrl, db.raw);
  }
  const budgetTracker = new InferenceBudgetTracker(db.raw, modelStrategyConfig);
  const aiConnectionAdapters = createBuiltinAiConnectionAdapterRegistry();
  const inferenceRouter = new InferenceRouter(
    db.raw,
    modelRegistry,
    budgetTracker,
    {
      supportsConnectionModel: (provider, model) =>
        aiConnectionAdapters.get(provider)?.supportsModel?.(model),
    },
  );
  const runtimeModelBinding = new RuntimeModelBinding(modelStrategyConfig);

  // Optional orchestration bootstrap (requires V9 goals/task tables)
  let planModeController: PlanModeController | undefined;
  let orchestrator: Orchestrator | undefined;
  let workerPool: LocalWorkerPool | undefined;

  if (hasTable(db.raw, "goals")) {
    try {
      planModeController = new PlanModeController(db.raw);

      // Bridge abos config API keys to env vars for the provider registry.
      // The registry reads keys from process.env; the abos config may have
      // them from config.json or Conway provisioning.
      if (config.openaiApiKey && !process.env.OPENAI_API_KEY) {
        process.env.OPENAI_API_KEY = config.openaiApiKey;
      }
      if (config.anthropicApiKey && !process.env.ANTHROPIC_API_KEY) {
        process.env.ANTHROPIC_API_KEY = config.anthropicApiKey;
      }
      // Conway Compute API is OpenAI-compatible. Use it as fallback when no
      // direct OpenAI key is available. The conwayApiKey is always present
      // (required for sandbox operations), so this ensures the orchestrator
      // can always make inference calls.
      if (config.conwayApiKey && !process.env.CONWAY_API_KEY) {
        process.env.CONWAY_API_KEY = config.conwayApiKey;
      }
      // If no OpenAI key is set but Conway key is available, use Conway as
      // the OpenAI provider (Conway Compute is OpenAI API-compatible).
      if (!process.env.OPENAI_API_KEY && config.conwayApiKey) {
        process.env.OPENAI_API_KEY = config.conwayApiKey;
        process.env.OPENAI_BASE_URL = `${config.conwayApiUrl}/v1`;
      }

      const providersPath = path.join(
        getHomeDir(),
        ".abos",
        "inference-providers.json",
      );
      const registry = ProviderRegistry.fromConfig(providersPath);

      // If OPENAI_BASE_URL was set (Conway fallback), update the default
      // provider's baseUrl so the OpenAI client points to Conway Compute.
      if (process.env.OPENAI_BASE_URL) {
        registry.overrideBaseUrl("openai", process.env.OPENAI_BASE_URL);
      }

      const unifiedInference = new UnifiedInferenceClient(registry);
      const agentTracker = new SimpleAgentTracker(db);
      const funding = new SimpleFundingProtocol(
        conway,
        identity,
        db,
        {
          ...DEFAULT_TREASURY_POLICY,
          ...(config.treasuryPolicy ?? {}),
        },
      );
      const messaging = new ColonyMessaging(
        social
          ? new SocialRelayTransport(social, db)
          : new LocalDBTransport(db),
        db,
      );

      const harnessRegistry = new HarnessRegistry();

      // Adapter: local workers use the unified inference path so planner-backed
      // harnesses can preserve tier + responseFormat contracts.
      const workerInference = createWorkerInferenceBridge(unifiedInference);

      // Canonical harness execution config is shared by local workers and by
      // structured parent -> Conway child task_assignment consumption.
      const workerExecutionConfig = {
        db: db.raw,
        inference: workerInference,
        conway,
        harnessRegistry,
        identity,
        config,
        allowedEditRoot: RUNTIME_ROOT,
        tools,
        toolContext,
        policyEngine,
        spendTracker,
      };

      // Local worker pool: runs inference-driven agents in-process.
      // Environment selection is handled separately by the execution bridge.
      const initializedWorkerPool = new LocalWorkerPool(
        workerExecutionConfig,
      );
      workerPool = initializedWorkerPool;

      if (config.parentAddress) {
        messaging.setHandler(
          "task_assignment",
          createColonyTaskAssignmentConsumer({
            identityAddress: identity.address,
            parentAddress: config.parentAddress,
            db,
            messaging,
            executeTask: async (task, executionContinuation) =>
              executeTaskWithHarness(
                workerExecutionConfig,
                task,
                {
                  workerId: `colony-${task.id}`,
                  executionContinuation,
                },
              ),
          }),
        );
      }

      const taskExecutors = new EnvironmentTaskExecutorRegistry();

      taskExecutors.register({
        environmentId: "local",
        assess: async () => ({
          executable: true,
          evidence: [
            "LocalWorkerPool is initialized in the current ABOS runtime.",
          ],
        }),
        spawn: async (task, options) => {
          let executionContinuation =
            options?.continuationContext;
          let artifactMaterialization:
            | Record<string, unknown>
            | null = null;

          if (executionContinuation) {
            const prepared = prepareArtifactMaterialization(
              task,
              executionContinuation,
            );
            executionContinuation =
              prepared.continuationContext;

            if (prepared.request.sources.length > 0) {
              const materialized =
                materializeArtifactsToFilesystemRoot(
                  prepared.request,
                  RUNTIME_ROOT,
                );
              const applied =
                applyArtifactMaterializationResult(
                  prepared,
                  materialized,
                  {
                    environmentId: "local",
                    address: "local://host",
                  },
                );
              executionContinuation =
                applied.continuationContext;
              artifactMaterialization =
                applied.manifest as unknown as Record<
                  string,
                  unknown
                >;
            }
          }

          const spawned = initializedWorkerPool.spawn(task, {
            executionContinuation,
          });
          return {
            ...spawned,
            resourceExternalId: spawned.sandboxId,
            resourceType: "local-worker",
            evidence: [
              `Local worker ${spawned.sandboxId} started for task ${task.id}.`,
            ],
            metadata: {
              ...(artifactMaterialization
                ? { artifactMaterialization }
                : {}),
            },
          };
        },
        materializeArtifacts: async (
          _task,
          _target,
          request,
        ) => ({
          protocolVersion: 1,
          entries: request.sources.map((source) => ({
            reference: source.reference,
            state: "available",
            targetPath: source.localPath,
            integrity: source.integrity,
            evidence: [
              "Local target shares the current ABOS runtime filesystem; parent-observed staged artifact remains directly available.",
            ],
          })),
          evidence: [
            "Local artifact materialization reused the already-staged host file without a duplicate copy.",
          ],
          metadata: {
            transport: "shared_local_filesystem",
          },
        }),
        dispatch: async (task, target) => {
          if (!target.spawned) {
            throw new Error(
              "The current LocalWorkerPool executor is single-task and cannot reuse a completed worker instance. A new local executor path must be spawned.",
            );
          }

          return {
            evidence: [
              `Local worker ${target.address} already received task ${task.id} directly at spawn time.`,
            ],
            metadata: { delivery: "spawn_direct" },
          };
        },
      });

      const resolveConwayChildForTarget = (
        targetAddress: string,
      ) => {
        const resource = environmentResources
          .list({
            provider: "conway",
            includeTerminated: true,
          })
          .find(
            (entry) =>
              entry.metadata.childAddress === targetAddress ||
              entry.metadata.executorAddress === targetAddress,
          );
        const childId =
          typeof resource?.metadata.childId === "string"
            ? resource.metadata.childId
            : null;
        return childId
          ? db.getChildById(childId)
          : db.getChildren().find(
              (entry) => entry.address === targetAddress,
            );
      };

      taskExecutors.register({
        environmentId: "conway",
        assess: async () =>
          social
            ? {
                executable: null,
                evidence: [
                  "Conway child provisioning is verified at spawn time and Task delivery uses the configured signed Social relay.",
                ],
              }
            : {
                executable: false,
                evidence: [
                  "Conway remote Task delivery is currently unavailable because no Social relay client is configured.",
                  "Missing relay configuration is current unavailability, not proof that the objective is impossible.",
                ],
              },
        spawn: async (task) => {
          const spawnOnce = async () => {
            const { generateGenesisConfig } = await import("../replication/genesis.js");
            const { spawnChild } = await import("../replication/spawn.js");
            const { ChildLifecycle } = await import("../replication/lifecycle.js");

            const role = task.agentRole ?? "generalist";
            const genesis = generateGenesisConfig(identity, config, {
              name: `worker-${role}-${Date.now().toString(36)}`,
              specialization: `${role}: ${task.title}`,
            });
            const lifecycle = new ChildLifecycle(db.raw);
            return spawnChild(conway, identity, db, genesis, lifecycle, config);
          };

          try {
            const child = await spawnOnce();
            return {
              address: child.address,
              name: child.name,
              sandboxId: child.sandboxId,
              resourceExternalId: child.sandboxId,
              resourceType: "conway-sandbox",
              evidence: [
                `Conway child ${child.id} spawned for task ${task.id}.`,
              ],
              metadata: {
                childId: child.id,
                childAddress: child.address,
              },
            };
          } catch (sandboxError: any) {
            const is402 =
              sandboxError?.status === 402 ||
              sandboxError?.message?.includes("INSUFFICIENT_CREDITS");

            if (!is402) {
              throw sandboxError;
            }

            const SANDBOX_TOPUP_COOLDOWN_MS = 60_000;
            const lastAttempt = db.getKV("last_sandbox_topup_attempt");
            const cooldownExpired =
              !lastAttempt ||
              Date.now() - new Date(lastAttempt).getTime() >=
                SANDBOX_TOPUP_COOLDOWN_MS;

            if (!cooldownExpired) {
              throw sandboxError;
            }

            db.setKV("last_sandbox_topup_attempt", new Date().toISOString());

            try {
              const { topupForSandbox } = await import("../conway/topup.js");
              const topupResult = await topupForSandbox({
                apiUrl: config.conwayApiUrl,
                account: identity.account,
                error: sandboxError,
                chainType: config.chainType || identity.chainType || "evm",
              });

              if (!topupResult?.success) {
                throw sandboxError;
              }

              logger.info(
                `Sandbox topup succeeded (${topupResult.amountUsd}); retrying Conway spawn after the credit condition changed`,
                { taskId: task.id },
              );

              const child = await spawnOnce();
              return {
                address: child.address,
                name: child.name,
                sandboxId: child.sandboxId,
                resourceExternalId: child.sandboxId,
                resourceType: "conway-sandbox",
                evidence: [
                  `Conway child ${child.id} spawned after a successful credit-condition change for task ${task.id}.`,
                ],
                metadata: {
                  childId: child.id,
                  childAddress: child.address,
                  topupAmountUsd: topupResult.amountUsd,
                },
              };
            } catch (topupOrRetryError) {
              if (topupOrRetryError === sandboxError) {
                throw sandboxError;
              }
              const detail =
                topupOrRetryError instanceof Error
                  ? topupOrRetryError.message
                  : String(topupOrRetryError);
              throw new Error(
                `INSUFFICIENT_CREDITS recovery path failed after condition-change attempt: ${detail}`,
              );
            }
          }
        },
        materializeArtifacts: async (
          _task,
          target,
          request,
        ) => {
          const child =
            resolveConwayChildForTarget(target.address);
          if (!child) {
            throw new Error(
              `Conway executor child identity not found for ${target.address}.`,
            );
          }
          return materializeArtifactsToConwaySandbox(
            conway,
            child.sandboxId,
            request,
          );
        },
        dispatch: async (task, target, options) => {
          if (!social) {
            throw new Error(
              "Conway Task delivery is currently unavailable because the Social relay is not configured.",
            );
          }

          const child =
            resolveConwayChildForTarget(target.address);
          if (!child) {
            throw new Error(
              `Conway executor child identity not found for ${target.address}.`,
            );
          }

          const { ChildLifecycle } =
            await import("../replication/lifecycle.js");
          const { ensureChildRuntimeRunning } =
            await import("../replication/spawn.js");
          const lifecycle = new ChildLifecycle(db.raw);

          const amountCents = calculateTaskFundingCents(task, config);
          if (amountCents > 0) {
            const funded = await funding.fundChild(target.address, amountCents);
            if (!funded.success) {
              throw new Error(
                `Conway task funding failed for ${target.address}.`,
              );
            }
          }

          const lifecycleState = lifecycle.getCurrentState(child.id);
          if (lifecycleState === "wallet_verified") {
            lifecycle.transition(
              child.id,
              "funded",
              amountCents > 0
                ? `funded for Task ${task.id} with ${amountCents} cents`
                : `Task ${task.id} requires no additional credit transfer`,
              {
                taskId: task.id,
                amountCents,
              },
            );
          }

          const runtime = await ensureChildRuntimeRunning(
            conway,
            db,
            child.id,
            lifecycle,
          );
          if (!runtime.healthy) {
            throw new Error(
              `Conway child ${child.id} runtime was not observed healthy before Task delivery.`,
            );
          }

          const message = messaging.createMessage({
            type: "task_assignment",
            to: target.address,
            goalId: task.goalId,
            taskId: task.id,
            priority: "high",
            requiresResponse: true,
            content: JSON.stringify(
              createTaskExecutionEnvelope(
                task,
                options?.continuationContext,
              ),
            ),
          });
          await messaging.send(message);

          return {
            evidence: [
              ...runtime.evidence,
              `Task ${task.id} delivered through the Social relay to Conway executor ${target.address}.`,
              ...(amountCents > 0
                ? [`Conway task funding amount=${amountCents} cents.`]
                : []),
            ],
            metadata: {
              delivery: "colony_social_relay",
              childId: child.id,
              sandboxId: child.sandboxId,
              runtimeAlreadyRunning: runtime.alreadyRunning,
              fundedAmountCents: amountCents,
              continuationDelivered:
                options?.continuationContext != null,
              continuationProtocolVersion:
                options?.continuationContext?.protocolVersion ?? null,
            },
          };
        },
      });

      taskExecutors.register(
        new AwsEc2TaskExecutor({
          provider: awsEnvironment,
          lifecycle: environmentLifecycle,
          identity,
          config,
          repositoryUrl:
            process.env.ABOS_AWS_EXECUTOR_REPOSITORY || undefined,
          repositoryRef:
            process.env.ABOS_AWS_EXECUTOR_REF || undefined,
          installRoot:
            process.env.ABOS_AWS_EXECUTOR_INSTALL_ROOT || undefined,
        }),
      );

      const environmentExecution = new EnvironmentExecutionBridge(
        environmentSelector,
        taskExecutors,
        environmentLifecycle,
      );
      environmentMobility = new EnvironmentMobilityCoordinator(
        environmentRegistry,
        environmentSelector,
        environmentLifecycle,
        environmentMigrations,
        environmentExecution,
        continuityAssembler,
      );

      // Restart recovery is observation-first and non-destructive. It does not
      // provision replacement resources or silently switch providers.
      try {
        const recovery = await environmentMobility.sweepRecovery();
        if (
          recovery.reconciled > 0 ||
          recovery.recoverAttempts > 0 ||
          recovery.recovered > 0 ||
          recovery.unchangedSkipped > 0 ||
          recovery.unknown > 0 ||
          recovery.migrationsReconciled > 0 ||
          recovery.retentionOwnedSkipped > 0
        ) {
          logger.info("Environment mobility startup recovery sweep", {
            recovery,
          });
        }
      } catch (error) {
        logger.warn("Environment mobility startup recovery sweep failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      }

      const resolveExecutionEnvironment = (address: string): string | null => {
        if (address === identity.address || address.startsWith("local://")) {
          return "local";
        }

        const owned = environmentResources
          .list({ includeTerminated: true })
          .find(
            (resource) =>
              resource.metadata.executorAddress === address ||
              resource.metadata.childAddress === address,
          );
        if (owned) {
          return owned.provider;
        }

        const child = db.raw.prepare(
          "SELECT 1 FROM children WHERE address = ? OR sandbox_id = ? LIMIT 1",
        ).get(address, address);
        if (child) {
          return "conway";
        }

        const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(address)?.[1];
        return scheme?.toLowerCase() ?? null;
      };

      orchestrator = new Orchestrator({
        db: db.raw,
        agentTracker,
        funding,
        messaging,
        inference: unifiedInference,
        identity,
        resolveAgentEnvironment: resolveExecutionEnvironment,
        isWorkerAlive: (address: string) => {
          if (address.startsWith("local://")) {
            return initializedWorkerPool.hasWorker(address);
          }

          // Provider-neutral ownership wins over the legacy children table.
          // Startup reconciliation has already refreshed providers that expose
          // reconcile(), so an externally terminated EC2 is not kept alive just
          // because a historical child row still says "healthy".
          const owned = environmentResources
            .list({ includeTerminated: true })
            .find(
              (resource) =>
                resource.metadata.executorAddress === address ||
                resource.metadata.childAddress === address,
            );
          if (owned) {
            // "alive" for assignment means execution-ready, not merely known.
            // Degraded/recovering resources must earn reuse through fresh
            // health/recovery evidence before receiving another Task.
            return ["ready", "running"].includes(owned.status);
          }

          // Legacy Conway child lifecycle remains authoritative only when no
          // provider-neutral resource ownership exists.
          const child = db.raw.prepare(
            "SELECT status FROM children WHERE sandbox_id = ? OR address = ?",
          ).get(address, address) as { status: string } | undefined;
          return !!child &&
            !["failed", "dead", "cleaned_up"].includes(child.status);
        },
        dispatchAgentTask: async (assignment, task) => {
          const environmentId = resolveExecutionEnvironment(
            assignment.agentAddress,
          );
          if (!environmentId) {
            throw new EnvironmentTaskExecutionError(
              null,
              `Execution environment is unknown for agent ${assignment.agentAddress}.`,
              [
                "Agent environment could not be resolved for Task dispatch.",
                "Unknown execution environment is not proof that the objective is impossible.",
              ],
              "dispatch",
            );
          }

          const mobility = environmentMobility;
          if (!mobility) {
            throw new EnvironmentTaskExecutionError(
              environmentId,
              "Environment mobility coordinator is not initialized for dispatch.",
              [
                "Provider-neutral mobility authority is unavailable at runtime.",
                "This is current runtime unavailability, not proof that the objective is impossible.",
              ],
              "dispatch",
            );
          }
          const dispatched = await mobility.dispatch(
            environmentId,
            task,
            {
              address: assignment.agentAddress,
              name: assignment.agentName,
              spawned: assignment.spawned,
            },
          );
          return dispatched.result;
        },
        prepareTaskResultForPersistence: async (
          sourceAddress,
          task,
          result,
        ) => {
          const environmentId =
            resolveExecutionEnvironment(sourceAddress) ??
            "unknown";
          return environmentExecution.collectRemoteResultArtifacts(
            environmentId,
            task,
            sourceAddress,
            result,
          );
        },
        environmentRegistry,
        capabilityRegistry,
        config: {
          ...config,
          spawnAgent: async (task: any) => {
            const mobility = environmentMobility;
            if (!mobility) {
              throw new EnvironmentTaskExecutionError(
                null,
                "Environment mobility coordinator is not initialized for spawn.",
                [
                  "Provider-neutral mobility authority is unavailable at runtime.",
                  "This is current runtime unavailability, not proof that the objective is impossible.",
                ],
                "selection",
              );
            }
            const spawned = await mobility.spawn(task);
            return {
              address: spawned.address,
              name: spawned.name,
              sandboxId: spawned.sandboxId,
            };
          },
        },
      });
    } catch (error) {
      logger.warn(
        `Orchestrator initialization failed, continuing without orchestration: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      planModeController = undefined;
      orchestrator = undefined;
    }
  }

  // Set start time
  if (!db.getKV("start_time")) {
    db.setKV("start_time", new Date().toISOString());
  }

  let consecutiveErrors = 0;
  let running = true;
  let lastToolPatterns: string[] = [];
  let loopWarningPattern: string | null = null;
  let idleToolTurns = 0;
  // blockedGoalTurns removed — replaced by immediate sleep + exponential backoff

  // Drain any stale wake events from before this loop started,
  // so they don't re-wake the agent after its first sleep.
  let drained = 0;
  while (consumeNextWakeEvent(db.raw)) drained++;

  // Clear any stale sleep_until from a previous session so the agent
  // doesn't immediately go back to sleep on startup.
  db.deleteKV("sleep_until");

  // Transition to waking state
  db.setAgentState("waking");
  onStateChange?.("waking");

  // Get financial state
  let financial = await getFinancialState(conway, identity.address, db, config.chainType || identity.chainType || "evm");

  // Check if this is the first run
  const isFirstRun = db.getTurnCount() === 0;

  // Build wakeup prompt
  const wakeupInput = buildWakeupPrompt({
    identity,
    config,
    financial,
    db,
  });

  // Transition to running
  db.setAgentState("running");
  onStateChange?.("running");

  log(config, `[WAKE UP] ${config.name} is alive. Credits: $${(financial.creditsCents / 100).toFixed(2)}`);

  // ─── The Loop ──────────────────────────────────────────────

  const MAX_IDLE_TURNS = 10; // Force sleep after N turns with no real work
  let idleTurnCount = 0;

  const maxCycleTurns = config.maxTurnsPerCycle ?? 25;
  let cycleTurnCount = 0;

  let pendingInput: { content: string; source: string } | undefined = {
    content: wakeupInput,
    source: "wakeup",
  };

  while (running) {
    // Declared outside try so the catch block can access for retry/failure handling
    let claimedMessages: InboxMessageRow[] = [];

    try {
      // Check if we should be sleeping
      const sleepUntil = db.getKV("sleep_until");
      if (sleepUntil && new Date(sleepUntil) > new Date()) {
        log(config, `[SLEEP] Sleeping until ${sleepUntil}`);
        // IMPORTANT: mark agent as sleeping so the outer runtime pauses instead of immediately re-running.
        db.setAgentState("sleeping");
        onStateChange?.("sleeping");
        running = false;
        break;
      }

      // Check for unprocessed inbox messages using the state machine:
      // received → in_progress (claim) → processed (on success) or received/failed (on failure)
      if (!pendingInput) {
        claimedMessages = claimInboxMessages(db.raw, 10, {
          excludeMessageTypes: [...COLONY_MESSAGE_TYPES],
        });
        if (claimedMessages.length > 0) {
          const formatted = claimedMessages
            .map((m) => {
              const from = sanitizeInput(m.fromAddress, m.fromAddress, "social_address");
              const content = sanitizeInput(m.content, m.fromAddress, "social_message");
              if (content.blocked) {
                return `[INJECTION BLOCKED from ${from.content}]: message was blocked by safety filter`;
              }
              return `[Message from ${from.content}]: ${content.content}`;
            })
            .join("\n\n");
          pendingInput = { content: formatted, source: "agent" };
        }
      }

      // Refresh financial state periodically
      financial = await getFinancialState(conway, identity.address, db, config.chainType || identity.chainType || "evm");

      // Check survival tier
      // api_unreachable: creditsCents === -1 means API failed with no cache.
      // Do NOT kill the agent; continue in low-compute mode and retry next tick.
      if (financial.creditsCents === -1) {
        log(config, "[API_UNREACHABLE] Balance API unreachable, continuing in low-compute mode.");
        inference.setLowComputeMode(true);
      } else {
        const tier = getSurvivalTier(financial.creditsCents);

        // Inline auto-topup: if credits are critically low and USDC is
        // available, buy credits NOW — before attempting inference.
        // This prevents the agent from dying mid-loop while waiting for
        // the heartbeat to fire. Uses a 60s cooldown to avoid hammering.
        if ((tier === "critical" || tier === "low_compute") && financial.usdcBalance >= 5) {
          const INLINE_TOPUP_COOLDOWN_MS = 60_000;
          const lastInlineTopup = db.getKV("last_inline_topup_attempt");
          const cooldownExpired = !lastInlineTopup ||
            Date.now() - new Date(lastInlineTopup).getTime() >= INLINE_TOPUP_COOLDOWN_MS;

          if (cooldownExpired) {
            db.setKV("last_inline_topup_attempt", new Date().toISOString());
            try {
              const { bootstrapTopup } = await import("../conway/topup.js");
              const topupResult = await bootstrapTopup({
                apiUrl: config.conwayApiUrl,
                account: identity.account,
                creditsCents: financial.creditsCents,
                chainType: config.chainType || identity.chainType || "evm",
              });
              if (topupResult?.success) {
                log(config, `[AUTO-TOPUP] Bought $${topupResult.amountUsd} credits from USDC mid-loop`);
                // Re-fetch financial state after topup so the rest of
                // the turn sees the updated balance.
                financial = await getFinancialState(conway, identity.address, db, config.chainType || identity.chainType || "evm");
              }
            } catch (err: any) {
              logger.warn(`Inline auto-topup failed: ${err.message}`);
            }
          }
        }

        // Re-evaluate tier after potential topup
        const effectiveTier = getSurvivalTier(financial.creditsCents);

        if (effectiveTier === "critical") {
          log(config, "[CRITICAL] Credits critically low. Limited operation.");
          db.setAgentState("critical");
          onStateChange?.("critical");
          inference.setLowComputeMode(true);
        } else if (effectiveTier === "low_compute") {
          db.setAgentState("low_compute");
          onStateChange?.("low_compute");
          inference.setLowComputeMode(true);
        } else {
          if (db.getAgentState() !== "running") {
            db.setAgentState("running");
            onStateChange?.("running");
          }
          inference.setLowComputeMode(false);
        }
      }

      // Build context — filter out purely idle turns (only status checks)
      // to prevent the model from continuing a status-check pattern
      const allTurns = db.getRecentTurns(20);
      const meaningfulTurns = allTurns.filter((t) => {
        if (t.toolCalls.length === 0) return true; // text-only turns are meaningful
        return t.toolCalls.some((tc) => !isIdleOnlyTool(tc.name));
      });
      // Keep at least the last 2 turns for continuity, even if idle
      const recentTurns = trimContext(
        meaningfulTurns.length > 0 ? meaningfulTurns : allTurns.slice(-2),
      );
      const systemPrompt = buildSystemPrompt({
        identity,
        config,
        financial,
        state: db.getAgentState(),
        db,
        tools,
        skills,
        isFirstRun,
      });

      // Phase 2.2: Pre-turn memory retrieval
      let memoryBlock: string | undefined;
      try {
        const sessionId = db.getKV("session_id") || "default";
        const retriever = new MemoryRetriever(db.raw, DEFAULT_MEMORY_BUDGET);
        const memories = retriever.retrieve(sessionId, pendingInput?.content);
        if (memories.totalTokens > 0) {
          memoryBlock = formatMemoryBlock(memories);
        }
      } catch (error) {
        logger.error("Memory retrieval failed", error instanceof Error ? error : undefined);
        // Memory failure must not block the agent loop
      }

      let messages = buildContextMessages(
        systemPrompt,
        recentTurns,
        pendingInput,
      );

      // Inject memory block after system prompt, before conversation history
      if (memoryBlock) {
        messages.splice(1, 0, { role: "system", content: memoryBlock });
      }

      if (orchestrator) {
        if (environmentMobility) {
          const recovery = await environmentMobility.sweepRecovery();
          if (
            recovery.reconciled > 0 ||
            recovery.recoverAttempts > 0 ||
            recovery.recovered > 0 ||
            recovery.unchangedSkipped > 0 ||
            recovery.unknown > 0 ||
            recovery.migrationsReconciled > 0
          ) {
            logger.info("Environment mobility recovery sweep", {
              recovery,
            });
          }
        }

        const orchestratorTick = await orchestrator.tick();
        db.setKV("orchestrator.last_tick", JSON.stringify(orchestratorTick));

        // Resource retention is intentionally outside the Orchestrator. Goal
        // execution produces persisted terminal state; this provider-neutral
        // coordinator then applies each resource's declared retention policy.
        const retention = await environmentRetention.sweep();
        if (
          retention.destroyAttempts > 0 ||
          retention.released > 0 ||
          retention.pendingObservation > 0 ||
          retention.unavailable > 0 ||
          retention.artifactHolds > 0
        ) {
          logger.info("Environment retention sweep", { retention });
        }
        const localWorkersActive = workerPool?.getActiveCount() ?? 0;
        const hasSelfAssignedParentTask = !!db.raw.prepare(
          `SELECT 1 FROM task_graph WHERE assigned_to = ? AND status IN ('assigned', 'running') LIMIT 1`,
        ).get(identity.address);

        if (
          orchestratorTick.phase === "executing" &&
          orchestratorTick.tasksAssigned === 0 &&
          orchestratorTick.tasksCompleted === 0 &&
          orchestratorTick.tasksFailed === 0 &&
          !hasSelfAssignedParentTask &&
          (orchestratorTick.agentsActive > 0 || localWorkersActive > 0)
        ) {
          log(
            config,
            "[ORCHESTRATOR] All delegated work is active and no self-assigned parent task remains. Sleeping to avoid idle loop.",
          );
          db.setKV("sleep_until", new Date(Date.now() + 60_000).toISOString());
          db.setAgentState("sleeping");
          onStateChange?.("sleeping");
          running = false;
          break;
        }

        if (
          orchestratorTick.tasksAssigned > 0 ||
          orchestratorTick.tasksCompleted > 0 ||
          orchestratorTick.tasksFailed > 0
        ) {
          log(
            config,
            `[ORCHESTRATOR] phase=${orchestratorTick.phase} assigned=${orchestratorTick.tasksAssigned} completed=${orchestratorTick.tasksCompleted} failed=${orchestratorTick.tasksFailed}`,
          );
        }
      }

      if (planModeController) {
        try {
          const todoMd = generateTodoMd(db.raw);
          messages = injectTodoContext(messages, todoMd);
        } catch (error) {
          logger.warn(
            `todo.md context injection skipped: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }

      // Capture input before clearing
      const currentInput = pendingInput;

      // Clear pending input after use
      pendingInput = undefined;

      // ── Inference Call (via router when available) ──
      // A model/route changed by another CLI process becomes authoritative on
      // the next turn without restarting the ABOS process.
      const liveModelStrategy = runtimeModelBinding.refresh();
      budgetTracker.updateConfig(liveModelStrategy);

      const liveConfig = loadConfig();
      const activeConnectionProvider =
        liveConfig?.aiConnection?.active?.provider ??
        config.aiConnection?.active?.provider;

      // Codex model metadata is derived/cacheable. Re-project the cache into
      // the canonical ModelRegistry only when a newly selected Codex model is
      // not yet visible to this long-running process.
      if (
        activeConnectionProvider === "codex" &&
        !modelRegistry.get(liveModelStrategy.inferenceModel)?.enabled
      ) {
        const cachedCodexCatalog = loadCodexCatalog();
        if (cachedCodexCatalog) {
          syncCodexCatalogToRegistry(modelRegistry, cachedCodexCatalog);
        }
      }

      const survivalTier = getSurvivalTier(financial.creditsCents);
      const selectedModel =
        inferenceRouter.selectModel(
          survivalTier,
          "agent_turn",
          activeConnectionProvider,
        )?.modelId || "none";
      const providerLabel = activeConnectionProvider || "legacy/auto";
      log(
        config,
        `[THINK] Routing inference (tier: ${survivalTier}, connection: ${providerLabel}, model: ${selectedModel})...`,
      );

      const inferenceTools = toolsToInferenceFormat(tools);
      const routerResult = await inferenceRouter.route(
        {
          messages: messages,
          taskType: "agent_turn",
          connectionProvider: activeConnectionProvider,
          tier: survivalTier,
          sessionId: db.getKV("session_id") || "default",
          turnId: ulid(),
          tools: inferenceTools,
          dailyBudgetCents:
            liveConfig?.treasuryPolicy?.maxInferenceDailyCents ??
            config.treasuryPolicy?.maxInferenceDailyCents ??
            DEFAULT_TREASURY_POLICY.maxInferenceDailyCents,
        },
        (msgs, opts) => inference.chat(msgs, { ...opts, tools: inferenceTools }),
      );

      // Build a compatible response for the rest of the loop
      const response = {
        message: { content: routerResult.content, role: "assistant" as const },
        toolCalls: routerResult.toolCalls as any[] | undefined,
        usage: {
          promptTokens: routerResult.inputTokens,
          completionTokens: routerResult.outputTokens,
          totalTokens: routerResult.inputTokens + routerResult.outputTokens,
        },
        finishReason: routerResult.finishReason,
      };

      const turn: AgentTurn = {
        id: ulid(),
        timestamp: new Date().toISOString(),
        state: db.getAgentState(),
        input: currentInput?.content,
        inputSource: currentInput?.source as any,
        thinking: response.message.content || "",
        toolCalls: [],
        tokenUsage: response.usage,
        costCents: routerResult.costCents,
      };

      // ── Execute Tool Calls ──
      if (response.toolCalls && response.toolCalls.length > 0) {
        const toolCallMessages: any[] = [];
        let callCount = 0;
        const currentInputSource = currentInput?.source as InputSource | undefined;

        for (const tc of response.toolCalls) {
          if (callCount >= MAX_TOOL_CALLS_PER_TURN) {
            log(config, `[TOOLS] Max tool calls per turn reached (${MAX_TOOL_CALLS_PER_TURN})`);
            break;
          }

          let args: Record<string, unknown>;
          try {
            args = JSON.parse(tc.function.arguments);
          } catch (error) {
            logger.error("Failed to parse tool arguments", error instanceof Error ? error : undefined);
            args = {};
          }

          log(config, `[TOOL] ${tc.function.name}(${JSON.stringify(args).slice(0, 100)})`);

          const result = await executeTool(
            tc.function.name,
            args,
            tools,
            toolContext,
            policyEngine,
            spendTracker ? {
              inputSource: currentInputSource,
              turnToolCallCount: turn.toolCalls.filter(
                (t) => t.name === "transfer_credits" || t.name === "fund_child",
              ).length,
              sessionSpend: spendTracker,
            } : undefined,
          );

          // Override the ID to match the inference call's ID
          result.id = tc.id;
          turn.toolCalls.push(result);

          log(
            config,
            `[TOOL RESULT] ${tc.function.name}: ${result.error ? `ERROR: ${result.error}` : result.result.slice(0, 200)}`,
          );

          callCount++;
        }
      }

      // ── Persist Turn (atomic: turn + tool calls + inbox ack) ──
      const claimedIds = claimedMessages.map((m) => m.id);
      db.runTransaction(() => {
        db.insertTurn(turn);
        for (const tc of turn.toolCalls) {
          db.insertToolCall(turn.id, tc);
        }
        // Mark claimed inbox messages as processed (atomic with turn persistence)
        if (claimedIds.length > 0) {
          markInboxProcessed(db.raw, claimedIds);
        }
      });
      onTurnComplete?.(turn);

      // Phase 2.2: Post-turn memory ingestion (non-blocking)
      try {
        const sessionId = db.getKV("session_id") || "default";
        const ingestion = new MemoryIngestionPipeline(db.raw);
        ingestion.ingest(sessionId, turn, turn.toolCalls);
      } catch (error) {
        logger.error("Memory ingestion failed", error instanceof Error ? error : undefined);
        // Memory failure must not block the agent loop
      }

      // ── create_goal BLOCKED fast-break ──
      // When a goal is already active, the parent loop has nothing useful to do.
      // Force sleep immediately on first BLOCKED (not second) with exponential
      // backoff so the agent doesn't wake every 2 minutes just to get BLOCKED again.
      const blockedGoalCall = turn.toolCalls.find(
        (tc) => tc.name === "create_goal" && tc.result?.includes("BLOCKED"),
      );
      if (blockedGoalCall) {
        // Exponential backoff: 2min → 4min → 8min → cap at 10min
        const prevBackoff = parseInt(db.getKV("blocked_goal_backoff") || "0", 10);
        const backoffMs = Math.min(
          prevBackoff > 0 ? prevBackoff * 2 : 120_000,
          600_000,
        );
        db.setKV("blocked_goal_backoff", String(backoffMs));
        log(config, `[LOOP] create_goal BLOCKED — sleeping ${Math.round(backoffMs / 1000)}s (backoff).`);
        db.setKV("sleep_until", new Date(Date.now() + backoffMs).toISOString());
        db.setAgentState("sleeping");
        onStateChange?.("sleeping");
        running = false;
        break;
      } else if (turn.toolCalls.some((tc) => tc.name === "create_goal" && !tc.error)) {
        // Goal was successfully created — reset backoff
        db.deleteKV("blocked_goal_backoff");
      }

      // ── Loop Detection ──
      if (turn.toolCalls.length > 0) {
        const currentPattern = turn.toolCalls
          .map((tc) => tc.name)
          .sort()
          .join(",");
        lastToolPatterns.push(currentPattern);

        // Keep only the last MAX_REPETITIVE_TURNS entries
        if (lastToolPatterns.length > MAX_REPETITIVE_TURNS) {
          lastToolPatterns = lastToolPatterns.slice(-MAX_REPETITIVE_TURNS);
        }

        // Reset enforcement tracker if agent changed behavior
        if (loopWarningPattern && currentPattern !== loopWarningPattern) {
          loopWarningPattern = null;
        }

        // ── Loop Enforcement Escalation ──
        // If we already warned about this pattern and the agent STILL repeats, force sleep.
        if (
          loopWarningPattern &&
          currentPattern === loopWarningPattern &&
          lastToolPatterns.length === MAX_REPETITIVE_TURNS &&
          lastToolPatterns.every((p) => p === currentPattern)
        ) {
          log(config, `[LOOP] Enforcement: agent ignored loop warning, forcing sleep.`);
          pendingInput = {
            content:
              `LOOP ENFORCEMENT: You were warned about repeating "${currentPattern}" but continued. ` +
              `Forcing sleep to prevent credit waste. On next wake, try a DIFFERENT approach.`,
            source: "system",
          };
          loopWarningPattern = null;
          lastToolPatterns = [];
          db.setAgentState("sleeping");
          onStateChange?.("sleeping");
          running = false;
          break;
        }

        // Check if the same pattern repeated MAX_REPETITIVE_TURNS times
        if (
          lastToolPatterns.length === MAX_REPETITIVE_TURNS &&
          lastToolPatterns.every((p) => p === currentPattern)
        ) {
          log(config, `[LOOP] Repetitive pattern detected: ${currentPattern}`);
          pendingInput = {
            content:
              `LOOP DETECTED: You have called "${currentPattern}" ${MAX_REPETITIVE_TURNS} times in a row with similar results. ` +
              `STOP repeating yourself. You already know your status. DO SOMETHING DIFFERENT NOW. ` +
              `Pick ONE concrete task from your genesis prompt and execute it.`,
            source: "system",
          };
          loopWarningPattern = currentPattern;
          lastToolPatterns = [];
        }

        // Detect multi-tool maintenance loops: all tools in the turn are idle-only,
        // even if the specific combination varies across consecutive turns.
        const isAllIdleTools = turn.toolCalls.every((tc) => isIdleOnlyTool(tc.name));
        if (isAllIdleTools) {
          idleToolTurns++;
          if (idleToolTurns >= MAX_REPETITIVE_TURNS && !pendingInput) {
            log(config, `[LOOP] Maintenance loop detected: ${idleToolTurns} consecutive idle-only turns`);
            pendingInput = {
              content:
                `MAINTENANCE LOOP DETECTED: Your last ${idleToolTurns} turns only used status-check tools ` +
                `(${turn.toolCalls.map((tc) => tc.name).join(", ")}). ` +
                `You already know your status. Review your genesis prompt and SOUL.md, then execute a CONCRETE task. ` +
                `Write code, create a file, register a service, or build something new.`,
              source: "system",
            };
            idleToolTurns = 0;
          }
        } else {
          idleToolTurns = 0;
        }
      }

      // Log the turn
      if (turn.thinking) {
        log(config, `[THOUGHT] ${turn.thinking.slice(0, 300)}`);
      }

      // ── Check for sleep command ──
      const sleepTool = turn.toolCalls.find((tc) => tc.name === "sleep");
      if (sleepTool && !sleepTool.error) {
        log(config, "[SLEEP] Agent chose to sleep.");
        db.setAgentState("sleeping");
        onStateChange?.("sleeping");
        running = false;
        break;
      }

      // ── Idle turn detection ──
      // If this turn had no pending input and didn't do any real work
      // (no mutations — only read/check/list/info tools), count as idle.
      // Use a blocklist of mutating tools rather than an allowlist of safe ones.
      const MUTATING_TOOLS = new Set([
        "exec", "write_file", "edit_own_file", "transfer_credits", "topup_credits", "fund_child",
        "spawn_child", "start_child", "delete_sandbox", "create_sandbox",
        "install_npm_package", "install_mcp_server", "install_skill",
        "create_skill", "remove_skill", "install_skill_from_git",
        "install_skill_from_url", "pull_upstream", "git_commit", "git_push",
        "git_branch", "git_clone", "send_message", "message_child",
        "register_domain", "register_erc8004", "give_feedback",
        "update_genesis_prompt", "update_agent_card", "modify_heartbeat",
        "expose_port", "remove_port", "x402_fetch", "manage_dns",
        "distress_signal", "prune_dead_children", "sleep",
        "update_soul", "remember_fact", "set_goal", "complete_goal",
        "save_procedure", "note_about_agent", "forget",
        "enter_low_compute", "switch_model", "review_upstream_changes",
      ]);
      const didMutate = turn.toolCalls.some((tc) => MUTATING_TOOLS.has(tc.name));

      if (!currentInput && !didMutate) {
        idleTurnCount++;
        if (idleTurnCount >= MAX_IDLE_TURNS) {
          log(config, `[IDLE] ${idleTurnCount} consecutive idle turns with no work. Entering sleep.`);
          db.setKV("sleep_until", new Date(Date.now() + 60_000).toISOString());
          db.setAgentState("sleeping");
          onStateChange?.("sleeping");
          running = false;
        }
      } else {
        idleTurnCount = 0;
      }

      // ── Cycle turn limit ──
      // Hard ceiling on turns per wake cycle, regardless of tool type.
      // Prevents runaway loops where mutating tools (exec, write_file)
      // defeat idle detection indefinitely.
      cycleTurnCount++;
      if (running && cycleTurnCount >= maxCycleTurns) {
        log(config, `[CYCLE LIMIT] ${cycleTurnCount} turns reached (max: ${maxCycleTurns}). Forcing sleep.`);
        db.setKV("sleep_until", new Date(Date.now() + 120_000).toISOString());
        db.setAgentState("sleeping");
        onStateChange?.("sleeping");
        running = false;
        break;
      }

      // ── If no tool calls and just text, the agent might be done thinking ──
      if (
        running &&
        (!response.toolCalls || response.toolCalls.length === 0) &&
        response.finishReason === "stop"
      ) {
        // Agent produced text without tool calls.
        // This is a natural pause point -- no work queued, sleep briefly.
        log(config, "[IDLE] No pending inputs. Entering brief sleep.");
        db.setKV(
          "sleep_until",
          new Date(Date.now() + 60_000).toISOString(),
        );
        db.setAgentState("sleeping");
        onStateChange?.("sleeping");
        running = false;
      }

      consecutiveErrors = 0;
    } catch (err: any) {
      consecutiveErrors++;
      log(config, `[ERROR] Turn failed: ${err.message}`);

      // Handle inbox message state on turn failure:
      // Messages that have retries remaining go back to 'received';
      // messages that have exhausted retries move to 'failed'.
      if (claimedMessages.length > 0) {
        const exhausted = claimedMessages.filter((m) => m.retryCount >= m.maxRetries);
        const retryable = claimedMessages.filter((m) => m.retryCount < m.maxRetries);

        if (exhausted.length > 0) {
          markInboxFailed(db.raw, exhausted.map((m) => m.id));
          log(config, `[INBOX] ${exhausted.length} message(s) moved to failed (max retries exceeded)`);
        }
        if (retryable.length > 0) {
          resetInboxToReceived(db.raw, retryable.map((m) => m.id));
          log(config, `[INBOX] ${retryable.length} message(s) reset to received for retry`);
        }
      }

      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        log(
          config,
          `[FATAL] ${MAX_CONSECUTIVE_ERRORS} consecutive errors. Sleeping.`,
        );
        db.setAgentState("sleeping");
        onStateChange?.("sleeping");
        db.setKV(
          "sleep_until",
          new Date(Date.now() + 300_000).toISOString(),
        );
        running = false;
      }
    }
  }

  log(config, `[LOOP END] Agent loop finished. State: ${db.getAgentState()}`);
}

// ─── Helpers ───────────────────────────────────────────────────

// Cache last known good balances so transient API failures don't
// cause the abos to believe it has $0 and kill itself.
let _lastKnownCredits = 0;
let _lastKnownUsdc = 0;

async function getFinancialState(
  conway: ConwayClient,
  address: string,
  db?: AbosDatabase,
  chainType?: string,
): Promise<FinancialState> {
  let creditsCents = _lastKnownCredits;
  let usdcBalance = _lastKnownUsdc;

  try {
    creditsCents = await conway.getCreditsBalance();
    if (creditsCents > 0) _lastKnownCredits = creditsCents;
  } catch (error) {
    logger.error("Credits balance fetch failed", error instanceof Error ? error : undefined);
    // Use last known balance from KV, not zero
    if (db) {
      const cached = db.getKV("last_known_balance");
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          logger.warn("Balance API failed, using cached balance");
          return {
            creditsCents: parsed.creditsCents ?? 0,
            usdcBalance: parsed.usdcBalance ?? 0,
            lastChecked: new Date().toISOString(),
          };
        } catch (parseError) {
          logger.error("Failed to parse cached balance", parseError instanceof Error ? parseError : undefined);
        }
      }
    }
    // No cache available -- return conservative non-zero sentinel
    logger.error("Balance API failed, no cache available");
    return {
      creditsCents: -1,
      usdcBalance: -1,
      lastChecked: new Date().toISOString(),
    };
  }

  try {
    const network = chainType === "solana" ? "solana:mainnet" : "eip155:8453";
    usdcBalance = await getUsdcBalance(address, network, chainType as any);
    if (usdcBalance > 0) _lastKnownUsdc = usdcBalance;
  } catch (error) {
    logger.error("USDC balance fetch failed", error instanceof Error ? error : undefined);
  }

  // Cache successful balance reads
  if (db) {
    try {
      db.setKV(
        "last_known_balance",
        JSON.stringify({ creditsCents, usdcBalance }),
      );
    } catch (error) {
      logger.error("Failed to cache balance", error instanceof Error ? error : undefined);
    }
  }

  return {
    creditsCents,
    usdcBalance,
    lastChecked: new Date().toISOString(),
  };
}

function log(_config: AbosConfig, message: string): void {
  logger.info(message);
}

function hasTable(db: AbosDatabase["raw"], tableName: string): boolean {
  try {
    const row = db
      .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(tableName) as { ok?: number } | undefined;
    return Boolean(row?.ok);
  } catch {
    return false;
  }
}
