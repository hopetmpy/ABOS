import { describe, expect, it } from "vitest";

import { assertAgentSystemAlertData, InMemoryAgentEventBus } from "../../events/agentEventBus.js";
import { PeriodicVerifier } from "../PeriodicVerifier.js";
import { sha256Hex } from "../../replication/buildReplicationPayload.js";

const tenant = {
  userId: "u_user_1",
  agentId: "a_agent_1",
  walletId: "w_wallet_1",
};

describe("constitution runtime tamper alerts", () => {
  it("emits one strict runtime drift alert per observed hash and hour", async () => {
    const pristine = "R9 tamper-evident constitution content";
    let current = pristine;
    const bus = new InMemoryAgentEventBus();
    const verifier = new PeriodicVerifier({
      expectedHash: sha256Hex(pristine),
      readConstitution: () => current,
      bus,
      tenant,
    });

    await expect(
      verifier.tick(new Date("2026-04-18T00:00:00.000Z")),
    ).resolves.toMatchObject({ valid: true, published: false });
    expect(bus.events).toHaveLength(0);

    current = `${pristine} mutated in memory`;
    const observedHash = sha256Hex(current);
    const first = await verifier.tick(new Date("2026-04-18T00:01:00.000Z"));
    const duplicate = await verifier.tick(new Date("2026-04-18T00:30:00.000Z"));

    expect(first).toMatchObject({
      valid: false,
      observedHash,
      published: true,
    });
    expect(duplicate).toMatchObject({
      valid: false,
      observedHash,
      published: false,
    });
    expect(bus.events).toHaveLength(1);
    expect(bus.events[0].data).toEqual({
      severity: "P0",
      category: "constitution.tamper.runtime",
      title: "Constitution runtime drift detected",
      details: `expected=${sha256Hex(pristine)} observed=${observedHash} rule=none`,
      correlationId: bus.events[0].data.correlationId,
    });
    expect(() => assertAgentSystemAlertData(bus.events[0].data)).not.toThrow();
  });
});
