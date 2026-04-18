import { ulid } from "ulid";

import {
  AGENT_EVENT_BUS_API_VERSION,
  assertAgentSystemAlertData,
  type AgentEventBus,
  type AgentSystemAlertBusEvent,
  type AgentSystemAlertData,
} from "../events/agentEventBus.js";

export interface ConstitutionMismatchAck {
  replicationFailureReason: "constitution_hash_mismatch";
  parentAgentId: string;
  childAgentId: string;
  userId: string;
  walletId: string;
  expectedHash: string;
  receivedHash: string;
  sandboxId: string;
}

function hourBucket(now: Date): string {
  const bucket = new Date(now);
  bucket.setUTCMinutes(0, 0, 0);
  return bucket.toISOString();
}

export function buildConstitutionMismatchDedupeKey(
  ack: ConstitutionMismatchAck,
  now: Date,
): string {
  return [
    "constitution.replication.mismatch",
    ack.parentAgentId,
    ack.childAgentId,
    ack.expectedHash,
    ack.receivedHash,
    hourBucket(now),
  ].join(":");
}

export function buildConstitutionMismatchAlertData(
  ack: ConstitutionMismatchAck,
): AgentSystemAlertData {
  const data = {
    severity: "P0",
    category: "constitution.replication.mismatch",
    title: "Child agent rejected constitution hash",
    details:
      `child=${ack.childAgentId} expected=${ack.expectedHash} received=${ack.receivedHash}. ` +
      "Child container torn down. Operator review required before respawn.",
    correlationId: `cor_${ulid()}`,
  } satisfies AgentSystemAlertData;

  assertAgentSystemAlertData(data);
  return data;
}

export function buildConstitutionMismatchBusEvent(
  ack: ConstitutionMismatchAck,
  now: Date = new Date(),
): AgentSystemAlertBusEvent {
  return {
    eventType: "agent.system.alert",
    apiVersion: AGENT_EVENT_BUS_API_VERSION,
    occurredAt: now.toISOString(),
    tenant: {
      userId: ack.userId,
      agentId: ack.parentAgentId,
      walletId: ack.walletId,
    },
    data: buildConstitutionMismatchAlertData(ack),
    dedupeKey: buildConstitutionMismatchDedupeKey(ack, now),
  };
}

export async function handleConstitutionMismatchAck(
  ack: ConstitutionMismatchAck,
  options: {
    bus: AgentEventBus;
    now?: Date;
    tearDownChild: (sandboxId: string) => Promise<void>;
  },
): Promise<{ tornDown: boolean; published: boolean; event: AgentSystemAlertBusEvent }> {
  const now = options.now ?? new Date();
  await options.tearDownChild(ack.sandboxId);
  const event = buildConstitutionMismatchBusEvent(ack, now);
  const published = await options.bus.publish(event);

  return {
    tornDown: true,
    published,
    event,
  };
}
