import { describe, expect, it, vi } from "vitest";

import { buildReplicationPayload, sha256Hex } from "../replication/buildReplicationPayload.js";
import { verifyReplicationPayloadConstitution } from "../replication/childBoot.js";
import {
  assertAgentSystemAlertData,
  InMemoryAgentEventBus,
} from "../events/agentEventBus.js";
import {
  buildConstitutionMismatchBusEvent,
  handleConstitutionMismatchAck,
  type ConstitutionMismatchAck,
} from "../replication/parentReplicationCoordinator.js";
import type { AutomatonIdentity, GenesisConfig } from "../types.js";

const constitutionContent = "# Trading Constitution\n\nR1: user intent is supreme.\n";

const identity = {
  name: "parent",
  address: "0x1111111111111111111111111111111111111111",
  creatorAddress: "0x2222222222222222222222222222222222222222",
  sandboxId: "parent-sandbox",
  apiKey: "test-api-key",
  createdAt: "2026-04-18T00:00:00.000Z",
  chainType: "evm",
} as AutomatonIdentity;

const genesis: GenesisConfig = {
  name: "child-alpha",
  genesisPrompt: "Trade only within explicit user limits.",
  creatorMessage: "Boot with constitution verification.",
  creatorAddress: identity.address,
  parentAddress: identity.address,
  chainType: "evm",
};

function mismatchAck(overrides: Partial<ConstitutionMismatchAck> = {}): ConstitutionMismatchAck {
  return {
    replicationFailureReason: "constitution_hash_mismatch",
    parentAgentId: "a_parent",
    childAgentId: "a_child",
    userId: "u_user_1",
    walletId: "w_wallet_1",
    expectedHash: sha256Hex(constitutionContent),
    receivedHash: sha256Hex(`${constitutionContent}mutated`),
    sandboxId: "sandbox-child",
    ...overrides,
  };
}

function mutate(content: string, index: number): string {
  const position = index % content.length;
  const replacement = content[position] === "x" ? "y" : "x";
  return `${content.slice(0, position)}${replacement}${content.slice(position + 1)}`;
}

describe("replication payload constitution propagation", () => {
  it("builds a versioned payload with constitutionContent and matching lower-hex hash", () => {
    const payload = buildReplicationPayload(genesis, identity, {
      constitutionContent,
    });

    expect(payload.replicationPayloadSchemaVersion).toBe("replication-payload/v2");
    expect(payload.constitutionApiVersion).toBe("2026-04-13");
    expect(payload.constitutionContent).toBe(constitutionContent);
    expect(payload.constitutionHash).toBe(sha256Hex(constitutionContent));
    expect(payload.constitutionHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("child accepts the canonical payload and rejects missing hash", () => {
    const payload = buildReplicationPayload(genesis, identity, {
      constitutionContent,
    });

    expect(verifyReplicationPayloadConstitution(payload)).toEqual({
      accepted: true,
      constitutionHash: payload.constitutionHash,
    });

    expect(
      verifyReplicationPayloadConstitution({
        ...payload,
        constitutionHash: "",
      }),
    ).toMatchObject({
      accepted: false,
      replicationFailureReason: "constitution_hash_mismatch",
    });
  });

  it("rejects 1000 mutated constitution contents", () => {
    const payload = buildReplicationPayload(genesis, identity, {
      constitutionContent,
    });

    for (let index = 0; index < 1000; index += 1) {
      const result = verifyReplicationPayloadConstitution({
        ...payload,
        constitutionContent: mutate(constitutionContent, index),
      });
      expect(result.accepted).toBe(false);
      if (!result.accepted) {
        expect(result.replicationFailureReason).toBe("constitution_hash_mismatch");
        expect(result.expectedHash).toBe(payload.constitutionHash);
      }
    }
  });

  it("builds strict Contract 03 v1.1.0 system alert data without legacy keys", () => {
    const event = buildConstitutionMismatchBusEvent(mismatchAck(), new Date("2026-04-18T00:30:00.000Z"));

    expect(event.eventType).toBe("agent.system.alert");
    expect(event.apiVersion).toBe("2026-04-13");
    expect(event.tenant.agentId).toBe("a_parent");
    expect(event.data).toMatchObject({
      severity: "P0",
      category: "constitution.replication.mismatch",
      title: "Child agent rejected constitution hash",
    });
    expect(event.data.details).toContain("child=a_child");
    expect(event.data.details).toContain("expected=");
    expect(event.data.details).toContain("received=");
    expect(Object.keys(event.data).sort()).toEqual([
      "category",
      "correlationId",
      "details",
      "severity",
      "title",
    ]);
  });

  it("rejects legacy alert keys before the bus boundary", () => {
    expect(() =>
      assertAgentSystemAlertData({
        severity: "critical",
        alertCode: "CONSTITUTION_MISMATCH",
        message: "hash mismatch",
        context: { childAgentId: "a_child" },
      }),
    ).toThrow();
  });

  it("tears down once and publishes one bus event per dedupe window", async () => {
    const bus = new InMemoryAgentEventBus();
    const tearDownChild = vi.fn(async () => {});
    const ack = mismatchAck();
    const now = new Date("2026-04-18T00:30:00.000Z");

    const first = await handleConstitutionMismatchAck(ack, {
      bus,
      now,
      tearDownChild,
    });
    const duplicate = await handleConstitutionMismatchAck(ack, {
      bus,
      now: new Date("2026-04-18T00:45:00.000Z"),
      tearDownChild,
    });

    expect(first.published).toBe(true);
    expect(duplicate.published).toBe(false);
    expect(tearDownChild).toHaveBeenCalledTimes(2);
    expect(bus.events).toHaveLength(1);
    expect(bus.events[0].dedupeKey).toContain("2026-04-18T00:00:00.000Z");
  });
});
