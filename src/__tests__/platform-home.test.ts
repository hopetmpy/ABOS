import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { expandHomePath, getHomeDir } from "../platform/home.js";

const ORIGINAL_HOME = process.env.HOME;
const ORIGINAL_USERPROFILE = process.env.USERPROFILE;

afterEach(() => {
  if (ORIGINAL_HOME === undefined) delete process.env.HOME;
  else process.env.HOME = ORIGINAL_HOME;

  if (ORIGINAL_USERPROFILE === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = ORIGINAL_USERPROFILE;
});

describe("platform home resolution", () => {
  it("prefers an explicit HOME override", () => {
    process.env.HOME = path.join(process.cwd(), "tmp-home");
    process.env.USERPROFILE = path.join(process.cwd(), "tmp-profile");

    expect(getHomeDir()).toBe(path.resolve(process.env.HOME));
  });

  it("falls back to USERPROFILE when HOME is absent", () => {
    delete process.env.HOME;
    process.env.USERPROFILE = path.join(process.cwd(), "windows-profile");

    expect(getHomeDir()).toBe(path.resolve(process.env.USERPROFILE));
  });

  it("expands tilde paths with the resolved home", () => {
    process.env.HOME = path.join(process.cwd(), "expanded-home");

    expect(expandHomePath("~/.abos/state.db")).toBe(
      path.join(path.resolve(process.env.HOME), ".abos", "state.db"),
    );
  });
});
