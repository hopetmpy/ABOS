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
  issueMissionPermit,
} from "../agent/supervised-mission-permit.js";
import {
  defineMissionPlan,
  loadValidMissionPlan,
} from "../agent/supervised-mission.js";
import {
  issueNetworkPermit,
  loadValidNetworkPermit,
} from "../agent/supervised-network-permit.js";
import {
  createSupervisedNetworkTools,
  performSupervisedNetworkRead,
  type PinnedHttpsRequest,
  type SupervisedNetworkTransport,
} from "../agent/supervised-network.js";
import type {
  SupervisedNetworkResolver,
} from "../agent/supervised-network-policy.js";

const originalHome = process.env.HOME;
const originalMode =
  process.env.AUTOMATON_SUPERVISED_MODE;
const originalLevel =
  process.env.AUTOMATON_SUPERVISED_LEVEL;

let temporaryHome = "";
let workspaceRoot = "";

const publicResolver:
  SupervisedNetworkResolver =
  async () => [
    {
      address: "93.184.216.34",
      family: 4,
    },
  ];

function grantParents(): void {
  expect(
    issueDelegatedPermit({
      workspacePath: "network-project",
      allowCreate: true,
      allowModify: true,
      maxFiles: 20,
      maxTotalBytes: 1024 * 1024,
      durationMinutes: 60,
    }),
  ).not.toHaveProperty("error");

  expect(
    issueExecutionPermit({
      allowedOperations: [
        "node_check",
        "typescript_check",
        "typescript_build",
        "vitest",
      ],
      maxRuns: 10,
      maxTotalSeconds: 300,
      durationMinutes: 60,
    }),
  ).not.toHaveProperty("error");

  expect(
    issueMissionPermit({
      maxCycles: 3,
      maxTurns: 24,
      durationMinutes: 60,
    }),
  ).not.toHaveProperty("error");
}

function grantNetwork(
  overrides: Partial<{
    allowedDomains: string[];
    maxRequests: number;
    maxResponseBytes: number;
    maxTotalBytes: number;
    maxRedirects: number;
    requestTimeoutMs: number;
    durationMinutes: number;
  }> = {},
): void {
  expect(
    issueNetworkPermit({
      allowedDomains: [
        "example.com",
        "api.example.com",
      ],
      maxRequests: 5,
      maxResponseBytes: 1024,
      maxTotalBytes: 4096,
      maxRedirects: 2,
      requestTimeoutMs: 5000,
      durationMinutes: 30,
      ...overrides,
    }),
  ).not.toHaveProperty("error");
}

function textualResponse(
  body: string,
  statusCode = 200,
) {
  return {
    statusCode,
    headers: {
      "content-type":
        "text/plain; charset=utf-8",
    },
    body: Buffer.from(body, "utf8"),
  };
}

beforeEach(() => {
  temporaryHome = fs.mkdtempSync(
    nodePath.join(
      os.tmpdir(),
      "automaton-s5-network-test-",
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
    "Read bounded public information.",
    {
      encoding: "utf8",
      mode: 0o600,
    },
  );

  grantParents();
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
  "supervised S5 network execution",
  () => {
    it(
      "pins HTTPS to a validated public address and records usage",
      async () => {
        grantNetwork();

        const observed:
          PinnedHttpsRequest[] = [];

        const transport:
          SupervisedNetworkTransport =
          async (request) => {
            observed.push(request);

            return textualResponse(
              "PUBLIC_INFORMATION",
            );
          };

        const result =
          await performSupervisedNetworkRead(
            "https://example.com/data?q=1",
            {
              resolver: publicResolver,
              transport,
            },
          );

        expect(result).toContain(
          "SUPERVISED_NETWORK_READ_COMPLETED",
        );
        expect(result).toContain(
          "BEGIN UNTRUSTED NETWORK CONTENT",
        );
        expect(result).toContain(
          "Persistence policy: extract only task-required facts",
        );
        expect(result).toContain(
          "PUBLIC_INFORMATION",
        );
        expect(observed).toHaveLength(1);
        expect(observed[0].address).toBe(
          "93.184.216.34",
        );
        expect(observed[0].url.hostname).toBe(
          "example.com",
        );
        expect(observed[0].url.search).toBe(
          "?q=1",
        );

        const authorization =
          loadValidNetworkPermit();

        expect(
          authorization,
        ).not.toHaveProperty("error");

        if (!("error" in authorization)) {
          expect(
            authorization.state.requestsUsed,
          ).toBe(1);
          expect(
            authorization.state
              .totalBytesReceived,
          ).toBe(
            Buffer.byteLength(
              "PUBLIC_INFORMATION",
            ),
          );
        }
      },
    );

    it(
      "blocks private DNS before invoking HTTPS transport",
      async () => {
        grantNetwork();

        let transportCalled = false;

        const result =
          await performSupervisedNetworkRead(
            "https://example.com/",
            {
              resolver: async () => [
                {
                  address:
                    "169.254.169.254",
                  family: 4,
                },
              ],
              transport: async () => {
                transportCalled = true;
                return textualResponse(
                  "must not run",
                );
              },
            },
          );

        expect(result).toContain(
          "non-public address",
        );
        expect(transportCalled).toBe(
          false,
        );
      },
    );

    it(
      "validates every authorized redirect hop",
      async () => {
        grantNetwork();

        const visited: string[] = [];

        const transport:
          SupervisedNetworkTransport =
          async (request) => {
            visited.push(
              request.url.toString(),
            );

            if (
              request.url.hostname ===
              "example.com"
            ) {
              return {
                statusCode: 302,
                headers: {
                  location:
                    "https://api.example.com/final",
                },
                body: Buffer.alloc(0),
              };
            }

            return textualResponse(
              "REDIRECT_OK",
            );
          };

        const result =
          await performSupervisedNetworkRead(
            "https://example.com/start",
            {
              resolver: publicResolver,
              transport,
            },
          );

        expect(result).toContain(
          "REDIRECT_OK",
        );
        expect(visited).toEqual([
          "https://example.com/start",
          "https://api.example.com/final",
        ]);

        const authorization =
          loadValidNetworkPermit();

        if (!("error" in authorization)) {
          expect(
            authorization.state.requestsUsed,
          ).toBe(2);
        }
      },
    );

    it(
      "blocks redirects outside the exact allowlist",
      async () => {
        grantNetwork();

        let calls = 0;

        const result =
          await performSupervisedNetworkRead(
            "https://example.com/start",
            {
              resolver: publicResolver,
              transport: async () => {
                calls += 1;

                return {
                  statusCode: 302,
                  headers: {
                    location:
                      "https://evil.example.org/",
                  },
                  body: Buffer.alloc(0),
                };
              },
            },
          );

        expect(result).toContain(
          "exact authorized domain",
        );
        expect(calls).toBe(1);
      },
    );

    it(
      "enforces the redirect limit",
      async () => {
        grantNetwork({
          maxRedirects: 0,
        });

        const result =
          await performSupervisedNetworkRead(
            "https://example.com/start",
            {
              resolver: publicResolver,
              transport: async () => ({
                statusCode: 302,
                headers: {
                  location:
                    "https://example.com/next",
                },
                body: Buffer.alloc(0),
              }),
            },
          );

        expect(result).toContain(
          "redirect limit reached",
        );
      },
    );

    it(
      "enforces the persistent request limit",
      async () => {
        grantNetwork({
          maxRequests: 1,
        });

        const dependencies = {
          resolver: publicResolver,
          transport: async () =>
            textualResponse("OK"),
        };

        expect(
          await performSupervisedNetworkRead(
            "https://example.com/one",
            dependencies,
          ),
        ).toContain(
          "SUPERVISED_NETWORK_READ_COMPLETED",
        );

        expect(
          await performSupervisedNetworkRead(
            "https://example.com/two",
            dependencies,
          ),
        ).toContain(
          "request limit reached",
        );
      },
    );

    it(
      "rejects transport output beyond the byte reservation",
      async () => {
        grantNetwork({
          maxResponseBytes: 8,
          maxTotalBytes: 16,
        });

        const result =
          await performSupervisedNetworkRead(
            "https://example.com/",
            {
              resolver: publicResolver,
              transport: async () =>
                textualResponse(
                  "0123456789",
                ),
            },
          );

        expect(result).toContain(
          "exceeded the authorized byte limit",
        );
      },
    );

    it(
      "rejects binary content and invalid UTF-8",
      async () => {
        grantNetwork();

        expect(
          await performSupervisedNetworkRead(
            "https://example.com/image",
            {
              resolver: publicResolver,
              transport: async () => ({
                statusCode: 200,
                headers: {
                  "content-type":
                    "image/png",
                },
                body: Buffer.from([
                  0x89,
                  0x50,
                ]),
              }),
            },
          ),
        ).toContain(
          "only UTF-8 textual",
        );

        expect(
          await performSupervisedNetworkRead(
            "https://example.com/text",
            {
              resolver: publicResolver,
              transport: async () => ({
                statusCode: 200,
                headers: {
                  "content-type":
                    "text/plain",
                },
                body: Buffer.from([
                  0xc3,
                  0x28,
                ]),
              }),
            },
          ),
        ).toContain(
          "not valid UTF-8",
        );
      },
    );

    it(
      "rejects unsuccessful HTTPS status codes",
      async () => {
        grantNetwork();

        expect(
          await performSupervisedNetworkRead(
            "https://example.com/missing",
            {
              resolver: publicResolver,
              transport: async () =>
                textualResponse(
                  "not found",
                  404,
                ),
            },
          ),
        ).toContain(
          "status 404 is not successful",
        );
      },
    );

    it("completes a network-bound mission step",async()=>{grantNetwork();defineMissionPlan("Read one page.",[{id:"fetch_example",title:"Fetch example",dependsOn:[]}]);const tool=createSupervisedNetworkTools({resolver:publicResolver,transport:async()=>textualResponse("PUBLIC_INFORMATION")})[0];const result=await tool.execute({url:"https://example.com/",step_id:"fetch_example"},undefined as never);expect(result).toContain("SUPERVISED_NETWORK_READ_COMPLETED");const plan=loadValidMissionPlan();if("error" in plan)throw new Error(plan.error);expect(plan.plan.steps[0].status).toBe("completed");});

    it(
      "exposes one closed GET-only network tool",
      () => {
        const tools =
          createSupervisedNetworkTools();

        expect(
          tools.map((tool) => tool.name),
        ).toEqual([
          "supervised_fetch_url",
        ]);

        const serialized =
          JSON.stringify(
            tools[0].parameters,
          );

        expect(serialized).toContain(
          '"url"',
        );
        expect(serialized).not.toContain(
          '"method"',
        );
        expect(serialized).not.toContain(
          '"body"',
        );
        expect(serialized).not.toContain(
          '"headers"',
        );
        expect(serialized).not.toContain(
          '"cookies"',
        );
        expect(
          tools[0].parameters,
        ).toHaveProperty(
          "additionalProperties",
          false,
        );
      },
    );
  },
);
