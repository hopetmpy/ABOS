import { describe, expect, it } from "vitest";
import { redactToolArgumentsForPersistence } from "../agent/sensitive-tool-arguments.js";

describe("P-017 remediation persistence redaction", () => {
  it("does not persist delegated provider probe payloads on the outer tool call", () => {
    const original = {
      requirement: "lookup records",
      probeArguments: {
        query: "customer@example.com",
        apiToken: "super-secret-token",
        nested: { password: "should-never-persist" },
      },
    };

    const redacted = redactToolArgumentsForPersistence(
      "remediate_capability",
      original,
    );

    expect(redacted).toEqual({
      requirement: "lookup records",
      probeArguments: "<redacted>",
    });
    expect(JSON.stringify(redacted)).not.toContain("super-secret-token");
    expect(JSON.stringify(redacted)).not.toContain("should-never-persist");
    expect(original.probeArguments.apiToken).toBe("super-secret-token");
  });

  it("does not persist source contents from a P-012 construction plan", () => {
    const original = {
      requirement: "archive extraction",
      constructionPlan: {
        description: "Construct archive adapter",
        edits: [
          {
            path: "src/adapters/archive.ts",
            content: "const embeddedSecret = 'do-not-persist-this-source';",
          },
        ],
      },
    };

    const redacted = redactToolArgumentsForPersistence(
      "remediate_capability",
      original,
    );

    expect(redacted).toEqual({
      requirement: "archive extraction",
      constructionPlan: "<redacted>",
    });
    expect(JSON.stringify(redacted)).not.toContain("do-not-persist-this-source");
    expect((original.constructionPlan.edits[0] as any).content).toContain(
      "do-not-persist-this-source",
    );
  });
});
