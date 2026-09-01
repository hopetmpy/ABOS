import type {
  AbosConfig,
  AiConnectionMethod,
  AiRuntimeProvider,
  ModelEntry,
} from "../types.js";
import type { ModelRegistry } from "../inference/registry.js";

export type AiConnectionAvailability = "available" | "unavailable" | "unknown";

export interface AiConnectionSetupResult {
  configured: boolean;
  discoveredModels?: number;
}

export interface AiConnectionAdapter {
  /** Open provider identifier. No central enum owns this namespace. */
  id: AiRuntimeProvider;
  /** Open connection-method identifier. Built-ins include oauth/api_key/local. */
  method: AiConnectionMethod;
  label: string;
  description: string;

  /** Read-only configuration probe. Must not fabricate availability. */
  availability(config: AbosConfig): AiConnectionAvailability;

  /** Optional interactive/non-interactive setup hook owned by the adapter. */
  connect?: (config: AbosConfig) => Promise<AiConnectionSetupResult>;

  /** Optional disconnect hook. */
  disconnect?: (config: AbosConfig) => Promise<void>;

  /** Optional model discovery projected into the canonical ModelRegistry. */
  discoverModels?: (
    config: AbosConfig,
    registry: ModelRegistry,
  ) => Promise<number>;

  /** Adapter-native model compatibility, independent of model-name heuristics. */
  supportsModel?: (model: ModelEntry) => boolean;

  /** Optional provider-native model configuration (reasoning, service tier, etc.). */
  configureModel?: (
    config: AbosConfig,
    model: ModelEntry,
    options?: Record<string, string | undefined>,
  ) => Promise<void>;

}

export class AiConnectionAdapterRegistry {
  private readonly adapters = new Map<string, AiConnectionAdapter>();

  register(adapter: AiConnectionAdapter): void {
    if (!adapter.id?.trim()) throw new Error("AI connection adapter id is required");
    if (!adapter.method?.trim()) throw new Error(`AI connection adapter '${adapter.id}' has no method`);
    this.adapters.set(adapter.id, adapter);
  }

  registerMany(adapters: Iterable<AiConnectionAdapter>): void {
    for (const adapter of adapters) this.register(adapter);
  }

  get(id: string): AiConnectionAdapter | undefined {
    return this.adapters.get(id);
  }

  list(method?: string): AiConnectionAdapter[] {
    const all = [...this.adapters.values()];
    return method ? all.filter((adapter) => adapter.method === method) : all;
  }

  methods(): string[] {
    return [...new Set(this.list().map((adapter) => adapter.method))];
  }

  configured(config: AbosConfig): AiConnectionAdapter[] {
    return this.list().filter((adapter) => adapter.availability(config) === "available");
  }
}

/**
 * The three familiar methods are built-in UX conventions, not a closed type.
 * New adapters may register a different method without editing core types.
 */
export const BUILTIN_AI_CONNECTION_METHODS = [
  {
    id: "oauth",
    label: "Connect with OAuth",
    description: "Authorize through a provider-managed login/session.",
  },
  {
    id: "api_key",
    label: "Connect with API Key",
    description: "Use a provider-issued API credential.",
  },
  {
    id: "local",
    label: "Local / Self-hosted",
    description: "Use inference running on local or self-managed infrastructure.",
  },
] as const;

export function methodLabel(methodId: string): string {
  return BUILTIN_AI_CONNECTION_METHODS.find((method) => method.id === methodId)?.label
    ?? methodId;
}
