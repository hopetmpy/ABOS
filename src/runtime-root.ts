import path from "path";
import { fileURLToPath } from "url";

/**
 * Absolute root of the installed ABOS runtime.
 *
 * This is derived from the module location instead of process.cwd() so ABOS
 * remains correct when launched by absolute path, a service manager, a wrapper,
 * or any caller whose working directory is not the repository root.
 *
 * src/runtime-root.ts  -> <repo>/src/runtime-root.ts
 * dist/runtime-root.js -> <repo>/dist/runtime-root.js
 */
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

export const RUNTIME_ROOT = path.resolve(MODULE_DIR, "..");
