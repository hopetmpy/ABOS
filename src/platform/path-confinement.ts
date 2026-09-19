
import nodePath from "node:path";
import { expandHomePath, getHomeDir } from "./home.js";

const REMOTE_SANDBOX_HOME = "/root";

export interface PathConfinementError {
  error: string;
}

/**
 * Resolve a tool path inside the authority boundary of its execution host.
 * Remote Conway execution is confined to /root; local execution is confined
 * to the actual host user's home. The function is shared by filesystem and
 * structured-browser file effects so those surfaces cannot drift apart.
 */
export function confinePathToSandbox(
  filePath: string,
  sandboxId: string,
  operation = "write_file",
): string | PathConfinementError {
  if (sandboxId) {
    const portableInput = filePath.replace(/\\/g, "/");
    const expanded = portableInput.startsWith("~")
      ? nodePath.posix.join(REMOTE_SANDBOX_HOME, portableInput.slice(1))
      : portableInput;
    const resolved = nodePath.posix.resolve(REMOTE_SANDBOX_HOME, expanded);

    if (
      resolved !== REMOTE_SANDBOX_HOME &&
      !resolved.startsWith(REMOTE_SANDBOX_HOME + "/")
    ) {
      return {
        error: `Blocked: ${operation} path "${filePath}" resolves to "${resolved}" which is outside the allowed directory (${REMOTE_SANDBOX_HOME}). Paths are confined to the sandbox home.`,
      };
    }

    return resolved;
  }

  const localHome = nodePath.resolve(getHomeDir());
  const portableInput = filePath.replace(/\\/g, "/");
  let expanded: string;

  if (portableInput === "/root") {
    expanded = localHome;
  } else if (portableInput.startsWith("/root/")) {
    expanded = nodePath.join(
      localHome,
      ...portableInput.slice("/root/".length).split("/").filter(Boolean),
    );
  } else if (portableInput.startsWith("~")) {
    expanded = expandHomePath(filePath);
  } else {
    expanded = filePath;
  }

  const resolved = nodePath.isAbsolute(expanded)
    ? nodePath.resolve(expanded)
    : nodePath.resolve(localHome, expanded);

  if (
    resolved !== localHome &&
    !resolved.startsWith(localHome + nodePath.sep)
  ) {
    return {
      error: `Blocked: ${operation} path "${filePath}" resolves to "${resolved}" which is outside the allowed directory (${localHome}). Paths are confined to the local ABOS home.`,
    };
  }

  return resolved;
}

export function confinePathToLocalHome(
  filePath: string,
  operation = "file",
): string | PathConfinementError {
  return confinePathToSandbox(filePath, "", operation);
}
