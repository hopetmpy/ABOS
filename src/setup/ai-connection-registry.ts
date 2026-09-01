import type {
  AiConnectionMethod,
  AiRuntimeProvider,
  ModelProvider,
} from "../types.js";

export type AiConnectionProviderAvailability = "available" | "future";

export interface AiConnectionMethodDefinition {
  id: AiConnectionMethod;
  label: string;
  description: string;
}

export interface AiConnectionProviderDefinition {
  id: string;
  label: string;
  method: AiConnectionMethod;
  description: string;
  availability: AiConnectionProviderAvailability;
  runtimeProvider?: AiRuntimeProvider;
  /**
   * Model-owner filters shown after connection.
   * Conway intentionally accepts multiple owners because it is a transport/
   * billing provider that can proxy models owned by other vendors.
   */
  modelProviders?: ModelProvider[];
}

export const AI_CONNECTION_METHODS: readonly AiConnectionMethodDefinition[] = [
  {
    id: "oauth",
    label: "Connect with OAuth",
    description: "Sign in through a provider-managed authorization flow.",
  },
  {
    id: "api_key",
    label: "Connect with API Key",
    description: "Use a provider-issued API credential.",
  },
  {
    id: "local",
    label: "Local / Self-hosted",
    description: "Use inference running on your own machine or infrastructure.",
  },
] as const;

export const AI_CONNECTION_PROVIDERS: readonly AiConnectionProviderDefinition[] = [
  {
    id: "codex",
    label: "ChatGPT / Codex",
    method: "oauth",
    description: "Official Codex device-code OAuth. Codex owns the ChatGPT session and token refresh.",
    availability: "available",
    runtimeProvider: "codex",
    modelProviders: ["codex"],
  },

  {
    id: "oauth-other",
    label: "Other OAuth provider",
    method: "oauth",
    description: "Extensible OAuth provider slot reserved for future adapters.",
    availability: "future",
  },

  {
    id: "openai",
    label: "OpenAI",
    method: "api_key",
    description: "Direct OpenAI API key.",
    availability: "available",
    runtimeProvider: "openai",
    modelProviders: ["openai"],
  },
  {
    id: "anthropic",
    label: "Anthropic",
    method: "api_key",
    description: "Direct Anthropic API key.",
    availability: "available",
    runtimeProvider: "anthropic",
    modelProviders: ["anthropic"],
  },
  {
    id: "conway",
    label: "Conway",
    method: "api_key",
    description: "Use the Conway API credential for inference. An identity-provisioned key can be reused.",
    availability: "available",
    runtimeProvider: "conway",
    modelProviders: ["openai", "anthropic", "conway", "other"],
  },
  {
    id: "groq",
    label: "Groq",
    method: "api_key",
    description: "Provider adapter reserved for a future implementation.",
    availability: "future",
  },
  {
    id: "together",
    label: "Together",
    method: "api_key",
    description: "Provider adapter reserved for a future implementation.",
    availability: "future",
  },
  {
    id: "api-compatible-other",
    label: "Other compatible provider",
    method: "api_key",
    description: "Extensible API-key provider slot reserved for a future adapter.",
    availability: "future",
  },

  {
    id: "ollama",
    label: "Ollama",
    method: "local",
    description: "Local Ollama runtime discovered from its /api/tags endpoint.",
    availability: "available",
    runtimeProvider: "ollama",
    modelProviders: ["ollama"],
  },
  {
    id: "openai-compatible-local",
    label: "OpenAI-compatible endpoint",
    method: "local",
    description: "Generic local OpenAI-compatible endpoint adapter reserved for a future implementation.",
    availability: "future",
  },
  {
    id: "local-other",
    label: "Other local runtime",
    method: "local",
    description: "Extensible local-runtime slot reserved for future adapters.",
    availability: "future",
  },
] as const;

export function getAiProvidersForMethod(
  method: AiConnectionMethod,
): AiConnectionProviderDefinition[] {
  return AI_CONNECTION_PROVIDERS.filter((provider) => provider.method === method);
}

export function getAiProviderDefinition(
  id: string,
): AiConnectionProviderDefinition | undefined {
  return AI_CONNECTION_PROVIDERS.find((provider) => provider.id === id);
}

export function isAvailableAiProvider(
  provider: AiConnectionProviderDefinition,
): provider is AiConnectionProviderDefinition & { runtimeProvider: AiRuntimeProvider } {
  return provider.availability === "available" && !!provider.runtimeProvider;
}
