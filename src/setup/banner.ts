import chalk from "chalk";
import { ABOS_VERSION } from "../version.js";

export function showBanner(): void {
  console.log("");
  console.log(chalk.cyan(`
     █████╗ ██████╗  ██████╗ ███████╗
    ██╔══██╗██╔══██╗██╔═══██╗██╔════╝
    ███████║██████╔╝██║   ██║███████╗
    ██╔══██║██╔══██╗██║   ██║╚════██║
    ██║  ██║██████╔╝╚██████╔╝███████║
    ╚═╝  ╚═╝╚═════╝  ╚═════╝ ╚══════╝
`));
  console.log(
    chalk.dim(
      `  ABOS v${ABOS_VERSION} — Autonomous Business Operating System`,
    ),
  );
  console.log(chalk.dim("  Conway-connected autonomous runtime."));
  console.log("");
}
