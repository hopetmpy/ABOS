import fs from "fs";
import os from "os";
import path from "path";
import { createHash } from "crypto";

import type { AutomatonIdentity, GenesisConfig } from "../types.js";
import {
  REPLICATION_CONSTITUTION_API_VERSION,
  REPLICATION_PAYLOAD_SCHEMA_VERSION,
  type ReplicationPayload,
} from "./replicationPayload.js";

export function sha256Hex(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}

export function resolveConstitutionPath(): string {
  if (process.env.AUTOMATON_CONSTITUTION_PATH) {
    return process.env.AUTOMATON_CONSTITUTION_PATH;
  }

  const homeCandidate = path.join(os.homedir() || "/root", ".automaton", "constitution.md");
  if (fs.existsSync(homeCandidate)) {
    return homeCandidate;
  }

  return path.join(process.cwd(), "constitution.md");
}

export function loadTradingConstitution(): string {
  return fs.readFileSync(resolveConstitutionPath(), "utf-8");
}

export function buildReplicationPayload(
  genesis: GenesisConfig,
  identity: AutomatonIdentity,
  options: {
    constitutionContent?: string;
  } = {},
): ReplicationPayload {
  const constitutionContent = options.constitutionContent ?? loadTradingConstitution();
  const chainType = genesis.chainType || identity.chainType || "evm";

  return {
    replicationPayloadSchemaVersion: REPLICATION_PAYLOAD_SCHEMA_VERSION,
    name: genesis.name,
    genesisPrompt: genesis.genesisPrompt,
    creatorMessage: genesis.creatorMessage,
    creatorAddress: genesis.creatorAddress,
    parentAddress: genesis.parentAddress,
    chainType,
    constitutionContent,
    constitutionHash: sha256Hex(constitutionContent),
    constitutionApiVersion: REPLICATION_CONSTITUTION_API_VERSION,
  };
}
