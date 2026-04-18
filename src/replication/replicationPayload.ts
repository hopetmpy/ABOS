export const REPLICATION_PAYLOAD_SCHEMA_VERSION = "replication-payload/v2" as const;
export const REPLICATION_CONSTITUTION_API_VERSION = "2026-04-13" as const;

export interface ReplicationPayload {
  replicationPayloadSchemaVersion: typeof REPLICATION_PAYLOAD_SCHEMA_VERSION;
  name: string;
  genesisPrompt: string;
  creatorMessage?: string;
  creatorAddress: string;
  parentAddress: string;
  chainType: string;
  constitutionContent: string;
  constitutionHash: string;
  constitutionApiVersion: typeof REPLICATION_CONSTITUTION_API_VERSION;
}

export function isSha256Hex(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}

export function assertReplicationPayload(
  payload: ReplicationPayload,
): ReplicationPayload {
  if (payload.replicationPayloadSchemaVersion !== REPLICATION_PAYLOAD_SCHEMA_VERSION) {
    throw new Error("Unsupported replication payload schema version");
  }
  if (!payload.constitutionContent) {
    throw new Error("Missing constitutionContent");
  }
  if (!isSha256Hex(payload.constitutionHash)) {
    throw new Error("Missing or invalid constitutionHash");
  }
  if (payload.constitutionApiVersion !== REPLICATION_CONSTITUTION_API_VERSION) {
    throw new Error("Unsupported constitution API version");
  }
  return payload;
}
