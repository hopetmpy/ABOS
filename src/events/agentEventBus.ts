export const AGENT_EVENT_BUS_API_VERSION = "2026-04-13" as const;

export interface AgentSystemAlertData {
  severity: "P0" | "P1" | "P2";
  category: string;
  title: string;
  details: string;
  correlationId: `cor_${string}`;
}

export interface AgentSystemAlertBusEvent {
  eventType: "agent.system.alert";
  apiVersion: typeof AGENT_EVENT_BUS_API_VERSION;
  occurredAt: string;
  tenant: {
    userId: string;
    agentId: string;
    walletId: string;
  };
  data: AgentSystemAlertData;
  dedupeKey: string;
}

export interface AgentEventBus {
  publish(event: AgentSystemAlertBusEvent): Promise<boolean>;
}

function assertKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`Invalid agent.system.alert data keys: ${actual.join(",")}`);
  }
}

export function assertAgentSystemAlertData(data: unknown): asserts data is AgentSystemAlertData {
  if (typeof data !== "object" || data === null) {
    throw new Error("agent.system.alert data must be an object");
  }

  const record = data as Record<string, unknown>;
  assertKeys(record, ["severity", "category", "title", "details", "correlationId"]);

  if (!["P0", "P1", "P2"].includes(String(record.severity))) {
    throw new Error("Invalid agent.system.alert severity");
  }
  if (typeof record.category !== "string" || record.category.length < 1 || record.category.length > 64) {
    throw new Error("Invalid agent.system.alert category");
  }
  if (typeof record.title !== "string" || record.title.length < 1 || record.title.length > 120) {
    throw new Error("Invalid agent.system.alert title");
  }
  if (typeof record.details !== "string" || record.details.length < 1 || record.details.length > 2000) {
    throw new Error("Invalid agent.system.alert details");
  }
  if (typeof record.correlationId !== "string" || !/^cor_[A-Za-z0-9_-]{1,48}$/.test(record.correlationId)) {
    throw new Error("Invalid agent.system.alert correlationId");
  }
}

export class InMemoryAgentEventBus implements AgentEventBus {
  readonly events: AgentSystemAlertBusEvent[] = [];
  private readonly dedupeKeys = new Set<string>();

  async publish(event: AgentSystemAlertBusEvent): Promise<boolean> {
    assertAgentSystemAlertData(event.data);
    if (this.dedupeKeys.has(event.dedupeKey)) {
      return false;
    }

    this.dedupeKeys.add(event.dedupeKey);
    this.events.push(event);
    return true;
  }
}
