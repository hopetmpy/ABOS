
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export interface TrustedHttpUrlOptions {
  allowHttpOnLoopback?: boolean;
  rejectEmbeddedCredentials?: boolean;
  stripHash?: boolean;
}

export function isLoopbackHostname(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname.trim().toLowerCase());
}

/**
 * Canonical ABOS HTTP URL trust rule.
 *
 * Remote transport requires HTTPS. Plain HTTP is accepted only for loopback
 * when a caller explicitly opts into it. Callers may additionally reject URL
 * embedded credentials and strip fragments before transport.
 */
export function trustedHttpUrl(
  rawUrl: string,
  options: TrustedHttpUrlOptions = {},
): string {
  const value = rawUrl.trim();
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }

  if (
    options.rejectEmbeddedCredentials !== false &&
    (parsed.username || parsed.password)
  ) {
    throw new Error("URL must not embed credentials");
  }

  const protocol = parsed.protocol.toLowerCase();
  const loopbackHttp =
    protocol === "http:" &&
    options.allowHttpOnLoopback === true &&
    isLoopbackHostname(parsed.hostname);
  if (protocol !== "https:" && !loopbackHttp) {
    throw new Error(
      `HTTPS required: refusing insecure URL ${rawUrl}. ` +
        "For local development, only loopback HTTP (localhost/127.0.0.1/::1) can be explicitly enabled.",
    );
  }

  if (options.stripHash) parsed.hash = "";
  return parsed.toString();
}

export function assertTrustedHttpUrl(
  rawUrl: string,
  options: TrustedHttpUrlOptions = {},
): void {
  trustedHttpUrl(rawUrl, options);
}
