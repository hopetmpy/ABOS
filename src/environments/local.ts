import os from "node:os";
import type { EnvironmentProvider, EnvironmentSnapshot } from "./types.js";

export class LocalEnvironmentProvider implements EnvironmentProvider {
  readonly id = "local";

  async inspect(): Promise<EnvironmentSnapshot> {
    const evidence = [
      `platform=${process.platform}`,
      `arch=${process.arch}`,
      `node=${process.version}`,
      `cpus=${os.cpus().length}`,
      `freeMemoryBytes=${os.freemem()}`,
    ];

    return {
      id: this.id,
      label: "Local host",
      availability: "available",
      evidence,
      costModel: "host-provided",
      constraints: [],
      observedAt: new Date().toISOString(),
      metadata: {
        platform: process.platform,
        arch: process.arch,
        cwd: process.cwd(),
        totalMemoryBytes: os.totalmem(),
        freeMemoryBytes: os.freemem(),
      },
      capabilities: [
        {
          id: "local:filesystem",
          type: "executor",
          provider: "local",
          description: "Read and write files on the local ABOS host within policy boundaries.",
          requirements: ["filesystem"],
          permissions: [],
          environment: "local",
          available: true,
        },
        {
          id: "local:process",
          type: "executor",
          provider: "local",
          description: "Execute local processes and CLI tools exposed to ABOS.",
          requirements: ["shell", "cli", "process"],
          permissions: [],
          environment: "local",
          available: true,
        },
      ],
    };
  }
}
