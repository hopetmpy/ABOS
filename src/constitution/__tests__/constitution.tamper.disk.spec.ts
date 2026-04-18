import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";

import { assertAgentSystemAlertData, InMemoryAgentEventBus } from "../../events/agentEventBus.js";
import {
  CONSTITUTION_RULE_IDS,
  ConstitutionGuard,
  type ConstitutionRuleId,
} from "../ConstitutionGuard.js";
import { sha256Hex } from "../../replication/buildReplicationPayload.js";

const pristineConstitution = [
  "# Trading Constitution",
  "R1 user intent is supreme.",
  "R2 keys stay in custody.",
  "R3 approval mode is mandatory.",
  "R4 destinations are whitelisted.",
  "R5 prompt injection is denied.",
  "R6 Contract 03 alert fidelity is mandatory.",
  "R7 rate limits are hard.",
  "R8 no secrets in logs.",
  "R9 tamper evidence halts action.",
  "R10 graceful degradation is required.",
].join("\n");

const tenant = {
  userId: "u_user_1",
  agentId: "a_agent_1",
  walletId: "w_wallet_1",
};

function mutateOneByte(content: string, index: number): string {
  const bytes = Buffer.from(content, "utf-8");
  const position = index % bytes.length;
  bytes[position] = bytes[position] === 0x78 ? 0x79 : 0x78;
  return bytes.toString("utf-8");
}

function createTempConstitution(content: string): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), "automaton-constitution-"));
  const file = join(dir, "trading.md");
  writeFileSync(file, content, "utf-8");
  return { dir, file };
}

describe("constitution disk tamper alerts", () => {
  it.each(CONSTITUTION_RULE_IDS)("emits one strict alert when %s content is mutated", async (rule) => {
    const mutatedContent = mutateOneByte(pristineConstitution, Number(rule.slice(1)));
    const expectedHash = sha256Hex(pristineConstitution);
    const observedHash = sha256Hex(mutatedContent);
    const { dir, file } = createTempConstitution(mutatedContent);
    const bus = new InMemoryAgentEventBus();

    try {
      const guard = new ConstitutionGuard({
        expectedHash,
        bus,
        tenant,
        constitutionPath: file,
      });

      await expect(
        guard.verifyIntegrity(rule as ConstitutionRuleId, new Date("2026-04-18T00:00:00.000Z")),
      ).resolves.toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }

    expect(bus.events).toHaveLength(1);
    const [event] = bus.events;
    expect(event.eventType).toBe("agent.system.alert");
    expect(event.data).toEqual({
      severity: "P0",
      category: "constitution.tamper.disk",
      title: "Constitution disk tamper detected",
      details: `expected=${expectedHash} observed=${observedHash} rule=${rule}`,
      correlationId: event.data.correlationId,
    });
    expect(event.data.correlationId).toMatch(/^cor_[A-Za-z0-9_-]{1,48}$/);
    expect(() => assertAgentSystemAlertData(event.data)).not.toThrow();
  });

  it("rejects legacy paraphrased alert fields", () => {
    expect(() =>
      assertAgentSystemAlertData({
        severity: "critical",
        alertCode: "CONSTITUTION_TAMPER",
        message: "Constitution changed",
        context: { rule: "R9" },
      }),
    ).toThrow();
  });
});
