/**
 * automaton-cli plans — review and decide venture proposals
 *
 *   plans [list] [--all]        List pending (or all) venture proposals
 *   plans show <id>             Full detail of one proposal
 *   plans approve <id> [--budget <amount>] [--note <text>]
 *   plans reject <id> [--note <text>]
 *
 * Approval is one-time per plan: once approved with a budget, the
 * automaton executes the venture freely within that budget.
 */

import chalk from "chalk";
import { loadConfig, resolvePath } from "@conway/automaton/config.js";
import {
  createDatabase,
  getVentureProposalById,
  listVentureProposals,
  decideVentureProposal,
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
  automaton-cli plans [list] [--all]                       List pending (or all) proposals
  automaton-cli plans show <id>                            Show one proposal in full
  automaton-cli plans approve <id> [--budget <amount>] [--note <text>]
  automaton-cli plans reject <id> [--note <text>]

Amounts are dollars (e.g. --budget 25.00). Approval is one-time: the
automaton then executes this venture freely within the approved budget.
`);
  db.close();
  process.exit(1);
}

function flagValue(name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function parseBudgetCents(raw: string): number {
  const value = Number(raw.trim());
  if (!Number.isFinite(value) || value < 0) return -1;
  return Math.round(value * 100);
}

function statusColor(s: string): string {
  switch (s) {
    case "approved": return chalk.green.bold(s);
    case "proposed": return chalk.yellow.bold(s);
    case "rejected": return chalk.red.bold(s);
    default: return chalk.gray.bold(s);
  }
}

function printProposal(id: string): void {
  const v = getVentureProposalById(db.raw, id);
  if (!v) {
    console.log(chalk.red(`No venture proposal with id ${id}`));
    db.close();
    process.exit(1);
  }
  const divider = chalk.dim("─".repeat(60));
  console.log("\n" + chalk.bold(`  ◈ ${v.title}`) + "  " + statusColor(v.status));
  console.log(divider);
  console.log(chalk.dim("ID          ") + v.id);
  console.log(chalk.dim("Created     ") + v.createdAt);
  if (v.decidedAt) console.log(chalk.dim("Decided     ") + v.decidedAt);
  console.log(chalk.dim("Requested   ") + dollars(v.estimatedCostCents));
  if (v.approvedBudgetCents !== null) {
    console.log(
      chalk.dim("Budget      ") +
        `${dollars(v.approvedBudgetCents)} (spent ${dollars(v.spentCents)}, remaining ${dollars(v.approvedBudgetCents - v.spentCents)})`,
    );
  }
  if (v.decisionNote) console.log(chalk.dim("Note        ") + v.decisionNote);
  if (v.needsFromCreator.length > 0) {
    console.log(chalk.dim("Needs you   ") + chalk.magenta(v.needsFromCreator.join(", ")));
  }
  console.log(divider);
  console.log(chalk.bold("Summary") + "\n" + v.summary + "\n");
  console.log(chalk.bold("Revenue model") + "\n" + v.revenueModel + "\n");
  console.log(chalk.bold("Plan") + "\n" + v.plan + "\n");
}

switch (sub) {
  case "list": {
    const all = args.includes("--all");
    const proposals = all
      ? listVentureProposals(db.raw)
      : listVentureProposals(db.raw, "proposed");
    if (proposals.length === 0) {
      console.log(all ? "No venture proposals." : "No pending venture proposals.");
      break;
    }
    console.log();
    for (const v of proposals) {
      const money =
        v.approvedBudgetCents !== null
          ? `budget ${dollars(v.approvedBudgetCents)}, spent ${dollars(v.spentCents)}`
          : `asks ${dollars(v.estimatedCostCents)}`;
      console.log(
        `  ${statusColor(v.status.padEnd(9))} ${chalk.white(v.id)}  ${chalk.bold(v.title)}  ${chalk.dim(`(${money})`)}`,
      );
    }
    console.log(chalk.dim("\n  automaton-cli plans show <id> for details\n"));
    break;
  }

  case "show": {
    const id = args[1];
    if (!id) usage();
    printProposal(id);
    break;
  }

  case "approve":
  case "reject": {
    const id = args[1];
    if (!id || id.startsWith("--")) usage();

    const existing = getVentureProposalById(db.raw, id);
    if (!existing) {
      console.log(chalk.red(`No venture proposal with id ${id}`));
      db.close();
      process.exit(1);
    }
    if (existing.status !== "proposed") {
      console.log(chalk.red(`Venture is already ${existing.status}; only "proposed" ventures can be decided.`));
      db.close();
      process.exit(1);
    }

    const note = flagValue("--note");
    let budgetCents: number | undefined;
    if (sub === "approve") {
      const rawBudget = flagValue("--budget");
      if (rawBudget !== undefined) {
        budgetCents = parseBudgetCents(rawBudget);
        if (budgetCents < 0) {
          console.log(chalk.red(`Invalid --budget: ${rawBudget}`));
          db.close();
          process.exit(1);
        }
      }
    }

    const decision = sub === "approve" ? "approved" : "rejected";
    const updated = decideVentureProposal(db.raw, id, decision, {
      budgetCents,
      note,
    })!;

    // Wake a sleeping automaton so it acts on the decision promptly
    insertWakeEvent(
      db.raw,
      "creator",
      `Venture ${decision}: "${updated.title}" (${id})` +
        (updated.approvedBudgetCents !== null
          ? ` with budget ${dollars(updated.approvedBudgetCents)}`
          : ""),
    );

    if (decision === "approved") {
      console.log(
        chalk.green(
          `Approved "${updated.title}" with budget ${dollars(updated.approvedBudgetCents ?? 0)}.`,
        ) + "\nThe automaton can now execute this venture within budget without asking again.",
      );
    } else {
      console.log(chalk.red(`Rejected "${updated.title}".`) + (note ? `\nNote passed along: ${note}` : ""));
    }
    break;
  }

  default:
    usage();
}

db.close();
