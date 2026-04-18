import { ulid } from "ulid";

import {
  AGENT_EVENT_BUS_API_VERSION,
  assertAgentSystemAlertData,
  type AgentEventBus,
  type AgentSystemAlertBusEvent,
  type AgentSystemAlertData,
} from "../events/agentEventBus.js";

export interface ConstitutionAlertTenant {
  userId: string;
  agentId: string;
  walletId: string;
}

export type ConstitutionAlertCategory =
  | "constitution.tamper.disk"
  | "constitution.tamper.runtime"
  | "constitution.prompt_injection";

export function hourBucket(now: Date): string {
  const bucket = new Date(now);
  bucket.setUTCMinutes(0, 0, 0);
  return bucket.toISOString();
}

export function buildConstitutionAlertEvent(input: {
  tenant: ConstitutionAlertTenant;
  severity: AgentSystemAlertData["severity"];
  category: ConstitutionAlertCategory;
  title: string;
  details: string;
  dedupeKey: string;
  now: Date;
}): AgentSystemAlertBusEvent {
  const data = {
    severity: input.severity,
    category: input.category,
    title: input.title,
    details: input.details,
    correlationId: `cor_${ulid()}`,
  } satisfies AgentSystemAlertData;

  assertAgentSystemAlertData(data);

  return {
    eventType: "agent.system.alert",
    apiVersion: AGENT_EVENT_BUS_API_VERSION,
    occurredAt: input.now.toISOString(),
    tenant: input.tenant,
    data,
    dedupeKey: input.dedupeKey,
  };
}

export async function publishConstitutionAlert(input: {
  bus: AgentEventBus;
  tenant: ConstitutionAlertTenant;
  severity: AgentSystemAlertData["severity"];
  category: ConstitutionAlertCategory;
  title: string;
  details: string;
  dedupeKey: string;
  now: Date;
}): Promise<{ published: boolean; event: AgentSystemAlertBusEvent }> {
  const event = buildConstitutionAlertEvent(input);
  const published = await input.bus.publish(event);
  return { published, event };
}
