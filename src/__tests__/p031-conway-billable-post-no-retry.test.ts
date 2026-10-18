import { afterEach, describe, expect, it, vi } from "vitest";
import { createConwayClient } from "../conway/client.js";

describe("P-031 Conway provider-native billable creation does not auto-replay", () => {
  afterEach(() => vi.unstubAllGlobals());

  function client(fetcher: ReturnType<typeof vi.fn>) {
    vi.stubGlobal("fetch", fetcher);
    return createConwayClient({
      apiUrl: "https://api.conway.tech",
      apiKey: "synthetic-key",
      sandboxId: "controller",
    });
  }

  it.each(["sandbox", "domain"] as const)(
    "%s rejects a 502 without silently dispatching a second paid operation",
    async kind => {
      const fetcher = vi.fn(async () => new Response("upstream 502", { status: 502 }));
      const conway = client(fetcher);
      const create = kind === "sandbox"
        ? conway.createSandbox({ name: "paid-service", vcpu: 1, memoryMb: 512, diskGb: 5 })
        : conway.registerDomain("example-business.test", 1);
      await expect(create).rejects.toThrow(/502/);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(fetcher.mock.calls[0]![1].method).toBe("POST");
    },
  );

  it.each(["sandbox", "domain"] as const)(
    "%s preserves an ambiguous network outcome without automatic paid replay",
    async kind => {
      const fetcher = vi.fn(async () => {
        throw new Error("response lost after supplier may have accepted operation");
      });
      const conway = client(fetcher);
      const create = kind === "sandbox"
        ? conway.createSandbox({ name: "paid-service", vcpu: 1, memoryMb: 512, diskGb: 5 })
        : conway.registerDomain("example-business.test", 1);
      await expect(create).rejects.toThrow(/response lost/);
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );

  it("still permits a single valid sandbox create, without changing supplier response data", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      id: "sbx-one", status: "running", region: "test",
      vcpu: 1, memory_mb: 512, disk_gb: 5,
    }), { status: 201, headers: { "content-type": "application/json" } }));
    const sandbox = await client(fetcher).createSandbox({
      name: "authorized-by-upstream-caller", vcpu: 1, memoryMb: 512, diskGb: 5,
    });
    expect(sandbox.id).toBe("sbx-one");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("still returns a supplier domain receipt after exactly one valid request", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      domain: "example-business.test", status: "registered",
      transaction_id: "domain-fixture-1",
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const receipt = await client(fetcher).registerDomain("example-business.test", 1);
    expect(receipt.transactionId).toBe("domain-fixture-1");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
