import { sha256Hex } from "./buildReplicationPayload.js";
import {
  assertReplicationPayload,
  type ReplicationPayload,
} from "./replicationPayload.js";

export type ReplicationFailureReason = "constitution_hash_mismatch";

export type ChildBootConstitutionResult =
  | { accepted: true; constitutionHash: string }
  | {
      accepted: false;
      replicationFailureReason: ReplicationFailureReason;
      expectedHash: string;
      receivedHash: string;
    };

export function verifyReplicationPayloadConstitution(
  payload: ReplicationPayload,
): ChildBootConstitutionResult {
  try {
    assertReplicationPayload(payload);
  } catch {
    return {
      accepted: false,
      replicationFailureReason: "constitution_hash_mismatch",
      expectedHash: payload.constitutionHash || "missing",
      receivedHash: "missing",
    };
  }

  const receivedHash = sha256Hex(payload.constitutionContent);
  if (receivedHash !== payload.constitutionHash) {
    return {
      accepted: false,
      replicationFailureReason: "constitution_hash_mismatch",
      expectedHash: payload.constitutionHash,
      receivedHash,
    };
  }

  return {
    accepted: true,
    constitutionHash: payload.constitutionHash,
  };
}
