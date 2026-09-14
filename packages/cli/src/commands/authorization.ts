/**
 * Creator-signed policy authorization commands.
 *
 * The CLI reads the same canonical state DB as the runtime. It never imports,
 * requests, or stores the creator private key: challenge signing happens in an
 * external wallet and this command only verifies/applies the public signature.
 */

import chalk from "chalk";
import { loadConfig, resolvePath } from "@abos/runtime/config.js";
import { createDatabase } from "@abos/runtime/state/database.js";
import {
  applyCreatorPolicyAuthorization,
  buildPolicyAuthorizationChallenge,
  listPendingPolicyAuthorizations,
  type PolicyAuthorizationAction,
} from "@abos/runtime/agent/policy-authorization.js";

const command = process.argv[2];
const args = process.argv.slice(3);

function valueFor(flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function canonicalAddress(address: string): string {
  return address.startsWith("0x") ? address.toLowerCase() : address;
}

function assertCreatorBinding(configCreator: string, challengeCreator: string): void {
  if (canonicalAddress(configCreator) !== canonicalAddress(challengeCreator)) {
    throw new Error(
      `Pending decision is bound to creator ${challengeCreator}, but current config declares ${configCreator}. Re-evaluate the action instead of approving stale authority.`,
    );
  }
}

const config = loadConfig();
if (!config) {
  console.error(chalk.red("No abos configuration found."));
  process.exit(1);
}

const db = createDatabase(resolvePath(config.dbPath));

try {
  if (command === "approvals") {
    const pending = listPendingPolicyAuthorizations(db.raw);
    if (pending.length === 0) {
      console.log(chalk.dim("No pending policy authorizations."));
    } else {
      for (const item of pending) {
        console.log(chalk.bold(item.id));
        console.log(`  tool:  ${item.toolName}`);
        console.log(`  scope: ${item.scopeHash}`);
        console.log(`  at:    ${item.createdAt}`);
        console.log(`  why:   ${item.reason}`);
      }
    }
  } else if (command === "authorization-challenge") {
    const action = args[0] as PolicyAuthorizationAction | undefined;
    const decisionId = args[1];
    if ((action !== "approve" && action !== "revoke") || !decisionId) {
      throw new Error(
        "Usage: abos-cli authorization-challenge <approve|revoke> <decision-id> [--expires-at ISO]",
      );
    }
    const expiresAt = valueFor("--expires-at")
      ?? new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const challenge = buildPolicyAuthorizationChallenge(
      db.raw,
      decisionId,
      action,
      expiresAt,
    );
    assertCreatorBinding(config.creatorAddress, challenge.creatorAddress);

    console.log(chalk.bold("Creator authorization challenge"));
    console.log(`decision: ${challenge.decisionId}`);
    console.log(`action:   ${challenge.action}`);
    console.log(`tool:     ${challenge.toolName}`);
    console.log(`scope:    ${challenge.scopeHash}`);
    console.log(`creator:  ${challenge.creatorAddress}`);
    console.log(`expires:  ${challenge.expiresAt}`);
    console.log("\nSign this exact UTF-8 message with the creator wallet:\n");
    console.log(challenge.message);
  } else if (command === "approve" || command === "revoke") {
    const decisionId = args[0];
    const expiresAt = valueFor("--expires-at");
    const signature = valueFor("--signature");
    if (!decisionId || !expiresAt || !signature) {
      throw new Error(
        `Usage: abos-cli ${command} <decision-id> --expires-at <ISO> --signature <signature>`,
      );
    }

    const action = command as PolicyAuthorizationAction;
    const challenge = buildPolicyAuthorizationChallenge(
      db.raw,
      decisionId,
      action,
      expiresAt,
    );
    assertCreatorBinding(config.creatorAddress, challenge.creatorAddress);
    const result = await applyCreatorPolicyAuthorization(db.raw, {
      decisionId,
      action,
      expiresAt,
      signature,
    });
    console.log(
      chalk.green(
        `${result.lifecycleState}: ${result.decisionId} (${result.action}) by ${result.creatorAddress}`,
      ),
    );
  } else {
    throw new Error(`Unsupported authorization command: ${command ?? "<none>"}`);
  }
} finally {
  db.close();
}
