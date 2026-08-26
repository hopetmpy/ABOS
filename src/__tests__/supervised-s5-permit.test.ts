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
} from "../agent/supervised-permit.js";
import {
  issueExecutionPermit,
} from "../agent/supervised-exec-permit.js";
import {
  createDelegatedWriteTools,
  performDelegatedWrite,
} from "../agent/supervised-write.js";
import {
  issueMissionPermit,
  loadValidMissionPermit,
} from "../agent/supervised-mission-permit.js";
import {
  getNetworkPermitPath,
  issueNetworkPermit,
  loadValidNetworkPermit,
  revokeNetworkPermit,
  saveNetworkState,
} from "../agent/supervised-network-permit.js";

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
    workspacePath: "network-project",
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

function grantS4(
  durationMinutes = 60,
): void {
  const permit = issueMissionPermit({
    maxCycles: 5,
    maxTurns: 40,
    durationMinutes,
  });

  expect(permit).not.toHaveProperty("error");
}

function grantParents(
  durationMinutes = 60,
): void {
  grantS2(durationMinutes);
  grantS3(durationMinutes);
  grantS4(durationMinutes);
}

function validRequest() {
  return {
    allowedDomains: [
      "example.com",
      "api.example.net",
    ],
    maxRequests: 10,
    maxResponseBytes: 64 * 1024,
    maxTotalBytes: 512 * 1024,
    maxRedirects: 2,
    requestTimeoutMs: 5000,
    durationMinutes: 30,
  };
}

beforeEach(() => {
  temporaryHome = fs.mkdtempSync(
    nodePath.join(
      os.tmpdir(),
      "automaton-s5-permit-test-",
    ),
  );

  process.env.HOME = temporaryHome;
  process.env.AUTOMATON_SUPERVISED_MODE =
    "1";
  process.env.AUTOMATON_SUPERVISED_LEVEL =
    "S5";

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
    [
      "Complete one bounded S5 mission.",
      "Read only from example.com.",
    ].join("\n"),
    {
      encoding: "utf8",
      mode: 0o600,
    },
  );
});

afterEach(() => {
  process.env.HOME = originalHome;

  if (originalMode === undefined) {
    delete process.env
      .AUTOMATON_SUPERVISED_MODE;
  } else {
    process.env.AUTOMATON_SUPERVISED_MODE =
      originalMode;
  }

  if (originalLevel === undefined) {
    delete process.env
      .AUTOMATON_SUPERVISED_LEVEL;
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
  "supervised S5 network permit",
  () => {
    it(
      "requires a valid active S4 mission",
      () => {
        expect(
          issueNetworkPermit(
            validRequest(),
          ),
        ).toEqual({
          error:
            "Blocked: a valid S4 mission permit is required before S5.",
        });
      },
    );

    it(
      "binds the network permit to the exact parent mission",
      () => {
        grantParents();

        const mission =
          loadValidMissionPermit();
        const network =
          issueNetworkPermit(
            validRequest(),
          );

        expect(mission).not.toHaveProperty(
          "error",
        );
        expect(network).not.toHaveProperty(
          "error",
        );

        if (
          !("error" in mission) &&
          !("error" in network)
        ) {
          expect(
            network.missionPermitId,
          ).toBe(mission.permit.id);
          expect(
            network.executionPermitId,
          ).toBe(
            mission.permit
              .executionPermitId,
          );
          expect(
            network.delegatedPermitId,
          ).toBe(
            mission.permit
              .delegatedPermitId,
          );
          expect(network.taskSha256).toBe(
            mission.permit.taskSha256,
          );
          expect(
            network.workspacePath,
          ).toBe(
            mission.permit.workspacePath,
          );
          expect(
            network.allowedDomains,
          ).toEqual([
            "example.com",
            "api.example.net",
          ]);
        }
      },
    );

    it.each([
      {
        field: "allowedDomains",
        value: [],
      },
      {
        field: "allowedDomains",
        value: ["*.example.com"],
      },
      {
        field: "allowedDomains",
        value: [
          "example.com",
          "EXAMPLE.COM",
        ],
      },
      {
        field: "maxRequests",
        value: 51,
      },
      {
        field: "maxResponseBytes",
        value: 1024 * 1024 + 1,
      },
      {
        field: "maxTotalBytes",
        value: 1,
      },
      {
        field: "maxRedirects",
        value: 6,
      },
      {
        field: "requestTimeoutMs",
        value: 999,
      },
      {
        field: "durationMinutes",
        value: 481,
      },
    ])(
      "rejects invalid limit $field",
      ({ field, value }) => {
        grantParents();

        const request = {
          ...validRequest(),
          [field]: value,
        };

        expect(
          issueNetworkPermit(request),
        ).toHaveProperty("error");
      },
    );

    it(
      "never outlives the parent S4 permit",
      () => {
        grantParents(1);

        const mission =
          loadValidMissionPermit();
        const network =
          issueNetworkPermit({
            ...validRequest(),
            durationMinutes: 60,
          });

        expect(mission).not.toHaveProperty(
          "error",
        );
        expect(network).not.toHaveProperty(
          "error",
        );

        if (
          !("error" in mission) &&
          !("error" in network)
        ) {
          expect(
            Date.parse(network.expiresAt),
          ).toBeLessThanOrEqual(
            Date.parse(
              mission.permit.expiresAt,
            ),
          );
        }
      },
    );

    it(
      "loads and persists bounded request usage",
      () => {
        grantParents();

        expect(
          issueNetworkPermit(
            validRequest(),
          ),
        ).not.toHaveProperty("error");

        const authorization =
          loadValidNetworkPermit();

        expect(
          authorization,
        ).not.toHaveProperty("error");

        if (!("error" in authorization)) {
          authorization.state.requestsUsed =
            3;
          authorization.state
            .totalBytesReceived = 4096;
          authorization.state.updatedAt =
            new Date().toISOString();

          saveNetworkState(
            authorization.state,
          );
        }

        const reloaded =
          loadValidNetworkPermit();

        expect(reloaded).not.toHaveProperty(
          "error",
        );

        if (!("error" in reloaded)) {
          expect(
            reloaded.state.requestsUsed,
          ).toBe(3);
          expect(
            reloaded.state
              .totalBytesReceived,
          ).toBe(4096);
        }
      },
    );

    it(
      "detects tampered permit records",
      () => {
        grantParents();

        expect(
          issueNetworkPermit(
            validRequest(),
          ),
        ).not.toHaveProperty("error");

        const permit = JSON.parse(
          fs.readFileSync(
            getNetworkPermitPath(),
            "utf8",
          ),
        ) as Record<string, unknown>;

        permit.allowedDomains = [
          "127.0.0.1",
        ];

        fs.writeFileSync(
          getNetworkPermitPath(),
          JSON.stringify(
            permit,
            null,
            2,
          ) + "\n",
          {
            encoding: "utf8",
            mode: 0o600,
          },
        );

        expect(
          loadValidNetworkPermit(),
        ).toHaveProperty("error");
      },
    );

    it(
      "allows S5 to create, correct, and recognize identical content",
      () => {
        grantParents();

        expect(
          issueNetworkPermit(
            validRequest(),
          ),
        ).not.toHaveProperty("error");

        const created = performDelegatedWrite(
          "result.txt",
          "first version\n",
          workspaceRoot,
        );

        expect(created).toContain(
          "DELEGATED_FILE_CREATED",
        );

        const corrected = performDelegatedWrite(
          "result.txt",
          "corrected version\n",
          workspaceRoot,
        );

        expect(corrected).toContain(
          "DELEGATED_FILE_MODIFIED",
        );

        const identical = performDelegatedWrite(
          "result.txt",
          "corrected version\n",
          workspaceRoot,
        );

        expect(identical).toContain(
          "DELEGATED_FILE_ALREADY_COMPLETE",
        );
        expect(identical).toContain(
          "Do not repeat this write",
        );
        expect(
          fs.readFileSync(
            nodePath.join(
              workspaceRoot,
              "network-project",
              "result.txt",
            ),
            "utf8",
          ),
        ).toBe("corrected version\n");
      },
    );

    it("accepts file as a safe alias for path",async()=>{grantParents();expect(issueNetworkPermit(validRequest())).not.toHaveProperty("error");const tool=createDelegatedWriteTools(workspaceRoot)[0];const result=await tool.execute({file:"alias-report.txt",content:"S5_ALIAS_OK\n"},undefined as never);expect(result).toContain("DELEGATED_FILE_CREATED");expect(fs.readFileSync(nodePath.join(workspaceRoot,"network-project","alias-report.txt"),"utf8")).toBe("S5_ALIAS_OK\n");});

    it(
      "blocks persisted URLs outside the S5 allowlist",
      () => {
        grantParents();

        expect(
          issueNetworkPermit(
            validRequest(),
          ),
        ).not.toHaveProperty("error");

        expect(
          performDelegatedWrite(
            "allowed-url.txt",
            "Source: https://example.com/\n",
            workspaceRoot,
          ),
        ).toContain(
          "DELEGATED_FILE_CREATED",
        );

        const blocked =
          performDelegatedWrite(
            "blocked-url.txt",
            "Link: https://iana.org/domains/example\n",
            workspaceRoot,
          );

        expect(blocked).toContain(
          "outside the exact network authorization",
        );

        expect(
          fs.existsSync(
            nodePath.join(
              workspaceRoot,
              "network-project",
              "blocked-url.txt",
            ),
          ),
        ).toBe(false);
      },
    );

    it(
      "revokes S5 independently of its parent permits",
      () => {
        grantParents();

        expect(
          issueNetworkPermit(
            validRequest(),
          ),
        ).not.toHaveProperty("error");

        expect(
          revokeNetworkPermit(),
        ).toBe(true);
        expect(
          loadValidNetworkPermit(),
        ).toHaveProperty("error");
        expect(
          loadValidMissionPermit(),
        ).not.toHaveProperty("error");
        expect(
          revokeNetworkPermit(),
        ).toBe(false);
      },
    );
  },
);
