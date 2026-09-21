export function redactToolArgumentsForPersistence(
  toolName: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
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
