import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

describe("CLI status runtime truth", () => {
  it("does not call DB-enabled skills active", () => {
    const source = fs.readFileSync(
      fileURLToPath(new URL("../index.ts", import.meta.url)),
      "utf-8",
    );

    expect(source).toContain("Skills:     ${skills.length} enabled in inventory");
    expect(source).not.toContain("Skills:     ${skills.length} active");
  });
});
