import fs from "fs";
import os from "os";
import nodePath from "path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import {
  issueDelegatedPermit,
  loadValidDelegatedPermit,
} from "../agent/supervised-permit.js";
import {
  performDelegatedWrite,
} from "../agent/supervised-write.js";
import {
  issueExecutionPermit,
  loadValidExecutionPermit,
} from "../agent/supervised-exec-permit.js";
import {
  createEphemeralProject,
  createSupervisedExecutionTools,
  performSupervisedExecution,
  removeEphemeralProject,
} from "../agent/supervised-exec.js";
import {
  getRequiredSupervisedOperations,
} from "../agent/supervised-exec-catalog.js";

const originalHome = process.env.HOME;
const originalSupervisedMode =
  process.env.AUTOMATON_SUPERVISED_MODE;
const originalSupervisedLevel =
  process.env.AUTOMATON_SUPERVISED_LEVEL;
let temporaryHome = "";
let workspaceRoot = "";
let projectRoot = "";

function grantS2(): void {
  const permit = issueDelegatedPermit({
    workspacePath: "project",
    allowCreate: true,
    allowModify: true,
    maxFiles: 20,
    maxTotalBytes: 1024 * 1024,
    durationMinutes: 60,
  });
  expect(permit).not.toHaveProperty("error");
}

function grantS3(
  options: {
    maxRuns?: number;
    allowedOperations?: Array<
      "node_check" |
      "typescript_check" |
      "typescript_build" |
      "vitest"
    >;
  } = {},
): void {
  const permit = issueExecutionPermit({
    allowedOperations:
      options.allowedOperations || ["node_check"],
    maxRuns: options.maxRuns || 10,
    maxTotalSeconds: 120,
    durationMinutes: 60,
  });
  expect(permit).not.toHaveProperty("error");
}

beforeEach(() => {
  temporaryHome = fs.mkdtempSync(
    nodePath.join(os.tmpdir(), "automaton-s3-test-"),
  );
  process.env.HOME = temporaryHome;
  process.env.AUTOMATON_SUPERVISED_MODE = "1";
  process.env.AUTOMATON_SUPERVISED_LEVEL = "S3";

  workspaceRoot = nodePath.join(
    temporaryHome,
    ".automaton",
    "supervised-workspace",
  );
  projectRoot = nodePath.join(workspaceRoot, "project");

  fs.mkdirSync(projectRoot, {
    recursive: true,
    mode: 0o700,
  });

  fs.writeFileSync(
    nodePath.join(workspaceRoot, "SUPERVISED_TASK.md"),
    "Validate the delegated JavaScript project.",
    { encoding: "utf8", mode: 0o600 },
  );
});

afterEach(() => {
  process.env.HOME = originalHome;

  if (originalSupervisedMode === undefined) {
    delete process.env.AUTOMATON_SUPERVISED_MODE;
  } else {
    process.env.AUTOMATON_SUPERVISED_MODE =
      originalSupervisedMode;
  }

  if (originalSupervisedLevel === undefined) {
    delete process.env.AUTOMATON_SUPERVISED_LEVEL;
  } else {
    process.env.AUTOMATON_SUPERVISED_LEVEL =
      originalSupervisedLevel;
  }

  fs.rmSync(temporaryHome, {
    recursive: true,
    force: true,
  });
});

describe("supervised S3 Bubblewrap execution", () => {
  it("extracts only validations explicitly required by the task", () => {
    expect(
      getRequiredSupervisedOperations(
        [
          "Run typescript_check on path '.'.",
          "Then run typescript_build.",
          "Finally run vitest.",
        ].join("\n"),
      ),
    ).toEqual([
      "typescript_check",
      "typescript_build",
      "vitest",
    ]);

    expect(
      getRequiredSupervisedOperations(
        "Create a text file without validation.",
      ),
    ).toEqual([]);
  });

  it("rejects a duplicated delegated project prefix", () => {
    grantS2();
    grantS3();

    expect(
      performDelegatedWrite(
        "project/src/duplicate.ts",
        "export const duplicate = true;\n",
        workspaceRoot,
      ),
    ).toContain(
      "path must be relative to the delegated project root",
    );

    expect(
      fs.existsSync(
        nodePath.join(
          projectRoot,
          "project",
          "src",
          "duplicate.ts",
        ),
      ),
    ).toBe(false);
  });

  it("allows a bounded write, validate, correct, validate cycle", () => {
    grantS2();
    grantS3({
      allowedOperations: ["node_check"],
      maxRuns: 2,
    });

    const invalidContent =
      "function broken( {\n";
    const validContent =
      "function add(a, b) { return a + b; }\n";

    expect(
      performDelegatedWrite(
        "iterative.js",
        invalidContent,
        workspaceRoot,
      ),
    ).toContain("DELEGATED_FILE_CREATED");

    expect(
      performSupervisedExecution(
        "node_check",
        "iterative.js",
        workspaceRoot,
      ),
    ).toContain("SUPERVISED_EXECUTION_FAILED");

    const beforeCorrection = loadValidDelegatedPermit();
    expect(beforeCorrection).not.toHaveProperty("error");

    expect(
      performDelegatedWrite(
        "iterative.js",
        validContent,
        workspaceRoot,
      ),
    ).toContain("DELEGATED_FILE_MODIFIED");

    expect(
      fs.readFileSync(
        nodePath.join(projectRoot, "iterative.js"),
        "utf8",
      ),
    ).toBe(validContent);

    const afterCorrection = loadValidDelegatedPermit();
    expect(afterCorrection).not.toHaveProperty("error");

    if (
      !("error" in beforeCorrection) &&
      !("error" in afterCorrection)
    ) {
      expect(afterCorrection.state.writtenPaths).toEqual([
        "project/iterative.js",
      ]);
      expect(afterCorrection.state.totalBytesWritten).toBe(
        beforeCorrection.state.totalBytesWritten +
          Buffer.byteLength(validContent, "utf8"),
      );
    }

    expect(
      performSupervisedExecution(
        "node_check",
        "iterative.js",
        workspaceRoot,
      ),
    ).toContain("SUPERVISED_EXECUTION_PASSED");
  });

  it("blocks execution without an S3 permit", () => {
    grantS2();
    fs.writeFileSync(
      nodePath.join(projectRoot, "valid.js"),
      "const value = 1;\n",
    );

    expect(
      performSupervisedExecution(
        "node_check",
        "valid.js",
        workspaceRoot,
      ),
    ).toContain("no valid S3 execution permit");
  });

  it("checks valid JavaScript inside the sandbox", () => {
    grantS2();
    grantS3();

    fs.writeFileSync(
      nodePath.join(projectRoot, "valid.js"),
      "function add(a, b) { return a + b; }\n",
    );

    const result = performSupervisedExecution(
      "node_check",
      "valid.js",
      workspaceRoot,
    );

    expect(result).toContain("SUPERVISED_EXECUTION_PASSED");
    expect(result).toContain("Exit code: 0");

    const authorization = loadValidExecutionPermit();
    expect(authorization).not.toHaveProperty("error");

    if (!("error" in authorization)) {
      expect(authorization.state.runsUsed).toBe(1);
      expect(
        authorization.state.totalSecondsUsed,
      ).toBeGreaterThanOrEqual(1);
    }
  });

  it("reports invalid JavaScript without executing it", () => {
    grantS2();
    grantS3();

    const marker = nodePath.join(
      temporaryHome,
      "must-not-exist.txt",
    );

    fs.writeFileSync(
      nodePath.join(projectRoot, "invalid.js"),
      `require("fs").writeFileSync(${JSON.stringify(marker)}, "bad");
function broken( {
`,
    );

    const result = performSupervisedExecution(
      "node_check",
      "invalid.js",
      workspaceRoot,
    );

    expect(result).toContain("SUPERVISED_EXECUTION_FAILED");
    expect(fs.existsSync(marker)).toBe(false);
  });

  it("blocks traversal, absolute paths, and hidden paths", () => {
    grantS2();
    grantS3();

    expect(
      performSupervisedExecution(
        "node_check",
        "../outside.js",
        workspaceRoot,
      ),
    ).toContain("traversal");

    expect(
      performSupervisedExecution(
        "node_check",
        "/tmp/outside.js",
        workspaceRoot,
      ),
    ).toContain("must be relative");

    expect(
      performSupervisedExecution(
        "node_check",
        ".hidden.js",
        workspaceRoot,
      ),
    ).toContain("hidden paths");
  });

  it("blocks symbolic links", () => {
    grantS2();
    grantS3();

    const outside = nodePath.join(
      temporaryHome,
      "outside.js",
    );
    fs.writeFileSync(outside, "const secret = true;\n");
    fs.symlinkSync(
      outside,
      nodePath.join(projectRoot, "link.js"),
    );

    expect(
      performSupervisedExecution(
        "node_check",
        "link.js",
        workspaceRoot,
      ),
    ).toContain("symbolic links");
  });

  it("blocks an operation omitted from the permit", () => {
    grantS2();
    grantS3({
      allowedOperations: ["typescript_check"],
    });

    fs.writeFileSync(
      nodePath.join(projectRoot, "valid.js"),
      "const value = 1;\n",
    );

    expect(
      performSupervisedExecution(
        "node_check",
        "valid.js",
        workspaceRoot,
      ),
    ).toContain("not authorized");
  });

  it("enforces the execution run limit", () => {
    grantS2();
    grantS3({ maxRuns: 1 });

    fs.writeFileSync(
      nodePath.join(projectRoot, "one.js"),
      "const one = 1;\n",
    );
    fs.writeFileSync(
      nodePath.join(projectRoot, "two.js"),
      "const two = 2;\n",
    );

    expect(
      performSupervisedExecution(
        "node_check",
        "one.js",
        workspaceRoot,
      ),
    ).toContain("PASSED");

    expect(
      performSupervisedExecution(
        "node_check",
        "two.js",
        workspaceRoot,
      ),
    ).toContain("run limit reached");
  });

  it("runs TypeScript noEmit successfully in an ephemeral copy", () => {
    grantS2();
    grantS3({
      allowedOperations: ["typescript_check"],
    });

    fs.writeFileSync(
      nodePath.join(projectRoot, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          noEmit: false,
          outDir: "dist",
        },
        include: ["src/**/*.ts"],
      }),
    );

    fs.mkdirSync(nodePath.join(projectRoot, "src"));
    fs.writeFileSync(
      nodePath.join(projectRoot, "src", "index.ts"),
      "export const answer: number = 42;\n",
    );

    const result = performSupervisedExecution(
      "typescript_check",
      ".",
      workspaceRoot,
    );

    expect(result).toContain("SUPERVISED_EXECUTION_PASSED");
    expect(result).toContain("Exit code: 0");
    expect(
      fs.existsSync(nodePath.join(projectRoot, "dist")),
    ).toBe(false);
  });

  it("reports TypeScript errors without modifying the original project", () => {
    grantS2();
    grantS3({
      allowedOperations: ["typescript_check"],
    });

    fs.writeFileSync(
      nodePath.join(projectRoot, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
        },
        include: ["src/**/*.ts"],
      }),
    );

    fs.mkdirSync(nodePath.join(projectRoot, "src"));
    fs.writeFileSync(
      nodePath.join(projectRoot, "src", "broken.ts"),
      "const value: number = 'wrong';\n",
    );

    const before = fs.readFileSync(
      nodePath.join(projectRoot, "src", "broken.ts"),
      "utf8",
    );

    const result = performSupervisedExecution(
      "typescript_check",
      ".",
      workspaceRoot,
    );

    expect(result).toContain("SUPERVISED_EXECUTION_FAILED");
    expect(result).toContain("TS2322");
    expect(
      fs.readFileSync(
        nodePath.join(projectRoot, "src", "broken.ts"),
        "utf8",
      ),
    ).toBe(before);
  });

  it("blocks arbitrary paths for TypeScript project validation", () => {
    grantS2();
    grantS3({
      allowedOperations: ["typescript_check"],
    });

    expect(
      performSupervisedExecution(
        "typescript_check",
        "src/index.ts",
        workspaceRoot,
      ),
    ).toContain("accepts only the fixed project path");
  });

  it("builds TypeScript only inside the disposable project copy", () => {
    grantS2();
    grantS3({
      allowedOperations: ["typescript_build"],
    });

    fs.writeFileSync(
      nodePath.join(projectRoot, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          outDir: "dist",
        },
        include: ["src/**/*.ts"],
      }),
    );

    fs.mkdirSync(nodePath.join(projectRoot, "src"));
    fs.writeFileSync(
      nodePath.join(projectRoot, "src", "index.ts"),
      "export const built: boolean = true;\n",
    );

    const result = performSupervisedExecution(
      "typescript_build",
      ".",
      workspaceRoot,
    );

    expect(result).toContain("SUPERVISED_EXECUTION_PASSED");
    expect(result).toContain("Exit code: 0");

    expect(
      fs.existsSync(nodePath.join(projectRoot, "dist")),
    ).toBe(false);
  });

  it("runs Vitest with no network and no shell executable", () => {
    grantS2();
    grantS3({
      allowedOperations: ["vitest"],
    });

    fs.writeFileSync(
      nodePath.join(projectRoot, "safe.test.ts"),
      `import fs from "node:fs";
import { expect, it } from "vitest";

it("has no shell executable", () => {
  expect(fs.existsSync("/usr/bin/bash")).toBe(false);
  expect(fs.existsSync("/usr/bin/curl")).toBe(false);
  expect(fs.existsSync("/usr/bin/git")).toBe(false);
});

it("has no external network", async () => {
  await expect(
    fetch("https://example.com"),
  ).rejects.toThrow();
});
`,
    );

    const result = performSupervisedExecution(
      "vitest",
      ".",
      workspaceRoot,
    );

    expect(result).toContain("SUPERVISED_EXECUTION_PASSED");
    expect(result).toContain("2 passed");
    expect(result).toContain("Exit code: 0");
  });

  it("copies a bounded project while excluding dependencies and Git", () => {
    fs.writeFileSync(
      nodePath.join(projectRoot, "index.js"),
      "const safe = true;\n",
    );

    fs.mkdirSync(
      nodePath.join(projectRoot, "node_modules"),
    );
    fs.writeFileSync(
      nodePath.join(
        projectRoot,
        "node_modules",
        "untrusted.js",
      ),
      "throw new Error('must not copy');\n",
    );

    fs.mkdirSync(
      nodePath.join(projectRoot, ".git"),
    );
    fs.writeFileSync(
      nodePath.join(projectRoot, ".git", "config"),
      "secret",
    );

    const ephemeral =
      createEphemeralProject(projectRoot);

    expect(ephemeral).not.toHaveProperty("error");

    if (!("error" in ephemeral)) {
      try {
        expect(
          fs.readFileSync(
            nodePath.join(
              ephemeral.project,
              "index.js",
            ),
            "utf8",
          ),
        ).toContain("safe");

        expect(
          fs.readdirSync(
            nodePath.join(
              ephemeral.project,
              "node_modules",
            ),
          ),
        ).toEqual([]);

        expect(
          fs.existsSync(
            nodePath.join(
              ephemeral.project,
              ".git",
            ),
          ),
        ).toBe(false);
      } finally {
        removeEphemeralProject(ephemeral.root);
      }

      expect(
        fs.existsSync(ephemeral.root),
      ).toBe(false);
    }
  });

  it("blocks hidden entries and symbolic links before copying", () => {
    fs.writeFileSync(
      nodePath.join(projectRoot, ".env"),
      "API_KEY=secret",
    );

    expect(
      createEphemeralProject(projectRoot),
    ).toHaveProperty(
      "error",
      expect.stringContaining("hidden project entries"),
    );

    fs.rmSync(nodePath.join(projectRoot, ".env"));

    const outside = nodePath.join(
      temporaryHome,
      "outside.txt",
    );
    fs.writeFileSync(outside, "secret");
    fs.symlinkSync(
      outside,
      nodePath.join(projectRoot, "link.txt"),
    );

    expect(
      createEphemeralProject(projectRoot),
    ).toHaveProperty(
      "error",
      expect.stringContaining("symbolic links"),
    );
  });

  it("exposes no shell command or arbitrary argument parameter", () => {
    const tools = createSupervisedExecutionTools(
      workspaceRoot,
    );
    expect(tools.map((tool) => tool.name)).toEqual([
      "supervised_run_validation",
    ]);

    const serialized = JSON.stringify(
      tools[0].parameters,
    );

    expect(serialized).not.toContain("command");
    expect(serialized).not.toContain("args");
    expect(serialized).not.toContain("shell");

    const operationSchema = (
      tools[0].parameters as {
        properties: {
          operation: {
            enum: string[];
          };
        };
      }
    ).properties.operation;

    expect(operationSchema.enum).toEqual([
      "node_check",
      "typescript_check",
      "typescript_build",
      "vitest",
    ]);
  });
});
