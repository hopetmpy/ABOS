export type SupervisedLevel = "S1" | "S2" | "S3";

export function getSupervisedLevel(): SupervisedLevel {
  const value = process.env.AUTOMATON_SUPERVISED_LEVEL;

  if (value === undefined || value === "" || value === "S1") {
    return "S1";
  }

  if (value === "S2") {
    return "S2";
  }

  if (value === "S3") {
    return "S3";
  }

  throw new Error(
    "Invalid AUTOMATON_SUPERVISED_LEVEL. Allowed values: S1, S2, or S3.",
  );
}

export function isSupervisedWriteEnabled(): boolean {
  return (
    process.env.AUTOMATON_SUPERVISED_MODE === "1" &&
    getSupervisedLevel() === "S2"
  );
}
