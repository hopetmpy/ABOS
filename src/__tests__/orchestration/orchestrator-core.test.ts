import { vi } from "vitest";

// Preserve the complete pre-P-025 regression suite against the byte-identical
// execution core. The canonical Orchestrator has a separate P-025 suite for the
// strategic phases that intentionally changed semantics.
vi.mock("../../orchestration/orchestrator.js", async () =>
  import("../../orchestration/orchestrator-core.js"),
);

import "./orchestrator.legacy-suite.js";
