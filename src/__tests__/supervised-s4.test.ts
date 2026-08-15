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
} from "../agent/supervised-exec-permit.js";
import {
  getMissionPermitPath,
  getMissionPlanPath,
  issueMissionPermit,
  loadValidMissionPermit,
  revokeMissionPermit,
  saveMissionState,
} from "../agent/supervised-mission-permit.js";
import {
  beginMissionCycle,
  blockMission,
  clearMissionValidations,
  completeMission,
  createSupervisedMissionTools,
  defineMissionPlan,
  getMissionContinuationDecision,
  getMissionProgress,
  loadValidMissionPlan,
  recordMissionTurn,
  recordMissionValidation,
  updateMissionStep,
} from "../agent/supervised-mission.js";
import {
  getSupervisedLevel,
  isSupervisedWriteEnabled,
} from "../agent/supervised-level.js";

const originalHome = process.env.HOME;
const originalMode =
  process.env.AUTOMATON_SUPERVISED_MODE;
const originalLevel =
  process.env.AUTOMATON_SUPERVISED_LEVEL;

let temporaryHome = "";
let workspaceRoot = "";

function grantS2(
  durationMinutes = 60,
): void {
  const permit = issueDelegatedPermit({
    workspacePath: "mission-project",
    allowCreate: true,
    allowModify: true,
    maxFiles: 30,
    maxTotalBytes: 5 * 1024 * 1024,
    durationMinutes,
  });

  expect(permit).not.toHaveProperty("error");
}

function grantS3(
  durationMinutes = 60,
): void {
  const permit = issueExecutionPermit({
    allowedOperations: [
      "node_check",
      "typescript_check",
      "typescript_build",
      "vitest",
    ],
    maxRuns: 20,
    maxTotalSeconds: 600,
    durationMinutes,
  });

  expect(permit).not.toHaveProperty("error");
}

function grantParents(
  durationMinutes = 60,
): void {
  grantS2(durationMinutes);
  grantS3(durationMinutes);
}

beforeEach(() => {
  temporaryHome = fs.mkdtempSync(
    nodePath.join(
      os.tmpdir(),
      "automaton-s4-test-",
    ),
  );

  process.env.HOME = temporaryHome;
  process.env.AUTOMATON_SUPERVISED_MODE =
    "1";
  process.env.AUTOMATON_SUPERVISED_LEVEL =
    "S4";

  workspaceRoot = nodePath.join(
    temporaryHome,
    ".automaton",
    "supervised-workspace",
  );

  fs.mkdirSync(workspaceRoot, {
    recursive: true,
    mode: 0o700,
  });

  fs.writeFileSync(
    nodePath.join(
      workspaceRoot,
      "SUPERVISED_TASK.md",
    ),
    "Complete one persistent local mission.",
    {
      encoding: "utf8",
      mode: 0o600,
    },
  );
});

afterEach(() => {
  process.env.HOME = originalHome;

  if (originalMode === undefined) {
    delete process.env.AUTOMATON_SUPERVISED_MODE;
  } else {
    process.env.AUTOMATON_SUPERVISED_MODE =
      originalMode;
  }

  if (originalLevel === undefined) {
    delete process.env.AUTOMATON_SUPERVISED_LEVEL;
  } else {
    process.env.AUTOMATON_SUPERVISED_LEVEL =
      originalLevel;
  }

  fs.rmSync(temporaryHome, {
    recursive: true,
    force: true,
  });
});

describe(
  "supervised S4 persistent mission permit",
  () => {
    it(
      "recognizes S4 and enables confined writing",
      () => {
        expect(getSupervisedLevel()).toBe("S4");
        expect(
          isSupervisedWriteEnabled(),
        ).toBe(true);
      },
    );

    it(
      "requires valid S2 and S3 parent permits",
      () => {
        expect(
          issueMissionPermit({
            maxCycles: 5,
            maxTurns: 40,
            durationMinutes: 60,
          }),
        ).toEqual({
          error:
            "Blocked: a valid S3 execution permit is required before S4.",
        });

        grantS2();

        expect(
          issueMissionPermit({
            maxCycles: 5,
            maxTurns: 40,
            durationMinutes: 60,
          }),
        ).toHaveProperty("error");
      },
    );

    it(
      "issues a mission bound to the exact task and project",
      () => {
        grantParents();

        const permit = issueMissionPermit({
          maxCycles: 5,
          maxTurns: 40,
          durationMinutes: 60,
        });

        expect(permit).not.toHaveProperty(
          "error",
        );

        const authorization =
          loadValidMissionPermit();

        expect(
          authorization,
        ).not.toHaveProperty("error");

        if (!("error" in authorization)) {
          expect(
            authorization.permit.workspacePath,
          ).toBe("mission-project");
          expect(
            authorization.permit.maxCycles,
          ).toBe(5);
          expect(
            authorization.permit.maxTurns,
          ).toBe(40);
          expect(
            authorization.state.status,
          ).toBe("active");
          expect(
            authorization.state.cyclesUsed,
          ).toBe(0);
          expect(
            authorization.state.turnsUsed,
          ).toBe(0);
        }
      },
    );

    it(
      "enforces cycle, turn, and duration limits",
      () => {
        grantParents();

        expect(
          issueMissionPermit({
            maxCycles: 21,
            maxTurns: 40,
            durationMinutes: 60,
          }),
        ).toHaveProperty("error");

        expect(
          issueMissionPermit({
            maxCycles: 10,
            maxTurns: 9,
            durationMinutes: 60,
          }),
        ).toHaveProperty("error");

        expect(
          issueMissionPermit({
            maxCycles: 10,
            maxTurns: 40,
            durationMinutes: 481,
          }),
        ).toHaveProperty("error");
      },
    );

    it(
      "never outlives the parent S3 permit",
      () => {
        grantParents(2);

        const permit = issueMissionPermit({
          maxCycles: 2,
          maxTurns: 10,
          durationMinutes: 480,
        });

        expect(permit).not.toHaveProperty(
          "error",
        );

        if (!("error" in permit)) {
          expect(
            Date.parse(permit.expiresAt) -
              Date.parse(permit.issuedAt),
          ).toBeLessThanOrEqual(
            2 * 60 * 1000,
          );
        }
      },
    );

    it(
      "invalidates the mission when the task changes",
      () => {
        grantParents();

        expect(
          issueMissionPermit({
            maxCycles: 5,
            maxTurns: 40,
            durationMinutes: 60,
          }),
        ).not.toHaveProperty("error");

        fs.writeFileSync(
          nodePath.join(
            workspaceRoot,
            "SUPERVISED_TASK.md",
          ),
          "A different mission.",
          "utf8",
        );

        expect(
          loadValidMissionPermit(),
        ).toHaveProperty("error");
      },
    );

    it(
      "detects tampered mission records",
      () => {
        grantParents();

        expect(
          issueMissionPermit({
            maxCycles: 5,
            maxTurns: 40,
            durationMinutes: 60,
          }),
        ).not.toHaveProperty("error");

        const path = getMissionPermitPath();
        const permit = JSON.parse(
          fs.readFileSync(path, "utf8"),
        );

        permit.workspacePath =
          "unauthorized-project";

        fs.writeFileSync(
          path,
          JSON.stringify(permit, null, 2),
          "utf8",
        );

        expect(
          loadValidMissionPermit(),
        ).toHaveProperty("error");
      },
    );

    it(
      "persists bounded mission progress",
      () => {
        grantParents();

        expect(
          issueMissionPermit({
            maxCycles: 5,
            maxTurns: 40,
            durationMinutes: 60,
          }),
        ).not.toHaveProperty("error");

        const authorization =
          loadValidMissionPermit();

        expect(
          authorization,
        ).not.toHaveProperty("error");

        if (!("error" in authorization)) {
          authorization.state.cyclesUsed = 1;
          authorization.state.turnsUsed = 4;
          authorization.state.planRevision = 1;
          authorization.state.lastSummary =
            "First cycle completed.";
          authorization.state.updatedAt =
            new Date().toISOString();

          saveMissionState(
            authorization.state,
          );
        }

        const reloaded =
          loadValidMissionPermit();

        expect(reloaded).not.toHaveProperty(
          "error",
        );

        if (!("error" in reloaded)) {
          expect(
            reloaded.state.cyclesUsed,
          ).toBe(1);
          expect(
            reloaded.state.turnsUsed,
          ).toBe(4);
          expect(
            reloaded.state.lastSummary,
          ).toBe("First cycle completed.");
        }
      },
    );

    it(
      "revokes the mission permit independently",
      () => {
        grantParents();

        expect(
          issueMissionPermit({
            maxCycles: 5,
            maxTurns: 40,
            durationMinutes: 60,
          }),
        ).not.toHaveProperty("error");

        expect(revokeMissionPermit()).toBe(
          true,
        );
        expect(revokeMissionPermit()).toBe(
          false,
        );
        expect(
          loadValidMissionPermit(),
        ).toHaveProperty("error");
      },
    );

    it(
      "defines and reloads a persistent bounded plan",
      () => {
        grantParents();

        expect(
          issueMissionPermit({
            maxCycles: 5,
            maxTurns: 40,
            durationMinutes: 60,
          }),
        ).not.toHaveProperty("error");

        expect(
          defineMissionPlan(
            "Build and validate the local project.",
            [
              {
                id: "prepare",
                title: "Prepare project files",
              },
              {
                id: "validate",
                title: "Validate the project",
                dependsOn: ["prepare"],
              },
            ],
          ),
        ).toContain(
          "SUPERVISED_MISSION_PLAN_DEFINED",
        );

        const loaded = loadValidMissionPlan();

        expect(loaded).not.toHaveProperty(
          "error",
        );

        if (!("error" in loaded)) {
          expect(loaded.plan.steps).toHaveLength(2);
          expect(
            loaded.plan.steps[1].dependsOn,
          ).toEqual(["prepare"]);
          expect(
            loaded.state.planRevision,
          ).toBe(1);
        }
      },
    );

    it(
      "rejects circular mission-completion steps",
      () => {
        grantParents();

        expect(
          issueMissionPermit({
            maxCycles: 5,
            maxTurns: 40,
            durationMinutes: 60,
          }),
        ).not.toHaveProperty("error");

        const result = defineMissionPlan(
          "Complete bounded work.",
          [
            {
              id: "complete-mission",
              title: "Finalize mission",
              dependsOn: [],
            },
          ],
        );

        expect(result).toContain(
          "cannot contain a mission-completion step",
        );
        expect(result).toContain(
          "supervised_complete_mission",
        );
      },
    );

    it(
      "rejects duplicate, unknown, and cyclic dependencies",
      () => {
        grantParents();

        expect(
          issueMissionPermit({
            maxCycles: 5,
            maxTurns: 40,
            durationMinutes: 60,
          }),
        ).not.toHaveProperty("error");

        expect(
          defineMissionPlan("Invalid plan", [
            {
              id: "one",
              title: "First",
              dependsOn: ["two"],
            },
            {
              id: "two",
              title: "Second",
              dependsOn: ["one"],
            },
          ]),
        ).toContain("cycle");

        expect(
          fs.existsSync(getMissionPlanPath()),
        ).toBe(false);

        expect(
          defineMissionPlan("Unknown dependency", [
            {
              id: "one",
              title: "First",
              dependsOn: ["missing"],
            },
          ]),
        ).toContain("dependencies are invalid");
      },
    );

    it(
      "enforces dependencies and evidence during step transitions",
      () => {
        grantParents();

        expect(
          issueMissionPermit({
            maxCycles: 5,
            maxTurns: 40,
            durationMinutes: 60,
          }),
        ).not.toHaveProperty("error");

        expect(
          defineMissionPlan("Ordered work", [
            {
              id: "prepare",
              title: "Prepare files",
            },
            {
              id: "validate",
              title: "Validate files",
              dependsOn: ["prepare"],
            },
          ]),
        ).toContain("PLAN_DEFINED");

        expect(
          updateMissionStep(
            "validate",
            "in_progress",
          ),
        ).toContain("dependencies are incomplete");

        expect(
          updateMissionStep(
            "prepare",
            "in_progress",
          ),
        ).toContain("STEP_UPDATED");

        expect(
          updateMissionStep(
            "prepare",
            "completed",
          ),
        ).toContain("evidence is required");

        expect(
          updateMissionStep(
            "prepare",
            "completed",
            "Files created and inspected.",
          ),
        ).toContain("STEP_UPDATED");

        expect(
          updateMissionStep(
            "validate",
            "in_progress",
          ),
        ).toContain("STEP_UPDATED");
      },
    );

    it(
      "allows blocked work to be retried with bounded attempts",
      () => {
        grantParents();

        expect(
          issueMissionPermit({
            maxCycles: 5,
            maxTurns: 40,
            durationMinutes: 60,
          }),
        ).not.toHaveProperty("error");

        expect(
          defineMissionPlan("Retry work", [
            {
              id: "work",
              title: "Perform bounded work",
            },
          ]),
        ).toContain("PLAN_DEFINED");

        expect(
          updateMissionStep(
            "work",
            "in_progress",
          ),
        ).toContain("Attempts: 1");

        expect(
          updateMissionStep(
            "work",
            "blocked",
            "Validation failed.",
          ),
        ).toContain("blocked");

        expect(
          updateMissionStep(
            "work",
            "in_progress",
            "Applying a correction.",
          ),
        ).toContain("Attempts: 2");
      },
    );

    it(
      "cannot complete until every plan step is completed",
      () => {
        grantParents();

        expect(
          issueMissionPermit({
            maxCycles: 5,
            maxTurns: 40,
            durationMinutes: 60,
          }),
        ).not.toHaveProperty("error");

        expect(
          defineMissionPlan("Complete work", [
            {
              id: "work",
              title: "Complete the work",
            },
          ]),
        ).toContain("PLAN_DEFINED");

        expect(
          completeMission("Premature."),
        ).toContain("unfinished");

        expect(
          updateMissionStep(
            "work",
            "in_progress",
          ),
        ).toContain("STEP_UPDATED");

        expect(
          updateMissionStep(
            "work",
            "completed",
            "Required validation passed.",
          ),
        ).toContain("STEP_UPDATED");

        expect(
          completeMission(
            "All authorized work completed.",
          ),
        ).toContain(
          "SUPERVISED_MISSION_COMPLETED",
        );

        const authorization =
          loadValidMissionPermit();

        expect(
          authorization,
        ).not.toHaveProperty("error");

        if (!("error" in authorization)) {
          expect(
            authorization.state.status,
          ).toBe("completed");
          expect(
            authorization.state.completedAt,
          ).not.toBeNull();
        }
      },
    );

    it(
      "detects a tampered persistent plan",
      () => {
        grantParents();

        expect(
          issueMissionPermit({
            maxCycles: 5,
            maxTurns: 40,
            durationMinutes: 60,
          }),
        ).not.toHaveProperty("error");

        expect(
          defineMissionPlan("Protected plan", [
            {
              id: "work",
              title: "Protected work",
            },
          ]),
        ).toContain("PLAN_DEFINED");

        const plan = JSON.parse(
          fs.readFileSync(
            getMissionPlanPath(),
            "utf8",
          ),
        );

        plan.permitId = "tampered";

        fs.writeFileSync(
          getMissionPlanPath(),
          JSON.stringify(plan, null, 2),
          "utf8",
        );

        expect(
          loadValidMissionPlan(),
        ).toHaveProperty("error");
      },
    );

    it(
      "reports mission progress without changing state",
      () => {
        grantParents();

        expect(
          issueMissionPermit({
            maxCycles: 5,
            maxTurns: 40,
            durationMinutes: 60,
          }),
        ).not.toHaveProperty("error");

        expect(
          defineMissionPlan("Report work", [
            {
              id: "work",
              title: "Reportable work",
            },
          ]),
        ).toContain("PLAN_DEFINED");

        const before =
          fs.readFileSync(
            getMissionPlanPath(),
            "utf8",
          );

        const progress = getMissionProgress();

        expect(progress).toContain(
          "SUPERVISED_MISSION_PROGRESS",
        );
        expect(progress).toContain(
          "Steps completed: 0/1",
        );

        expect(
          fs.readFileSync(
            getMissionPlanPath(),
            "utf8",
          ),
        ).toBe(before);
      },
    );

    it(
      "allows S4 to create, correct, and recognize identical content",
      () => {
        grantParents();

        const missionPermit = issueMissionPermit({
          maxCycles: 3,
          maxTurns: 24,
          durationMinutes: 60,
        });

        expect(missionPermit).not.toHaveProperty(
          "error",
        );

        expect(
          performDelegatedWrite(
            "src/revision.ts",
            "export const value: number = 'bad';\n",
            workspaceRoot,
          ),
        ).toContain("DELEGATED_FILE_CREATED");

        expect(
          performDelegatedWrite(
            "src/revision.ts",
            "export const value: number = 1;\n",
            workspaceRoot,
          ),
        ).toContain("DELEGATED_FILE_MODIFIED");

        const beforeIdentical =
          loadValidDelegatedPermit();

        expect(beforeIdentical).not.toHaveProperty(
          "error",
        );

        const identicalResult =
          performDelegatedWrite(
            "src/revision.ts",
            "export const value: number = 1;\n",
            workspaceRoot,
          );

        expect(identicalResult).toContain(
          "DELEGATED_FILE_ALREADY_COMPLETE",
        );
        expect(identicalResult).toContain(
          "Do not repeat this write",
        );
        expect(identicalResult).not.toContain(
          "finalized for the current task",
        );

        const afterIdentical =
          loadValidDelegatedPermit();

        expect(afterIdentical).not.toHaveProperty(
          "error",
        );

        if (
          !("error" in beforeIdentical) &&
          !("error" in afterIdentical)
        ) {
          expect(
            afterIdentical.state.totalBytesWritten,
          ).toBe(
            beforeIdentical.state.totalBytesWritten,
          );
          expect(
            afterIdentical.state.writtenPaths,
          ).toEqual(
            beforeIdentical.state.writtenPaths,
          );
        }

        expect(
          fs.readFileSync(
            nodePath.join(
              workspaceRoot,
              "mission-project",
              "src",
              "revision.ts",
            ),
            "utf8",
          ),
        ).toBe(
          "export const value: number = 1;\n",
        );
      },
    );

    it(
      "normalizes safe mission step argument aliases",
      async () => {
        grantParents();

        const missionPermit = issueMissionPermit({
          maxCycles: 3,
          maxTurns: 24,
          durationMinutes: 60,
        });

        expect(missionPermit).not.toHaveProperty(
          "error",
        );

        expect(
          defineMissionPlan(
            "Test safe mission tool aliases.",
            [
              {
                id: "first_step",
                title: "First step",
                dependsOn: [],
              },
              {
                id: "second_step",
                title: "Second step",
                dependsOn: [],
              },
            ],
          ),
        ).toContain(
          "SUPERVISED_MISSION_PLAN_DEFINED",
        );

        const updateTool =
          createSupervisedMissionTools().find(
            (tool) =>
              tool.name ===
              "supervised_update_mission_step",
          );

        expect(updateTool).toBeDefined();

        if (!updateTool) {
          throw new Error(
            "MISSION_UPDATE_TOOL_NOT_FOUND",
          );
        }

        expect(
          await updateTool.execute(
            {
              step: "first_step",
              status: "in progress",
            },
            undefined as never,
          ),
        ).toContain(
          "SUPERVISED_MISSION_STEP_UPDATED",
        );

        expect(
          await updateTool.execute(
            {
              name: "first_step",
              status: "complete",
              evidence:
                "The first bounded step was completed.",
            },
            undefined as never,
          ),
        ).toContain(
          "SUPERVISED_MISSION_STEP_UPDATED",
        );

        const rejectedReady =
          await updateTool.execute(
            {
              step_id: "second_step",
              status: "ready",
            },
            undefined as never,
          );

        expect(rejectedReady).toContain(
          "Accepted statuses: in_progress, completed, blocked.",
        );

        const rejectedUnknownStep =
          await updateTool.execute(
            {
              step_id: "invented_step",
              status: "completed",
              evidence:
                "This invented step must not change the plan.",
            },
            undefined as never,
          );

        expect(rejectedUnknownStep).toContain(
          "Requested step: invented_step",
        );
        expect(rejectedUnknownStep).toContain(
          "- first_step (completed)",
        );
        expect(rejectedUnknownStep).toContain(
          "- second_step (pending)",
        );
        expect(rejectedUnknownStep).toContain(
          "Use one exact id from this list.",
        );

        const plan = loadValidMissionPlan();

        expect(plan).not.toHaveProperty("error");

        if (!("error" in plan)) {
          expect(
            plan.plan.steps.find(
              (step) =>
                step.id === "first_step",
            )?.status,
          ).toBe("completed");

          expect(
            plan.plan.steps.find(
              (step) =>
                step.id === "second_step",
            )?.status,
          ).toBe("pending");
        }
      },
    );

    it(
      "exposes only closed mission-management tools",
      () => {
        const tools =
          createSupervisedMissionTools();

        expect(
          tools.map((tool) => tool.name),
        ).toEqual([
          "supervised_define_mission_plan",
          "supervised_update_mission_step",
          "supervised_get_mission_progress",
          "supervised_complete_mission",
        ]);

        const serialized =
          JSON.stringify(tools);

        expect(serialized).not.toContain(
          "shell",
        );
        expect(serialized).not.toContain(
          "command",
        );
        expect(serialized).not.toContain(
          "delete",
        );
        expect(serialized).not.toContain(
          "url",
        );
      },
    );


    it(
      "persists and enforces the mission cycle limit",
      () => {
        grantParents();

        expect(
          issueMissionPermit({
            maxCycles: 2,
            maxTurns: 10,
            durationMinutes: 60,
          }),
        ).not.toHaveProperty("error");

        const first = beginMissionCycle();
        const second = beginMissionCycle();
        const third = beginMissionCycle();

        expect(first).not.toHaveProperty("error");
        expect(second).not.toHaveProperty("error");
        expect(third).toHaveProperty("error");

        const authorization =
          loadValidMissionPermit();

        if (!("error" in authorization)) {
          expect(
            authorization.state.cyclesUsed,
          ).toBe(2);
        }
      },
    );

    it(
      "persists and enforces the mission turn limit",
      () => {
        grantParents();

        expect(
          issueMissionPermit({
            maxCycles: 2,
            maxTurns: 2,
            durationMinutes: 60,
          }),
        ).not.toHaveProperty("error");

        expect(
          recordMissionTurn("First turn."),
        ).not.toHaveProperty("error");

        expect(
          recordMissionTurn("Second turn."),
        ).not.toHaveProperty("error");

        expect(
          recordMissionTurn("Third turn."),
        ).toHaveProperty("error");

        const authorization =
          loadValidMissionPermit();

        if (!("error" in authorization)) {
          expect(
            authorization.state.turnsUsed,
          ).toBe(2);
          expect(
            authorization.state.lastSummary,
          ).toBe("Second turn.");
        }
      },
    );

    it(
      "persists a blocked mission and rejects new cycles",
      () => {
        grantParents();

        expect(
          issueMissionPermit({
            maxCycles: 3,
            maxTurns: 20,
            durationMinutes: 60,
          }),
        ).not.toHaveProperty("error");

        expect(beginMissionCycle()).not.toHaveProperty(
          "error",
        );

        expect(
          blockMission(
            "Mission exhausted its safe recovery path.",
          ),
        ).toContain("SUPERVISED_MISSION_BLOCKED");

        expect(beginMissionCycle()).toHaveProperty(
          "error",
        );

        const authorization =
          loadValidMissionPermit();

        if (!("error" in authorization)) {
          expect(
            authorization.state.status,
          ).toBe("blocked");
          expect(
            authorization.state.lastSummary,
          ).toContain("safe recovery path");
        }
      },
    );


    it(
      "requires persistent runtime validation evidence before completion",
      () => {
        fs.writeFileSync(
          nodePath.join(
            workspaceRoot,
            "SUPERVISED_TASK.md",
          ),
          "Build the project with typescript_check and vitest.",
          "utf8",
        );

        grantParents();

        expect(
          issueMissionPermit({
            maxCycles: 5,
            maxTurns: 40,
            durationMinutes: 60,
          }),
        ).not.toHaveProperty("error");

        expect(
          defineMissionPlan("Validated work", [
            {
              id: "work",
              title: "Build and validate",
            },
          ]),
        ).toContain("PLAN_DEFINED");

        expect(
          updateMissionStep(
            "work",
            "in_progress",
          ),
        ).toContain("STEP_UPDATED");

        expect(
          updateMissionStep(
            "work",
            "completed",
            "Project implementation completed.",
          ),
        ).toContain("STEP_UPDATED");

        expect(
          completeMission("Premature."),
        ).toContain(
          "typescript_check, vitest",
        );

        expect(
          recordMissionValidation(
            "typescript_check",
            true,
          ),
        ).toContain("VALIDATION_RECORDED");

        expect(
          completeMission("Still premature."),
        ).toContain("vitest");

        expect(
          recordMissionValidation(
            "vitest",
            true,
          ),
        ).toContain("VALIDATION_RECORDED");

        expect(
          completeMission(
            "All required validations passed.",
          ),
        ).toContain(
          "SUPERVISED_MISSION_COMPLETED",
        );
      },
    );

    it(
      "clears prior validation evidence when workspace changes",
      () => {
        fs.writeFileSync(
          nodePath.join(
            workspaceRoot,
            "SUPERVISED_TASK.md",
          ),
          "Validate with typescript_check.",
          "utf8",
        );

        grantParents();

        expect(
          issueMissionPermit({
            maxCycles: 5,
            maxTurns: 40,
            durationMinutes: 60,
          }),
        ).not.toHaveProperty("error");

        expect(
          defineMissionPlan("Mutable work", [
            {
              id: "work",
              title: "Modify and validate",
            },
          ]),
        ).toContain("PLAN_DEFINED");

        expect(
          recordMissionValidation(
            "typescript_check",
            true,
          ),
        ).toContain("VALIDATION_RECORDED");

        expect(
          clearMissionValidations(
            "A delegated file changed.",
          ),
        ).toContain("VALIDATIONS_CLEARED");

        const authorization =
          loadValidMissionPermit();

        if (!("error" in authorization)) {
          expect(
            authorization.state
              .passedOperations,
          ).toEqual([]);
        }
      },
    );


    it(
      "allows direct evidence-backed completion of a dependency-ready step",
      () => {
        grantParents();

        expect(
          issueMissionPermit({
            maxCycles: 3,
            maxTurns: 20,
            durationMinutes: 60,
          }),
        ).not.toHaveProperty("error");

        expect(
          defineMissionPlan("Efficient plan", [
            {
              id: "first",
              title: "Complete first step",
            },
            {
              id: "second",
              title: "Complete dependent step",
              dependsOn: ["first"],
            },
          ]),
        ).toContain("PLAN_DEFINED");

        expect(
          updateMissionStep(
            "second",
            "completed",
            "Premature evidence.",
          ),
        ).toContain(
          "dependencies are incomplete",
        );

        expect(
          updateMissionStep(
            "first",
            "completed",
            "First requirement verified.",
          ),
        ).toContain("STEP_UPDATED");

        expect(
          updateMissionStep(
            "second",
            "completed",
            "Dependent requirement verified.",
          ),
        ).toContain("STEP_UPDATED");
      },
    );


    it(
      "continues an active mission within persistent limits",
      () => {
        grantParents();

        expect(
          issueMissionPermit({
            maxCycles: 3,
            maxTurns: 20,
            durationMinutes: 60,
          }),
        ).not.toHaveProperty("error");

        const decision =
          getMissionContinuationDecision();

        expect(decision).not.toHaveProperty(
          "error",
        );

        if (!("error" in decision)) {
          expect(
            decision.continueMission,
          ).toBe(true);
          expect(
            decision.cyclesRemaining,
          ).toBe(3);
          expect(
            decision.turnsRemaining,
          ).toBe(20);
        }
      },
    );

    it(
      "stops automatic continuation when cycle limits are exhausted",
      () => {
        grantParents();

        expect(
          issueMissionPermit({
            maxCycles: 2,
            maxTurns: 20,
            durationMinutes: 60,
          }),
        ).not.toHaveProperty("error");

        expect(beginMissionCycle()).not.toHaveProperty(
          "error",
        );
        expect(beginMissionCycle()).not.toHaveProperty(
          "error",
        );

        const decision =
          getMissionContinuationDecision();

        expect(decision).not.toHaveProperty(
          "error",
        );

        if (!("error" in decision)) {
          expect(
            decision.continueMission,
          ).toBe(false);
          expect(
            decision.cyclesRemaining,
          ).toBe(0);
          expect(decision.reason).toContain(
            "cycle limit",
          );
        }
      },
    );

    it(
      "stops automatic continuation after mission completion",
      () => {
        grantParents();

        expect(
          issueMissionPermit({
            maxCycles: 3,
            maxTurns: 20,
            durationMinutes: 60,
          }),
        ).not.toHaveProperty("error");

        const authorization =
          loadValidMissionPermit();

        if (!("error" in authorization)) {
          authorization.state.status =
            "completed";
          authorization.state.completedAt =
            new Date().toISOString();
          saveMissionState(
            authorization.state,
          );
        }

        const decision =
          getMissionContinuationDecision();

        expect(decision).not.toHaveProperty(
          "error",
        );

        if (!("error" in decision)) {
          expect(
            decision.continueMission,
          ).toBe(false);
          expect(decision.status).toBe(
            "completed",
          );
        }
      },
    );

  },
);
