import {
  describe,
  expect,
  it,
} from "vitest";
import {
  resolvePublicNetworkAddresses,
  type SupervisedNetworkResolver,
} from "../agent/supervised-network-policy.js";

describe(
  "supervised S5 DNS policy",
  () => {
    it(
      "accepts only public DNS results",
      async () => {
        const resolver:
          SupervisedNetworkResolver =
          async () => [
            {
              address: "8.8.8.8",
              family: 4,
            },
            {
              address:
                "2606:4700:4700::1111",
              family: 6,
            },
          ];

        await expect(
          resolvePublicNetworkAddresses(
            "example.com",
            resolver,
          ),
        ).resolves.toEqual([
          {
            address: "8.8.8.8",
            family: 4,
          },
          {
            address:
              "2606:4700:4700::1111",
            family: 6,
          },
        ]);
      },
    );

    it(
      "blocks mixed public and private DNS results",
      async () => {
        const resolver:
          SupervisedNetworkResolver =
          async () => [
            {
              address: "8.8.8.8",
              family: 4,
            },
            {
              address: "127.0.0.1",
              family: 4,
            },
          ];

        await expect(
          resolvePublicNetworkAddresses(
            "example.com",
            resolver,
          ),
        ).resolves.toHaveProperty(
          "error",
          expect.stringContaining(
            "non-public",
          ),
        );
      },
    );

    it(
      "blocks cloud metadata addresses",
      async () => {
        const resolver:
          SupervisedNetworkResolver =
          async () => [
            {
              address: "169.254.169.254",
              family: 4,
            },
          ];

        await expect(
          resolvePublicNetworkAddresses(
            "example.com",
            resolver,
          ),
        ).resolves.toHaveProperty("error");
      },
    );

    it(
      "blocks invalid and empty DNS responses",
      async () => {
        await expect(
          resolvePublicNetworkAddresses(
            "example.com",
            async () => [],
          ),
        ).resolves.toHaveProperty("error");

        await expect(
          resolvePublicNetworkAddresses(
            "example.com",
            async () => [
              {
                address: "not-an-ip",
                family: 4,
              },
            ],
          ),
        ).resolves.toHaveProperty("error");
      },
    );

    it(
      "handles DNS resolver failure without leaking an exception",
      async () => {
        await expect(
          resolvePublicNetworkAddresses(
            "example.com",
            async () => {
              throw new Error(
                "simulated DNS failure",
              );
            },
          ),
        ).resolves.toEqual({
          error:
            "Blocked: DNS resolution failed.",
        });
      },
    );

    it(
      "deduplicates identical DNS answers",
      async () => {
        await expect(
          resolvePublicNetworkAddresses(
            "example.com",
            async () => [
              {
                address: "1.1.1.1",
                family: 4,
              },
              {
                address: "1.1.1.1",
                family: 4,
              },
            ],
          ),
        ).resolves.toEqual([
          {
            address: "1.1.1.1",
            family: 4,
          },
        ]);
      },
    );
  },
);
