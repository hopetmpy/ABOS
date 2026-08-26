import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";
import {
  getSupervisedLevel,
  isSupervisedWriteEnabled,
} from "../agent/supervised-level.js";
import {
  isPublicNetworkAddress,
  normalizeAllowedDomain,
  validateSupervisedNetworkUrl,
} from "../agent/supervised-network-policy.js";

const originalMode =
  process.env.AUTOMATON_SUPERVISED_MODE;
const originalLevel =
  process.env.AUTOMATON_SUPERVISED_LEVEL;

afterEach(() => {
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
});

describe(
  "supervised S5 network policy",
  () => {
    it(
      "recognizes S5 while preserving confined writing",
      () => {
        process.env.AUTOMATON_SUPERVISED_MODE =
          "1";
        process.env.AUTOMATON_SUPERVISED_LEVEL =
          "S5";

        expect(getSupervisedLevel()).toBe(
          "S5",
        );
        expect(
          isSupervisedWriteEnabled(),
        ).toBe(true);
      },
    );

    it(
      "recognizes public IPv4 addresses",
      () => {
        expect(
          isPublicNetworkAddress("8.8.8.8"),
        ).toBe(true);
        expect(
          isPublicNetworkAddress("1.1.1.1"),
        ).toBe(true);
      },
    );

    it.each([
      "0.0.0.1",
      "10.0.0.1",
      "100.64.0.1",
      "127.0.0.1",
      "169.254.169.254",
      "172.16.0.1",
      "192.0.2.1",
      "192.168.1.1",
      "198.18.0.1",
      "198.51.100.1",
      "203.0.113.1",
      "224.0.0.1",
      "255.255.255.255",
    ])(
      "blocks non-public IPv4 address %s",
      (address) => {
        expect(
          isPublicNetworkAddress(address),
        ).toBe(false);
      },
    );

    it(
      "recognizes globally routable IPv6 addresses",
      () => {
        expect(
          isPublicNetworkAddress(
            "2606:4700:4700::1111",
          ),
        ).toBe(true);
        expect(
          isPublicNetworkAddress(
            "2001:4860:4860::8888",
          ),
        ).toBe(true);
      },
    );

    it.each([
      "::",
      "::1",
      "::ffff:127.0.0.1",
      "100::1",
      "2001:db8::1",
      "fc00::1",
      "fd00::1",
      "fe80::1",
      "ff02::1",
    ])(
      "blocks non-public IPv6 address %s",
      (address) => {
        expect(
          isPublicNetworkAddress(address),
        ).toBe(false);
      },
    );

    it(
      "normalizes exact DNS allowlist domains",
      () => {
        expect(
          normalizeAllowedDomain(
            "Example.COM.",
          ),
        ).toBe("example.com");
      },
    );

    it.each([
      "",
      "*.example.com",
      "https://example.com",
      "example.com/path",
      "user@example.com",
      "example.com:8443",
      "127.0.0.1",
      "[::1]",
    ])(
      "rejects invalid allowlist entry %s",
      (domain) => {
        expect(
          normalizeAllowedDomain(domain),
        ).toHaveProperty("error");
      },
    );

    it(
      "allows only exact authorized HTTPS hosts",
      () => {
        const result =
          validateSupervisedNetworkUrl(
            "https://example.com/research?q=test",
            ["example.com"],
          );

        expect(result).not.toHaveProperty(
          "error",
        );

        if (!("error" in result)) {
          expect(result.hostname).toBe(
            "example.com",
          );
          expect(result.url.pathname).toBe(
            "/research",
          );
          expect(result.url.search).toBe(
            "?q=test",
          );
        }
      },
    );

    it(
      "does not implicitly authorize subdomains",
      () => {
        expect(
          validateSupervisedNetworkUrl(
            "https://api.example.com/data",
            ["example.com"],
          ),
        ).toHaveProperty(
          "error",
          expect.stringContaining(
            "exact authorized domain",
          ),
        );
      },
    );

    it.each([
      "http://example.com/",
      "ftp://example.com/",
      "https://user:secret@example.com/",
      "https://example.com:8443/",
      "https://example.com/page#fragment",
      "https://127.0.0.1/",
      "https://[::1]/",
    ])(
      "rejects unsafe URL %s",
      (url) => {
        expect(
          validateSupervisedNetworkUrl(
            url,
            ["example.com"],
          ),
        ).toHaveProperty("error");
      },
    );

    it(
      "rejects an invalid domain allowlist",
      () => {
        expect(
          validateSupervisedNetworkUrl(
            "https://example.com/",
            ["*.example.com"],
          ),
        ).toHaveProperty(
          "error",
          expect.stringContaining(
            "allowlist is invalid",
          ),
        );
      },
    );

    it(
      "rejects oversized URLs",
      () => {
        expect(
          validateSupervisedNetworkUrl(
            "https://example.com/" +
              "a".repeat(2100),
            ["example.com"],
          ),
        ).toHaveProperty(
          "error",
          expect.stringContaining(
            "too long",
          ),
        );
      },
    );
  },
);
