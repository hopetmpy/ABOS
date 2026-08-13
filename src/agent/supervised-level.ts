export type SupervisedLevel = "S1" | "S2";

export function getSupervisedLevel(): SupervisedLevel {
  const value = process.env.AUTOMATON_SUPERVISED_LEVEL;

  if (value === undefined || value === "" || value === "S1") {
    return "S1";
  }

  if (value === "S2") {
    return "S2";
  }

  throw new Error(
    "Invalid AUTOMATON_SUPERVISED_LEVEL. Allowed values: S1 or S2.",
  );
}

export function isSupervisedWriteEnabled(): boolean {
  return (
    process.env.AUTOMATON_SUPERVISED_MODE === "1" &&
    getSupervisedLevel() === "S2"
  );
}
