import type { AbosDatabase } from "../types.js";
import type { TaskNode, TaskResult } from "./task-graph.js";
import type {
  AgentMessage,
  ColonyMessageHandler,
  ColonyMessaging,
} from "./messaging.js";
import {
  parseTaskExecutionPayload,
} from "./task-execution-envelope.js";
import type { ExecutionContinuationContext } from "../environments/continuity.js";

const RECEIPT_VERSION = 1 as const;
const RECEIPT_PREFIX = "colony.task_assignment.receipt.";

interface StartedReceipt {
  version: typeof RECEIPT_VERSION;
  state: "started";
  assignmentMessageId: string;
  goalId: string;
  taskId: string;
  pathId: string | null;
  startedAt: string;
}

interface ResultReceipt {
  version: typeof RECEIPT_VERSION;
  state: "result";
  assignmentMessageId: string;
  goalId: string;
  taskId: string;
  pathId: string | null;
  startedAt: string;
  finishedAt: string;
  resultMessage: AgentMessage;
}

type AssignmentReceipt = StartedReceipt | ResultReceipt;

export interface ColonyTaskAssignmentConsumerOptions {
  identityAddress: string;
  parentAddress: string;
  db: Pick<AbosDatabase, "getKV" | "setKV">;
  messaging: Pick<ColonyMessaging, "createMessage" | "send">;
  executeTask: (
    task: TaskNode,
    continuation?: ExecutionContinuationContext,
  ) => Promise<TaskResult>;
}

/**
 * Create the structured Conway child Task consumer.
 *
 * This is an adapter over existing authorities:
 * - ColonyMessaging owns delivery/retry.
 * - task-execution-envelope owns Task/continuation identity validation.
 * - the supplied executeTask callback owns canonical harness execution.
 * - KV stores only a transport idempotency receipt; it is not Task authority.
 */
export function createColonyTaskAssignmentConsumer(
  options: ColonyTaskAssignmentConsumerOptions,
): ColonyMessageHandler {
  return async (message) => {
    authorizeAssignment(message, options);

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(message.content);
    } catch {
      throw new Error("Conway task_assignment content is not valid JSON.");
    }

    const parsed = parseTaskExecutionPayload(parsedJson, {
      errorPrefix: "Conway task_assignment",
    });

    validateMessageIdentity(message, parsed.task);

    const receiptKey = RECEIPT_PREFIX + message.id;
    const stored = options.db.getKV(receiptKey);
    if (stored) {
      const receipt = parseReceipt(stored, message, parsed.task);
      if (receipt.state === "result") {
        await options.messaging.send(receipt.resultMessage);
        return;
      }

      const interrupted = createInterruptedResult(
        message,
        parsed.task,
        options.messaging,
        receipt.startedAt,
      );
      options.db.setKV(
        receiptKey,
        JSON.stringify({
          ...receipt,
          state: "result",
          finishedAt: new Date().toISOString(),
          resultMessage: interrupted,
        } satisfies ResultReceipt),
      );
      await options.messaging.send(interrupted);
      return;
    }

    const startedAt = new Date().toISOString();
    const startedReceipt: StartedReceipt = {
      version: RECEIPT_VERSION,
      state: "started",
      assignmentMessageId: message.id,
      goalId: parsed.task.goalId,
      taskId: parsed.task.id,
      pathId: parsed.task.strategicPathId ?? null,
      startedAt,
    };
    options.db.setKV(receiptKey, JSON.stringify(startedReceipt));

    const executionStartedAt = Date.now();
    let result: TaskResult;
    try {
      result = await options.executeTask(
        parsed.task,
        parsed.executionContinuation,
      );
    } catch (error) {
      result = {
        success: false,
        output:
          `Conway child Task execution failed before producing a TaskResult: ${error instanceof Error ? error.message : String(error)}`,
        artifacts: [],
        costCents: 0,
        duration: Math.max(0, Date.now() - executionStartedAt),
      };
    }

    const resultMessage = createResultMessage(
      message,
      parsed.task,
      result,
      options.messaging,
    );
    const resultReceipt: ResultReceipt = {
      ...startedReceipt,
      state: "result",
      finishedAt: new Date().toISOString(),
      resultMessage,
    };
    options.db.setKV(receiptKey, JSON.stringify(resultReceipt));

    // If transport delivery fails after execution, ColonyMessaging will retry.
    // A later inbox retry finds the durable result receipt and resends without
    // executing the Task a second time.
    await options.messaging.send(resultMessage);
  };
}

function authorizeAssignment(
  message: AgentMessage,
  options: Pick<
    ColonyTaskAssignmentConsumerOptions,
    "identityAddress" | "parentAddress"
  >,
): void {
  if (!sameAgentAddress(message.to, options.identityAddress)) {
    throw new Error(
      `Conway task_assignment recipient mismatch: expected ${options.identityAddress}, received ${message.to}.`,
    );
  }

  if (!sameAgentAddress(message.from, options.parentAddress)) {
    throw new Error(
      `Conway task_assignment sender is not the configured parent: expected ${options.parentAddress}, received ${message.from}.`,
    );
  }
}

function validateMessageIdentity(
  message: AgentMessage,
  task: TaskNode,
): void {
  if (message.goalId != null && message.goalId !== task.goalId) {
    throw new Error(
      `Conway task_assignment Goal mismatch: message=${message.goalId}, envelope=${task.goalId}.`,
    );
  }
  if (message.taskId != null && message.taskId !== task.id) {
    throw new Error(
      `Conway task_assignment Task mismatch: message=${message.taskId}, envelope=${task.id}.`,
    );
  }
}

function createResultMessage(
  assignment: AgentMessage,
  task: TaskNode,
  result: TaskResult,
  messaging: Pick<ColonyMessaging, "createMessage">,
): AgentMessage {
  return messaging.createMessage({
    type: "task_result",
    to: assignment.from,
    goalId: task.goalId,
    taskId: task.id,
    priority: "high",
    requiresResponse: false,
    content: JSON.stringify({
      taskId: task.id,
      assignmentMessageId: assignment.id,
      result,
    }),
  });
}

function createInterruptedResult(
  assignment: AgentMessage,
  task: TaskNode,
  messaging: Pick<ColonyMessaging, "createMessage">,
  startedAt: string,
): AgentMessage {
  return createResultMessage(
    assignment,
    task,
    {
      success: false,
      output:
        `A previous execution attempt for this exact assignment started at ${startedAt} but no durable TaskResult was recorded. Completion state is unknown, so ABOS refused a blind replay of the same execution path.`,
      artifacts: [],
      costCents: 0,
      duration: 0,
    },
    messaging,
  );
}

function parseReceipt(
  raw: string,
  message: AgentMessage,
  task: TaskNode,
): AssignmentReceipt {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(
      "Stored Conway task_assignment receipt is not valid JSON; refusing blind execution replay.",
    );
  }

  if (!value || typeof value !== "object") {
    throw new Error(
      "Stored Conway task_assignment receipt is invalid; refusing blind execution replay.",
    );
  }

  const candidate = value as Partial<AssignmentReceipt>;
  if (
    candidate.version !== RECEIPT_VERSION ||
    candidate.assignmentMessageId !== message.id ||
    candidate.goalId !== task.goalId ||
    candidate.taskId !== task.id ||
    candidate.pathId !== (task.strategicPathId ?? null) ||
    typeof candidate.startedAt !== "string"
  ) {
    throw new Error(
      "Stored Conway task_assignment receipt identity does not match the incoming assignment; refusing blind execution replay.",
    );
  }

  if (candidate.state === "started") {
    return candidate as StartedReceipt;
  }

  if (
    candidate.state === "result" &&
    typeof candidate.finishedAt === "string" &&
    isResultMessage(candidate.resultMessage) &&
    sameAgentAddress(candidate.resultMessage.to, message.from) &&
    candidate.resultMessage.goalId === task.goalId &&
    candidate.resultMessage.taskId === task.id
  ) {
    return candidate as ResultReceipt;
  }

  throw new Error(
    "Stored Conway task_assignment receipt has an unsupported state; refusing blind execution replay.",
  );
}

function isResultMessage(value: unknown): value is AgentMessage {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AgentMessage>;
  return (
    typeof candidate.id === "string" &&
    candidate.type === "task_result" &&
    typeof candidate.from === "string" &&
    typeof candidate.to === "string" &&
    typeof candidate.content === "string" &&
    typeof candidate.createdAt === "string"
  );
}

function sameAgentAddress(left: string, right: string): boolean {
  if (left.startsWith("0x") && right.startsWith("0x")) {
    return left.toLowerCase() === right.toLowerCase();
  }
  return left === right;
}
