import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

function source(): string {
  return fs.readFileSync(
    fileURLToPath(new URL("../agent/system-prompt.ts", import.meta.url)),
    "utf-8",
  );
}

describe("system prompt runtime truth", () => {
  it("does not label loaded definitions as AVAILABLE TOOLS", () => {
    const text = source();
    expect(text).not.toContain("--- AVAILABLE TOOLS ---");
    expect(text).toContain("--- LOADED TOOL SURFACES ---");
    expect(text).toContain("do not infer VERIFIED_AVAILABLE from this list alone");
  });

  it("does not present architectural orchestration support as unconditional You CAN claims", () => {
    const text = source();
    expect(text).not.toContain("<capabilities>\nYou CAN:");
    expect(text).toContain("architectural intent, not proof that every capability is currently VERIFIED_AVAILABLE");
  });

  it("keeps unknown child balance distinct from out_of_credits", () => {
    const text = source();
    expect(text).toContain("UNKNOWN/unobserved child credit balance remains UNKNOWN");
    expect(text).toContain("MUST NOT trigger autofunding");
  });

  it("does not claim every supported provider is currently possessed", () => {
    const text = source();
    expect(text).not.toContain("What you have: Conway Cloud");
    expect(text).toContain("Support, installation, or configuration is not proof of current runtime availability");
  });
});
