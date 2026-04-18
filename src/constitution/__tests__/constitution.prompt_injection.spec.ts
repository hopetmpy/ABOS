import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

import { assertAgentSystemAlertData, InMemoryAgentEventBus } from "../../events/agentEventBus.js";
import { sha256Hex } from "../../replication/buildReplicationPayload.js";
import { ConstitutionGuard } from "../ConstitutionGuard.js";

interface CorpusEntry {
  id: string;
  text: string;
}

const tenant = {
  userId: "u_user_1",
  agentId: "a_agent_1",
  walletId: "w_wallet_1",
};

function loadCorpus(): CorpusEntry[] {
  return JSON.parse(
    readFileSync(new URL("../__fixtures__/injection_corpus.json", import.meta.url), "utf-8"),
  ) as CorpusEntry[];
}

describe("constitution prompt-injection alerts", () => {
  it("denies all corpus prompts and emits hash-only Contract 03 alert data", async () => {
    const corpus = loadCorpus();
    const bus = new InMemoryAgentEventBus();
    const guard = new ConstitutionGuard({
      expectedHash: sha256Hex("pristine"),
      readConstitution: () => "pristine",
      bus,
      tenant,
    });

    expect(corpus).toHaveLength(50);

    for (const entry of corpus) {
      const decision = await guard.assertAllowed(entry.text, {
        corpusEntry: entry.id,
        now: new Date("2026-04-18T00:00:00.000Z"),
      });
      const promptDigest = sha256Hex(entry.text);

      expect(decision).toEqual({
        denied: true,
        promptDigest,
        corpusEntry: entry.id,
      });

      const event = bus.events.at(-1);
      expect(event).toBeDefined();
      expect(event?.data).toEqual({
        severity: "P1",
        category: "constitution.prompt_injection",
        title: "Prompt-injection attempt denied",
        details: `promptDigest=${promptDigest} corpusEntry=${entry.id} denied=true`,
        correlationId: event?.data.correlationId,
      });
      expect(event?.data.details).not.toContain(entry.text);
      expect(() => assertAgentSystemAlertData(event?.data)).not.toThrow();
    }

    expect(bus.events).toHaveLength(50);

    const emittedJson = JSON.stringify(bus.events);
    for (const entry of corpus) {
      expect(emittedJson).not.toContain(entry.text);
    }
  });
});
