import { afterEach, describe, expect, it, vi } from "vitest";
import { createConwayClient } from "../conway/client.js";

afterEach(() => vi.unstubAllGlobals());

describe("P-030 Conway transfer wire response provenance", () => {
  it("does not fabricate recipient or amount from an incomplete provider response", async () => {
    const mock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ transfer_id: "provider-wire", status: "completed" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));
    vi.stubGlobal("fetch", mock);
    const client = createConwayClient({
      apiUrl: "https://api.conway.tech",
      apiKey: "test-secret", sandboxId: "sandbox-test",
    });
    const result = await client.transferCredits("0xrequested", 420, "test", {
      idempotencyKey: "durable-economics-key",
    });
    expect(result.transferId).toBe("provider-wire");
    expect(result.status).toBe("completed");
    expect(result.toAddress).toBeUndefined();
    expect(result.amountCents).toBeUndefined();
    const request = mock.mock.calls[0];
    expect(request[1].headers["Idempotency-Key"]).toBe("durable-economics-key");
  });

  it("retains independently echoed provider terms", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({
        transfer_id: "provider-wire-ok", status: "completed",
        to_address: "0xrecipient", amount_cents: 420,
      }), { status: 200, headers: { "Content-Type": "application/json" } },
    )));
    const client = createConwayClient({
      apiUrl: "https://api.conway.tech",
      apiKey: "test-secret", sandboxId: "sandbox-test",
    });
    const result = await client.transferCredits("0xrecipient", 420, "test", {
      idempotencyKey: "durable-economics-key",
    });
    expect(result.toAddress).toBe("0xrecipient");
    expect(result.amountCents).toBe(420);
  });
});
