import type { PersistedPath, NoveltyAssessment } from "./types.js";
import { pathSignature, conditionFingerprint } from "./path-signature.js";
import type { PathCandidate } from "./types.js";

export function assessPathNovelty(params: {
  candidate: PathCandidate;
  previousPaths: PersistedPath[];
  previousConditionFingerprints?: Map<string, string>;
  conditions?: Record<string, unknown>;
}): NoveltyAssessment {
  const signature = pathSignature(params.candidate);
  const equivalent = params.previousPaths.find((path) => path.signature === signature);

  if (!equivalent) {
    return {
      novel: true,
      score: 1,
      conditionChanged: false,
      reason: "No substantially equivalent path exists in recorded history.",
    };
  }

  const currentCondition = conditionFingerprint(params.conditions);
  const previousCondition = params.previousConditionFingerprints?.get(equivalent.id);
  const conditionChanged = !!previousCondition && previousCondition !== currentCondition;

  if (conditionChanged) {
    return {
      novel: true,
      score: 0.45,
      equivalentPathId: equivalent.id,
      conditionChanged: true,
      reason: "The conceptual path is equivalent, but material runtime conditions changed.",
    };
  }

  return {
    novel: false,
    score: 0,
    equivalentPathId: equivalent.id,
    conditionChanged: false,
    reason: "The conceptual path and known conditions are substantially unchanged.",
  };
}
