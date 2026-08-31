import os from "node:os";
import path from "node:path";

/**
 * Resolve the host user's home directory consistently across platforms.
 *
 * HOME is honored first so tests, containers, and explicit overrides continue
 * to work. Windows normally exposes USERPROFILE instead of HOME, so using a
 * hard-coded /root fallback there creates paths such as C:\\root\\.abos.
 */
export function getHomeDir(): string {
  const home = process.env.HOME?.trim();
  if (home) return path.resolve(home);

  const userProfile = process.env.USERPROFILE?.trim();
  if (userProfile) return path.resolve(userProfile);

  if (process.platform === "win32") {
    const homeDrive = process.env.HOMEDRIVE?.trim();
    const homePath = process.env.HOMEPATH?.trim();
    if (homeDrive && homePath) {
      return path.resolve(`${homeDrive}${homePath}`);
    }
  }

  const detected = os.homedir();
  if (detected) return path.resolve(detected);

  return process.platform === "win32"
    ? path.parse(process.cwd()).root
    : "/root";
}

/** Expand a leading ~ using the platform-correct home directory. */
export function expandHomePath(value: string): string {
  if (value === "~") return getHomeDir();

  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return path.join(getHomeDir(), value.slice(2));
  }

  return value;
}
