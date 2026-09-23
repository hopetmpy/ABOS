export function redactToolArgumentsForPersistence(
  toolName: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  if (toolName === "remediate_capability") {
    const redacted = { ...args };
    if ("probeArguments" in redacted) {
      // The delegated operation receives the real arguments in memory and is
      // evaluated under its own Policy scope. The outer P-017 request must not
      // duplicate arbitrary provider payloads/secrets into durable records.
      redacted.probeArguments = "<redacted>";
    }
    if ("constructionPlan" in redacted) {
      // Source construction may itself contain credentials, fixtures, or other
      // sensitive material. The exact plan remains available in-memory to the
      // protected P-012 call and Policy scope hash, but not durable outer logs.
      redacted.constructionPlan = "<redacted>";
    }
    return redacted;
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
