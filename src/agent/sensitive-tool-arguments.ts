export function redactToolArgumentsForPersistence(
  toolName: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  if (toolName === "remediate_capability" && "probeArguments" in args) {
    return {
      ...args,
      // The delegated operation receives the real arguments in memory and is
      // evaluated under its own Policy scope. The outer P-017 request must not
      // duplicate arbitrary provider payloads/secrets into durable tool/policy
      // records.
      probeArguments: "<redacted>",
    };
  }

  if (toolName !== "exec" && toolName !== "process_start") return args;
  const env = args.env;
  if (!env || typeof env !== "object" || Array.isArray(env)) return args;
  const redacted = Object.fromEntries(
    Object.keys(env as Record<string, unknown>)
      .sort()
      .map((key) => [key, "<redacted>"]),
  );
  return { ...args, env: redacted };
}
