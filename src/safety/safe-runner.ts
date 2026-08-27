import path from "node:path";
import type { PrivateKeyAccount } from "viem";
import type { AutomatonIdentity } from "../types.js";
import { DEFAULT_CONFIG } from "../types.js";
import { createDatabase } from "../state/database.js";
import { createSafeConwayClient, initializeSafeStateRoot, RUNTIME_CAPABILITIES, SAFE_MODE, SAFE_PATHS, SafeModeViolation } from "./safe-mode.js";

export interface SafeRunnerOptions { maxTurns: number; maxRuntimeMs: number }
export interface SafeRunnerResult { turns: number; elapsedMs: number; statePath: string }

function syntheticIdentity(): AutomatonIdentity {
  const address = "0x0000000000000000000000000000000000000001";
  const deny = async () => { throw new SafeModeViolation("walletSigning", "sign with synthetic identity", "safe-runner"); };
  const account = {
    address, publicKey: "0x", source: "custom", type: "local",
    signMessage: deny, signTypedData: deny, signTransaction: deny, sign: deny,
  } as unknown as PrivateKeyAccount;
  return {
    name: "local-safe-automaton", address, account, creatorAddress: address,
    sandboxId: "safe-local", apiKey: "", createdAt: new Date().toISOString(), chainType: "evm",
    chainIdentity: { chainType: "evm", address, signMessage: deny },
  };
}

export async function runSafeLocal(options: SafeRunnerOptions): Promise<SafeRunnerResult> {
  if (!SAFE_MODE) throw new Error("--safe-local requires AUTOMATON_SAFE_MODE=true");
  if (!Number.isInteger(options.maxTurns) || options.maxTurns < 0 || options.maxTurns > 1000) throw new Error("maxTurns must be an integer from 0 to 1000");
  if (!Number.isFinite(options.maxRuntimeMs) || options.maxRuntimeMs < 1 || options.maxRuntimeMs > 3_600_000) throw new Error("maxRuntimeMs must be between 1 and 3600000");

  initializeSafeStateRoot();
  const dbPath = path.join(SAFE_PATHS.state, "state.db");
  const db = createDatabase(dbPath);
  const started = Date.now();
  let turns = 0;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let expired = false;
  try {
    deadline = setTimeout(() => { expired = true; }, options.maxRuntimeMs);
    const identity = syntheticIdentity();
    const conway = createSafeConwayClient();
    void conway;
    db.setIdentity("name", identity.name);
    db.setIdentity("address", identity.address);
    db.setIdentity("mode", "local-safe");
    db.setKV("runtime_capabilities", JSON.stringify(RUNTIME_CAPABILITIES));
    db.setKV("config", JSON.stringify({ ...DEFAULT_CONFIG, dbPath, skillsDir: SAFE_PATHS.skills }));

    // Deliberately foreground and bounded. A later local-inference adapter may
    // perform actual turns here, but remote inference is never constructed.
    while (turns < options.maxTurns && !expired) {
      turns += 1;
      db.setKV("safe_runner_last_turn", String(turns));
      await Promise.resolve();
    }
    db.setAgentState("sleeping");
    return { turns, elapsedMs: Date.now() - started, statePath: dbPath };
  } finally {
    if (deadline) clearTimeout(deadline);
    db.close();
  }
}

export function parseSafeRunnerArgs(args: string[]): SafeRunnerOptions {
  const valueAfter = (flag: string) => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : undefined;
  };
  return {
    maxTurns: Number(valueAfter("--max-turns") ?? "1"),
    maxRuntimeMs: Number(valueAfter("--max-runtime-ms") ?? "30000"),
  };
}
