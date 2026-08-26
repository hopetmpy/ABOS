import {
  BlockList,
  isIP,
} from "node:net";
import {
  lookup as dnsLookup,
} from "node:dns/promises";

const MAX_NETWORK_URL_LENGTH = 2048;

const blockedIpv4 = new BlockList();

const blockedIpv4Subnets: ReadonlyArray<
  readonly [string, number]
> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

for (
  const [network, prefix] of
  blockedIpv4Subnets
) {
  blockedIpv4.addSubnet(
    network,
    prefix,
    "ipv4",
  );
}

const blockedIpv6 = new BlockList();

blockedIpv6.addSubnet("::", 96, "ipv6");
blockedIpv6.addSubnet(
  "::ffff:0:0",
  96,
  "ipv6",
);
blockedIpv6.addSubnet(
  "64:ff9b:1::",
  48,
  "ipv6",
);
blockedIpv6.addSubnet("100::", 64, "ipv6");
blockedIpv6.addSubnet("2001::", 23, "ipv6");
blockedIpv6.addSubnet(
  "2001:db8::",
  32,
  "ipv6",
);
blockedIpv6.addSubnet("2002::", 16, "ipv6");
blockedIpv6.addSubnet("fc00::", 7, "ipv6");
blockedIpv6.addSubnet("fe80::", 10, "ipv6");
blockedIpv6.addSubnet("ff00::", 8, "ipv6");

function removeIpv6Brackets(
  hostname: string,
): string {
  if (
    hostname.startsWith("[") &&
    hostname.endsWith("]")
  ) {
    return hostname.slice(1, -1);
  }

  return hostname;
}

export function isPublicNetworkAddress(
  address: string,
): boolean {
  const normalized =
    removeIpv6Brackets(address);
  const family = isIP(normalized);

  if (family === 4) {
    return !blockedIpv4.check(
      normalized,
      "ipv4",
    );
  }

  if (family === 6) {
    if (
      blockedIpv6.check(
        normalized,
        "ipv6",
      )
    ) {
      return false;
    }

    const firstHextet = Number.parseInt(
      normalized.split(":")[0] || "0",
      16,
    );

    return (
      Number.isFinite(firstHextet) &&
      firstHextet >= 0x2000 &&
      firstHextet <= 0x3fff
    );
  }

  return false;
}

export function normalizeAllowedDomain(
  value: unknown,
): string | { error: string } {
  if (typeof value !== "string") {
    return {
      error:
        "Blocked: every allowed domain must be a string.",
    };
  }

  const candidate = value
    .trim()
    .toLowerCase()
    .replace(/\.$/, "");

  if (
    candidate.length === 0 ||
    candidate.length > 253 ||
    candidate.includes("*") ||
    candidate.includes("/") ||
    candidate.includes("@") ||
    candidate.includes(":")
  ) {
    return {
      error:
        "Blocked: allowed domain is invalid.",
    };
  }

  try {
    const parsed = new URL(
      "https://" + candidate,
    );
    const hostname = parsed.hostname
      .toLowerCase()
      .replace(/\.$/, "");

    if (
      hostname.length === 0 ||
      isIP(
        removeIpv6Brackets(hostname),
      ) !== 0 ||
      parsed.username !== "" ||
      parsed.password !== "" ||
      parsed.port !== "" ||
      parsed.pathname !== "/" ||
      parsed.search !== "" ||
      parsed.hash !== ""
    ) {
      return {
        error:
          "Blocked: allowed domain must be a DNS hostname.",
      };
    }

    return hostname;
  } catch {
    return {
      error:
        "Blocked: allowed domain is invalid.",
    };
  }
}


export interface ResolvedNetworkAddress {
  address: string;
  family: 4 | 6;
}

export type SupervisedNetworkResolver = (
  hostname: string,
) => Promise<
  readonly ResolvedNetworkAddress[]
>;

const defaultNetworkResolver:
  SupervisedNetworkResolver =
  async (hostname) => {
    const addresses = await dnsLookup(
      hostname,
      {
        all: true,
        verbatim: true,
      },
    );

    return addresses.map((entry) => ({
      address: entry.address,
      family:
        entry.family === 6 ? 6 : 4,
    }));
  };

export async function resolvePublicNetworkAddresses(
  hostname: string,
  resolver: SupervisedNetworkResolver =
    defaultNetworkResolver,
):
  Promise<
    | ResolvedNetworkAddress[]
    | { error: string }
  > {
  const normalizedHostname =
    normalizeAllowedDomain(hostname);

  if (
    typeof normalizedHostname !== "string"
  ) {
    return {
      error:
        "Blocked: DNS hostname is invalid.",
    };
  }

  let resolved:
    readonly ResolvedNetworkAddress[];

  try {
    resolved = await resolver(
      normalizedHostname,
    );
  } catch {
    return {
      error:
        "Blocked: DNS resolution failed.",
    };
  }

  if (
    !Array.isArray(resolved) ||
    resolved.length === 0
  ) {
    return {
      error:
        "Blocked: DNS returned no addresses.",
    };
  }

  const unique =
    new Map<string, ResolvedNetworkAddress>();

  for (const entry of resolved) {
    if (
      !entry ||
      (
        entry.family !== 4 &&
        entry.family !== 6
      ) ||
      isIP(entry.address) !==
        entry.family
    ) {
      return {
        error:
          "Blocked: DNS returned an invalid address.",
      };
    }

    if (
      !isPublicNetworkAddress(
        entry.address,
      )
    ) {
      return {
        error:
          "Blocked: DNS resolved to a non-public address.",
      };
    }

    unique.set(
      entry.family + ":" + entry.address,
      {
        address: entry.address,
        family: entry.family,
      },
    );
  }

  return [...unique.values()];
}

export interface ValidatedNetworkUrl {
  url: URL;
  hostname: string;
}

export function validateSupervisedNetworkUrl(
  rawUrl: unknown,
  allowedDomains: readonly string[],
):
  | ValidatedNetworkUrl
  | { error: string } {
  if (
    typeof rawUrl !== "string" ||
    rawUrl.length === 0 ||
    rawUrl.length > MAX_NETWORK_URL_LENGTH
  ) {
    return {
      error:
        "Blocked: network URL is missing or too long.",
    };
  }

  let parsed: URL;

  try {
    parsed = new URL(rawUrl);
  } catch {
    return {
      error:
        "Blocked: network URL is invalid.",
    };
  }

  if (parsed.protocol !== "https:") {
    return {
      error:
        "Blocked: supervised network access requires HTTPS.",
    };
  }

  if (
    parsed.username !== "" ||
    parsed.password !== ""
  ) {
    return {
      error:
        "Blocked: credentials are not allowed in network URLs.",
    };
  }

  if (
    parsed.port !== "" &&
    parsed.port !== "443"
  ) {
    return {
      error:
        "Blocked: only the standard HTTPS port is allowed.",
    };
  }

  if (parsed.hash !== "") {
    return {
      error:
        "Blocked: URL fragments are not allowed.",
    };
  }

  const hostname = parsed.hostname
    .toLowerCase()
    .replace(/\.$/, "");
  const unwrappedHostname =
    removeIpv6Brackets(hostname);

  if (isIP(unwrappedHostname) !== 0) {
    return {
      error:
        "Blocked: literal IP addresses are not allowed.",
    };
  }

  const normalizedAllowedDomains: string[] =
    [];

  for (const domain of allowedDomains) {
    const normalized =
      normalizeAllowedDomain(domain);

    if (typeof normalized !== "string") {
      return {
        error:
          "Blocked: network domain allowlist is invalid.",
      };
    }

    normalizedAllowedDomains.push(
      normalized,
    );
  }

  if (
    !normalizedAllowedDomains.includes(
      hostname,
    )
  ) {
    return {
      error:
        "Blocked: hostname is not in the exact authorized domain allowlist.",
    };
  }

  parsed.hostname = hostname;

  return {
    url: parsed,
    hostname,
  };
}
