import { describe, expect, it } from "vitest";

import { InMemoryAgentEventBus } from "../../events/agentEventBus.js";
import { sha256Hex } from "../../replication/buildReplicationPayload.js";
import { PeriodicVerifier } from "../PeriodicVerifier.js";

const tenant = {
  userId: "u_user_1",
  agentId: "a_agent_1",
  walletId: "w_wallet_1",
};

describe("constitution periodic verifier", () => {
  it("checks every simulated minute for 60 minutes without pristine false positives", async () => {
    const pristine = "R9 periodic verifier pristine content";
    let current = pristine;
    const bus = new InMemoryAgentEventBus();
    const verifier = new PeriodicVerifier({
      expectedHash: sha256Hex(pristine),
      readConstitution: () => current,
      bus,
      tenant,
      intervalMs: 60_000,
    });

    const start = Date.UTC(2026, 3, 18, 0, 0, 0);
    for (let minute = 0; minute < 60; minute += 1) {
      await expect(
        verifier.tick(new Date(start + minute * 60_000)),
      ).resolves.toMatchObject({ checked: true, valid: true, published: false });
    }

    expect(bus.events).toHaveLength(0);

    current = `${pristine} drift`;
    await expect(
      verifier.tick(new Date(start + 60 * 60_000)),
    ).resolves.toMatchObject({ checked: true, valid: false, published: true });
    expect(bus.events).toHaveLength(1);
  });

  it("bounds verifier memory to 24 dedupe entries over a simulated 24h+ horizon", async () => {
    const pristine = "R9 bounded verifier content";
    let current = pristine;
    const verifier = new PeriodicVerifier({
      expectedHash: sha256Hex(pristine),
      readConstitution: () => current,
      bus: new InMemoryAgentEventBus(),
      tenant,
    });

    const start = Date.UTC(2026, 3, 18, 0, 0, 0);
    for (let hour = 0; hour < 36; hour += 1) {
      current = `${pristine} drift ${hour}`;
      await verifier.tick(new Date(start + hour * 60 * 60_000));
      expect(verifier.getDedupeEntryCount()).toBeLessThanOrEqual(24);
    }

    expect(verifier.getDedupeEntryCount()).toBe(24);
  });
});
