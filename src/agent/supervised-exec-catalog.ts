export const SUPERVISED_EXECUTION_OPERATIONS = [
  "node_check",
  "typescript_check",
  "typescript_build",
  "vitest",
] as const;

export type SupervisedExecutionOperation =
  (typeof SUPERVISED_EXECUTION_OPERATIONS)[number];

export interface SupervisedOperationDefinition {
  name: SupervisedExecutionOperation;
  description: string;
  timeoutSeconds: number;
  memoryMiB: number;
  maxProcesses: number;
  writesOnlyToEphemeralCopy: boolean;
}

const OPERATION_DEFINITIONS: Record<
  SupervisedExecutionOperation,
  SupervisedOperationDefinition
> = {
  node_check: {
    name: "node_check",
    description:
      "Check the syntax of one JavaScript file without executing it.",
    timeoutSeconds: 15,
    memoryMiB: 2048,
    maxProcesses: 8,
    writesOnlyToEphemeralCopy: true,
  },
  typescript_check: {
    name: "typescript_check",
    description:
      "Run the TypeScript compiler with --noEmit against tsconfig.json.",
    timeoutSeconds: 60,
    memoryMiB: 4096,
    maxProcesses: 32,
    writesOnlyToEphemeralCopy: true,
  },
  typescript_build: {
    name: "typescript_build",
    description:
      "Run the TypeScript compiler inside an ephemeral project copy.",
    timeoutSeconds: 90,
    memoryMiB: 4096,
    maxProcesses: 32,
    writesOnlyToEphemeralCopy: true,
  },
  vitest: {
    name: "vitest",
    description:
      "Run Vitest inside an ephemeral project copy with no network.",
    timeoutSeconds: 120,
    memoryMiB: 768,
    maxProcesses: 48,
    writesOnlyToEphemeralCopy: true,
  },
};

export function getRequiredSupervisedOperations(
  taskContent: string,
): SupervisedExecutionOperation[] {
  return SUPERVISED_EXECUTION_OPERATIONS.filter(
    (operation) =>
      new RegExp(
        "\\b" + operation + "\\b",
        "i",
      ).test(taskContent),
  );
}

export function isSupervisedExecutionOperation(
  value: unknown,
): value is SupervisedExecutionOperation {
  return (
    typeof value === "string" &&
    SUPERVISED_EXECUTION_OPERATIONS.includes(
      value as SupervisedExecutionOperation,
    )
  );
}

export function getSupervisedOperationDefinition(
  operation: SupervisedExecutionOperation,
): SupervisedOperationDefinition {
  return OPERATION_DEFINITIONS[operation];
}
