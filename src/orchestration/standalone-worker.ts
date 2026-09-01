/**
 * Standalone one-shot Task execution.
 *
 * This entry point is transport-neutral. It exists so any remote environment
 * (AWS EC2 today, another VM/container tomorrow) can execute the canonical ABOS
 * worker harness and return a TaskResult without embedding provider logic into
 * the harness or Orchestrator.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { getHomeDir } from "../platform/home.js";
import { RUNTIME_ROOT } from "../runtime-root.js";
import { loadConfig, resolvePath } from "../config.js";
import {
  getWallet,
} from "../identity/wallet.js";
import { loadApiKeyFromConfig } from "../identity/provision.js";
import { bootstrapFromGenesisIfPresent } from "../setup/genesis-bootstrap.js";
import { createDatabase, getTaskById } from "../state/database.js";
import { createConwayClient } from "../conway/client.js";
import { createInferenceClient } from "../conway/inference.js";
import { ModelRegistry } from "../inference/registry.js";
import { ProviderRegistry } from "../inference/provider-registry.js";
import { UnifiedInferenceClient } from "../inference/inference-client.js";
import { createWorkerInferenceBridge } from "../agent/worker-inference-bridge.js";
import { HarnessRegistry } from "../agent/harness-registry.js";
import {
  createBuiltinTools,
  loadInstalledTools,
} from "../agent/tools.js";
import { PolicyEngine } from "../agent/policy-engine.js";
import { SpendTracker } from "../agent/spend-tracker.js";
import { createDefaultRules } from "../agent/policy-rules/index.js";
import { createSocialClient } from "../social/client.js";
import {
  DEFAULT_TREASURY_POLICY,
  type AbosIdentity,
  type SocialClientInterface,
  type ToolContext,
} from "../types.js";
import {
  completeTask,
  createGoal,
  decomposeGoal,
  failTask,
  type TaskNode,
  type TaskResult,
} from "./task-graph.js";
import { executeTaskWithHarness } from "./local-worker.js";
import type { ExecutionContinuationContext } from "../environments/continuity.js";
import {
  parseTaskExecutionPayload,
  type ParsedTaskExecutionPayload,
} from "./task-execution-envelope.js";

export interface StandaloneTaskExecutionOptions {
  executionContinuation?: ExecutionContinuationContext;
}

export type ParsedStandaloneTaskExecutionPayload =
  ParsedTaskExecutionPayload;

export async function executeStandaloneTaskFile(
  filePath: string,
): Promise<TaskResult> {
  const payload = JSON.parse(
    await fs.readFile(filePath, "utf8"),
  ) as unknown;
  const parsed = parseStandaloneTaskExecutionPayload(payload);
  return executeStandaloneTask(parsed.task, {
    executionContinuation: parsed.executionContinuation,
  });
}

export async function executeStandaloneTask(
  incomingTask: TaskNode,
  options: StandaloneTaskExecutionOptions = {},
): Promise<TaskResult> {
  const bootstrapped = await bootstrapFromGenesisIfPresent();
  const config = loadConfig() ?? bootstrapped;
  if (!config) {
    throw new Error(
      "Standalone Task execution requires an existing ABOS config or a valid ~/.abos/genesis.json bootstrap payload.",
    );
  }

  const {
    account,
    chainIdentity,
    chainType: walletChainType,
  } = await getWallet(config.chainType);
  const resolvedChainType =
    config.chainType || walletChainType || "evm";
  const apiKey =
    config.conwayApiKey ||
    loadApiKeyFromConfig();
  if (!apiKey) {
    throw new Error(
      "Standalone Task execution has no usable Conway API key after bootstrap.",
    );
  }

  const db = createDatabase(resolvePath(config.dbPath));

  try {
    const createdAt =
      db.getIdentity("createdAt") ||
      new Date().toISOString();
    if (!db.getIdentity("createdAt")) {
      db.setIdentity("createdAt", createdAt);
    }

    const identity: AbosIdentity = {
      name: config.name,
      address: chainIdentity.address,
      account,
      creatorAddress: config.creatorAddress,
      sandboxId: config.sandboxId,
      apiKey,
      createdAt,
      chainType: resolvedChainType,
      chainIdentity,
    };

    const conway = createConwayClient({
      apiUrl: config.conwayApiUrl,
      apiKey,
      sandboxId: config.sandboxId,
    });

    const modelRegistry = new ModelRegistry(db.raw);
    modelRegistry.initialize();

    const ollamaBaseUrl =
      process.env.OLLAMA_BASE_URL ||
      config.ollamaBaseUrl;

    const directInference = createInferenceClient({
      apiUrl: config.conwayApiUrl,
      apiKey,
      defaultModel: config.inferenceModel,
      maxTokens: config.maxTokensPerTurn,
      lowComputeModel:
        config.modelStrategy?.lowComputeModel ||
        "gpt-5-mini",
      openaiApiKey: config.openaiApiKey,
      anthropicApiKey: config.anthropicApiKey,
      ollamaBaseUrl,
      getModelProvider: (modelId) =>
        modelRegistry.get(modelId)?.provider,
    });

    // Match the normal agent-loop provider setup. A freshly provisioned ABOS
    // worker always has Conway authorization after genesis bootstrap, so Conway
    // remains a usable OpenAI-compatible fallback without embedding credentials
    // in the EC2 resource record or Task payload.
    if (
      config.openaiApiKey &&
      !process.env.OPENAI_API_KEY
    ) {
      process.env.OPENAI_API_KEY =
        config.openaiApiKey;
    }
    if (
      config.anthropicApiKey &&
      !process.env.ANTHROPIC_API_KEY
    ) {
      process.env.ANTHROPIC_API_KEY =
        config.anthropicApiKey;
    }
    if (
      config.conwayApiKey &&
      !process.env.CONWAY_API_KEY
    ) {
      process.env.CONWAY_API_KEY =
        config.conwayApiKey;
    }
    if (
      !process.env.OPENAI_API_KEY &&
      config.conwayApiKey
    ) {
      process.env.OPENAI_API_KEY =
        config.conwayApiKey;
      process.env.OPENAI_BASE_URL =
        `${config.conwayApiUrl}/v1`;
    }

    const providersPath = path.join(
      getHomeDir(),
      ".abos",
      "inference-providers.json",
    );
    const providerRegistry =
      ProviderRegistry.fromConfig(providersPath);
    if (process.env.OPENAI_BASE_URL) {
      providerRegistry.overrideBaseUrl(
        "openai",
        process.env.OPENAI_BASE_URL,
      );
    }

    const unifiedInference =
      new UnifiedInferenceClient(providerRegistry);
    const workerInference =
      createWorkerInferenceBridge(unifiedInference);

    let social: SocialClientInterface | undefined;
    if (config.socialRelayUrl) {
      social = createSocialClient(
        config.socialRelayUrl,
        resolvedChainType === "solana"
          ? chainIdentity
          : account,
      );
    }

    const builtinTools =
      createBuiltinTools(identity.sandboxId);
    const installedTools =
      loadInstalledTools(db);
    const tools = [
      ...builtinTools,
      ...installedTools,
    ];

    const toolContext: ToolContext = {
      identity,
      config,
      db,
      conway,
      inference: directInference,
      social,
    };

    const treasuryPolicy =
      config.treasuryPolicy ??
      DEFAULT_TREASURY_POLICY;
    const policyEngine = new PolicyEngine(
      db.raw,
      createDefaultRules(treasuryPolicy),
    );
    const spendTracker =
      new SpendTracker(db.raw);

    const mirrorTask =
      createLocalMirrorTask(db.raw, incomingTask);

    const result = await executeTaskWithHarness(
      {
        db: db.raw,
        inference: workerInference,
        conway,
        harnessRegistry: new HarnessRegistry(),
        identity,
        config,
        allowedEditRoot: RUNTIME_ROOT,
        tools,
        toolContext,
        policyEngine,
        spendTracker,
        inputSource: "agent",
      },
      mirrorTask,
      {
        workerId:
          `remote-${incomingTask.id}`,
        executionContinuation:
          options.executionContinuation,
      },
    );

    if (result.success) {
      completeTask(
        db.raw,
        mirrorTask.id,
        result,
      );
    } else {
      failTask(
        db.raw,
        mirrorTask.id,
        result.output ||
          "Remote Task reported failure.",
        false,
      );
    }

    return result;
  } finally {
    db.close();
  }
}

function createLocalMirrorTask(
  db: import("better-sqlite3").Database,
  incoming: TaskNode,
): TaskNode {
  const harnessId =
    new HarnessRegistry().getHarnessIdForRole(
      incoming.agentRole,
    );
  if (harnessId === "orchestrator") {
    throw new Error(
      "The current standalone remote worker does not yet execute orchestrator-harness tasks because that harness requires a live delegated-worker scheduler. This execution capability is currently unavailable in one-shot mode; the objective is not classified as impossible.",
    );
  }

  const goal = createGoal(
    db,
    `Remote mirror: ${incoming.title}`,
    incoming.description,
    `Provider-neutral remote execution mirror for parent task ${incoming.id}`,
  );

  const [taskId] = decomposeGoal(
    db,
    goal.id,
    [
      {
        parentId: null,
        goalId: goal.id,
        title: incoming.title,
        description: incoming.description,
        status: "pending",
        assignedTo: null,
        agentRole: incoming.agentRole,
        priority: incoming.priority,
        dependencies: [],
        result: null,
        metadata: {
          estimatedCostCents:
            incoming.metadata.estimatedCostCents,
          maxRetries: 0,
          timeoutMs:
            incoming.metadata.timeoutMs,
        },
      },
    ],
  );

  const row = getTaskById(db, taskId);
  if (!row) {
    throw new Error(
      `Failed to materialize remote mirror Task for ${incoming.id}.`,
    );
  }

  return {
    id: row.id,
    parentId: row.parentId,
    goalId: row.goalId,
    title: row.title,
    description: row.description,
    status: row.status,
    assignedTo: row.assignedTo,
    agentRole: row.agentRole,
    priority: row.priority,
    dependencies: row.dependencies,
    result: null,
    requiredCapabilities:
      incoming.requiredCapabilities ?? [],
    preferredEnvironment: "local",
    strategicPathId:
      incoming.strategicPathId ?? null,
    metadata: {
      estimatedCostCents:
        row.estimatedCostCents,
      actualCostCents:
        row.actualCostCents,
      maxRetries: row.maxRetries,
      retryCount: row.retryCount,
      timeoutMs: row.timeoutMs,
      createdAt: row.createdAt,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
    },
  };
}

export function parseStandaloneTaskExecutionPayload(
  value: unknown,
): ParsedStandaloneTaskExecutionPayload {
  return parseTaskExecutionPayload(value, {
    allowBareTask: true,
    errorPrefix: "Standalone",
  });
}
