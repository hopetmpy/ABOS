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
});
