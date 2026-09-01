import type { FailureDiagnosis } from "./types.js";

const matches = (text: string, patterns: RegExp[]): boolean =>
  patterns.some((pattern) => pattern.test(text));

export function classifyFailure(error: string): FailureDiagnosis {
  const text = error.toLowerCase();

  if (matches(text, [
    /forbidden/,
    /prohibited/,
    /policy denied/,
    /not authorized by policy/,
    /permission explicitly denied/,
  ])) {
    return {
      classification: "prohibited",
      reason: "The path is excluded by an explicit policy or prohibition.",
      technicalRetryEligible: false,
      strategicReplanRequired: true,
      waitForConditionChange: false,
      terminalForPath: true,
      suggestedActions: ["Exclude this path and evaluate other eligible paths."],
    };
  }

  if (matches(text, [
    /401\b/,
    /403\b/,
    /unauthori[sz]ed/,
    /invalid.*token/,
    /expired.*token/,
    /invalid.*credential/,
    /missing.*credential/,
    /access denied/,
    /authentication/,
  ])) {
    return {
      classification: "authorization",
      reason: "The current path lacks valid authorization or credentials.",
      technicalRetryEligible: false,
      strategicReplanRequired: true,
      waitForConditionChange: true,
      terminalForPath: false,
      suggestedActions: [
        "Acquire or refresh legitimate authorization.",
        "Evaluate an alternative authorized route.",
      ],
    };
  }

  if (matches(text, [
    /command not found/,
    /module not found/,
    /cannot find module/,
    /no such tool/,
    /tool .* unavailable/,
    /missing dependency/,
    /not installed/,
    /unsupported capability/,
  ])) {
    return {
      classification: "capability_missing",
      reason: "The path requires a capability that is not currently available.",
      technicalRetryEligible: false,
      strategicReplanRequired: true,
      waitForConditionChange: false,
      terminalForPath: false,
      suggestedActions: [
        "Discover an existing capability.",
        "Acquire or install the missing capability.",
        "Compose existing capabilities.",
        "Construct a capability if no suitable one exists.",
      ],
    };
  }

  if (matches(text, [
    /insufficient credits/,
    /insufficient funds/,
    /out of memory/,
    /no space left/,
    /quota exceeded/,
    /resource exhausted/,
    /capacity unavailable/,
  ])) {
    return {
      classification: "resource_unavailable",
      reason: "The path is viable in principle but the required resource is unavailable.",
      technicalRetryEligible: false,
      strategicReplanRequired: true,
      waitForConditionChange: true,
      terminalForPath: false,
      suggestedActions: [
        "Acquire the required resource.",
        "Reduce resource requirements.",
        "Evaluate another environment.",
      ],
    };
  }

  if (matches(text, [
    /econnreset/,
    /econnrefused/,
    /etimedout/,
    /timeout/,
    /timed out/,
    /eai_again/,
    /429\b/,
    /502\b/,
    /503\b/,
    /504\b/,
    /temporar(?:y|ily) unavailable/,
    /network.*unreachable/,
  ])) {
    return {
      classification: "transient",
      reason: "The failure appears transient and may justify a bounded technical retry.",
      technicalRetryEligible: true,
      strategicReplanRequired: false,
      waitForConditionChange: true,
      terminalForPath: false,
      suggestedActions: [
        "Retry only after a meaningful delay or connectivity/availability change.",
      ],
    };
  }

  if (matches(text, [
    /sandbox unavailable/,
    /environment unavailable/,
    /host unavailable/,
    /service unavailable/,
    /runtime unavailable/,
    /platform unsupported/,
  ])) {
    return {
      classification: "environment_unavailable",
      reason: "The selected execution environment cannot currently satisfy the path.",
      technicalRetryEligible: false,
      strategicReplanRequired: true,
      waitForConditionChange: true,
      terminalForPath: false,
      suggestedActions: [
        "Evaluate another registered environment.",
        "Reconsider environment requirements.",
      ],
    };
  }

  if (matches(text, [
    /assumption.*false/,
    /assumption.*invalid/,
    /does not exist/,
    /not supported/,
    /invalid premise/,
    /expected .* but/,
  ])) {
    return {
      classification: "assumption_invalid",
      reason: "Evidence contradicts an assumption underlying the path.",
      technicalRetryEligible: false,
      strategicReplanRequired: true,
      waitForConditionChange: false,
      terminalForPath: true,
      suggestedActions: [
        "Invalidate the contradicted assumption.",
        "Rebuild the possibility space without that assumption.",
      ],
    };
  }

  if (matches(text, [
    /physically impossible/,
    /mathematically impossible/,
    /cannot be satisfied under any/,
    /impossible under current invariants/,
  ])) {
    return {
      classification: "impossible",
      reason: "The path is demonstrated impossible under the stated invariants.",
      technicalRetryEligible: false,
      strategicReplanRequired: true,
      waitForConditionChange: false,
      terminalForPath: true,
      suggestedActions: ["Exclude the path and preserve the evidence supporting impossibility."],
    };
  }

  return {
    classification: "strategic_failure",
    reason: "The path failed without evidence of a merely transient technical condition.",
    technicalRetryEligible: false,
    strategicReplanRequired: true,
    waitForConditionChange: false,
    terminalForPath: true,
    suggestedActions: [
      "Update the world model from the failure evidence.",
      "Generate a materially different path.",
    ],
  };
}
