#!/usr/bin/env node
/**
 * ABOS CLI
 *
 * Creator-facing CLI for interacting with an abos.
 * Usage: abos-cli <command> [args]
 */

const args = process.argv.slice(2);
const command = args[0];

async function main(): Promise<void> {
  switch (command) {
    case "status":
      await import("./commands/status.js");
      break;
    case "logs":
      await import("./commands/logs.js");
      break;
    case "fund":
      await import("./commands/fund.js");
      break;
    case "send":
      await import("./commands/send.js");
      break;
    case "approvals":
    case "authorization-challenge":
    case "approve":
    case "revoke":
      await import("./commands/authorization.js");
      break;
    default:
      console.log(`
ABOS CLI - Creator Tools

Usage:
  abos-cli status              Show abos status
  abos-cli logs [--tail N]     View abos logs
  abos-cli fund <amount> [--to 0x...]  Transfer Conway credits
  abos-cli send <to-address> <message> Send a social message
  abos-cli approvals           List pending policy authorizations
  abos-cli authorization-challenge <approve|revoke> <decision-id> [--expires-at ISO]
                               Print the exact message to sign externally
  abos-cli approve <decision-id> --expires-at <ISO> --signature <signature>
                               Verify creator signature and approve exact scope
  abos-cli revoke <decision-id> --expires-at <ISO> --signature <signature>
                               Verify creator signature and revoke authorization
`);
  }
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
