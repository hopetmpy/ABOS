#!/usr/bin/env node
/**
 * Conway Automaton CLI
 *
 * Creator-facing CLI for interacting with an automaton.
 * Usage: automaton-cli <command> [args]
 */

const args = process.argv.slice(2);
const command = args[0];

async function main(): Promise<void> {
  const safeMode = process.env.AUTOMATON_SAFE_MODE;
  if (safeMode !== undefined && safeMode !== "true" && safeMode !== "false") {
    throw new Error('AUTOMATON_SAFE_MODE must be exactly "true" or "false" when set');
  }
  if (safeMode === "true" && (command === "fund" || command === "send")) {
    throw new Error(`LOCAL_SAFE_MODE denies CLI command: ${command}`);
  }
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
    default:
      console.log(`
Conway Automaton CLI - Creator Tools

Usage:
  automaton-cli status              Show automaton status
  automaton-cli logs [--tail N]     View automaton logs
  automaton-cli fund <amount> [--to 0x...]  Transfer Conway credits
  automaton-cli send <to-address> <message> Send a social message
`);
  }
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
