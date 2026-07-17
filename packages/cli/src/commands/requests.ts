/**
 * automaton-cli requests — creator action requests (KYC, accounts, funding)
 *
 *   requests [list] [--all]              List open (or all) requests
 *   requests fulfill <id> [--note <text>]
 *   requests decline <id> [--note <text>]
 *
 * These are things only you, a legal person, can do for the automaton:
 * identity verification (KYC) at a brokerage/bank/payment processor,
 * owning platform accounts that require human identity, funding, legal
 * steps. Complete them in YOUR name, then mark the request fulfilled
 * with a note telling the automaton what was set up and where.
 */

import chalk from "chalk";
import { loadConfig, resolvePath } from "@conway/automaton/config.js";
import {
  createDatabase,
  listCreatorRequests,
  resolveCreatorRequest,
  insertWakeEvent,
} from "@conway/automaton/state/database.js";

const args = process.argv.slice(3);
const sub = args[0] && !args[0].startsWith("--") ? args[0] : "list";

const config = loadConfig();
if (!config) {
  console.log(chalk.red("No automaton configuration found."));
  process.exit(1);
}

const db = createDatabase(resolvePath(config.dbPath));

function usage(): never {
  console.log(`
Usage:
  automaton-cli requests [list] [--all]              List open (or all) creator requests
  automaton-cli requests fulfill <id> [--note <text>]
  automaton-cli requests decline <id> [--note <text>]

Use --note to tell the automaton what you did (e.g. where credentials
live, which account was created). Never share passwords in plain notes —
point the automaton at a credential location instead.
`);
  db.close();
  process.exit(1);
}

function flagValue(name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function statusColor(s: string): string {
  switch (s) {
    case "open": return chalk.yellow.bold(s);
    case "fulfilled": return chalk.green.bold(s);
    case "declined": return chalk.red.bold(s);
    default: return chalk.gray.bold(s);
  }
}

switch (sub) {
  case "list": {
    const all = args.includes("--all");
    const requests = all
      ? listCreatorRequests(db.raw)
      : listCreatorRequests(db.raw, "open");
    if (requests.length === 0) {
      console.log(all ? "No creator requests." : "No open creator requests.");
      break;
    }
    console.log();
    for (const r of requests) {
      console.log(
        `  ${statusColor(r.status.padEnd(9))} ${chalk.white(r.id)}  ${chalk.magenta(r.kind)}` +
          (r.ventureId ? chalk.dim(`  (venture ${r.ventureId})`) : ""),
      );
      console.log(`            ${r.description}`);
      if (r.resolution) console.log(chalk.dim(`            ↳ ${r.resolution}`));
    }
    console.log();
    break;
  }

  case "fulfill":
  case "decline": {
    const id = args[1];
    if (!id || id.startsWith("--")) usage();

    const note = flagValue("--note");
    const status = sub === "fulfill" ? "fulfilled" : "declined";
    const updated = resolveCreatorRequest(db.raw, id, status, note);
    if (!updated) {
      console.log(chalk.red(`No creator request with id ${id}`));
      db.close();
      process.exit(1);
    }

    insertWakeEvent(
      db.raw,
      "creator",
      `Creator request ${status}: ${updated.kind} (${id})${note ? ` — ${note}` : ""}`,
    );

    console.log(
      status === "fulfilled"
        ? chalk.green(`Marked ${id} fulfilled.`) + (note ? `\nNote passed along: ${note}` : "")
        : chalk.red(`Declined ${id}.`) + (note ? `\nNote passed along: ${note}` : ""),
    );
    break;
  }

  default:
    usage();
}

db.close();
