
import { describe, expect, it } from "vitest";
import { trustedHttpUrl } from "../network/url-trust.js";

describe("P-016 canonical HTTP URL trust", () => {
  it("accepts remote HTTPS and rejects remote HTTP", () => {
    expect(trustedHttpUrl("https://example.com/path")).toBe("https://example.com/path");
    expect(() => trustedHttpUrl("http://example.com/path", { allowHttpOnLoopback: true }))
      .toThrow("HTTPS required");
  });

  it("allows loopback HTTP only when explicitly enabled", () => {
    expect(trustedHttpUrl("http://127.0.0.1:8123/test", { allowHttpOnLoopback: true }))
      .toBe("http://127.0.0.1:8123/test");
    expect(() => trustedHttpUrl("http://localhost:8123/test"))
      .toThrow("HTTPS required");
  });

  it("rejects URL-embedded credentials and can strip fragments", () => {
    expect(() => trustedHttpUrl("https://user:secret@example.com/"))
      .toThrow("must not embed credentials");
    expect(trustedHttpUrl("https://example.com/a#fragment", { stripHash: true }))
      .toBe("https://example.com/a");
  });

  it("rejects non-HTTP schemes and malformed values", () => {
    expect(() => trustedHttpUrl("file:///etc/passwd", { allowHttpOnLoopback: true }))
      .toThrow("HTTPS required");
    expect(() => trustedHttpUrl("not a url")).toThrow("Invalid URL");
  });
});
