import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { ConwayClient } from "../types.js";
import {
  ARTIFACT_MATERIALIZATION_PROTOCOL_VERSION,
  artifactTargetRelativePath,
  type ArtifactMaterializationRequest,
  type ArtifactMaterializationResult,
} from "./artifact-materialization.js";

const DEFAULT_CONWAY_RUNTIME_ROOT = "/root/abos";

export async function materializeArtifactsToConwaySandbox(
  conway: ConwayClient,
  sandboxId: string,
  request: ArtifactMaterializationRequest,
  runtimeRoot = DEFAULT_CONWAY_RUNTIME_ROOT,
): Promise<ArtifactMaterializationResult> {
  if (!sandboxId.trim()) {
    throw new Error(
      "Conway artifact materialization requires a target sandbox id.",
    );
  }

  const scoped = conway.createScopedClient(sandboxId);
  const entries: ArtifactMaterializationResult["entries"] = [];
  const evidence: string[] = [];

  for (const source of request.sources) {
    const relative = artifactTargetRelativePath(
      request,
      source,
    );
    const targetPath = path.posix.join(
      runtimeRoot,
      relative,
    );
    const encodedPath = `${targetPath}.b64`;

    try {
      const body = fs.readFileSync(source.localPath);
      const observedSourceDigest = createHash("sha256")
        .update(body)
        .digest("hex");
      if (
        source.integrity.algorithm.toLowerCase() !== "sha256" ||
        source.integrity.digest.toLowerCase() !==
          observedSourceDigest.toLowerCase()
      ) {
        entries.push({
          reference: source.reference,
          state: "unknown",
          evidence: [
            "Parent artifact changed after the materialization plan was prepared; Conway upload was not attempted.",
          ],
        });
        continue;
      }

      const prepared = await scoped.exec(
        [
          "set -euo pipefail",
          `mkdir -p -- ${shellQuote(path.posix.dirname(targetPath))}`,
          `rm -f -- ${shellQuote(encodedPath)}`,
        ].join("\n"),
        30_000,
      );
      if (prepared.exitCode !== 0) {
        throw new Error(
          `Conway target staging preparation failed: ${prepared.stderr || prepared.stdout}`,
        );
      }

      await scoped.writeFile(
        encodedPath,
        body.toString("base64"),
      );

      const finalized = await scoped.exec(
        [
          "set -euo pipefail",
          `base64 -d -- ${shellQuote(encodedPath)} > ${shellQuote(targetPath)}`,
          `chmod 600 -- ${shellQuote(targetPath)}`,
          `rm -f -- ${shellQuote(encodedPath)}`,
          `printf 'ABOS_MATERIALIZED_BYTES=%s\\nABOS_MATERIALIZED_SHA256=%s\\n' "$(stat -c %s ${shellQuote(targetPath)})" "$(sha256sum ${shellQuote(targetPath)} | awk '{print $1}')"`,
        ].join("\n"),
        60_000,
      );
      if (finalized.exitCode !== 0) {
        throw new Error(
          `Conway target artifact finalization failed: ${finalized.stderr || finalized.stdout}`,
        );
      }

      const observation =
        parseMaterializationObservation(
          finalized.stdout,
        );
      if (!observation) {
        entries.push({
          reference: source.reference,
          state: "unknown",
          evidence: [
            "Conway target did not return valid size/hash materialization markers.",
          ],
        });
        continue;
      }

      const verified =
        observation.bytes === source.bytes &&
        observation.sha256.toLowerCase() ===
          source.integrity.digest.toLowerCase();

      entries.push({
        reference: source.reference,
        state: verified ? "available" : "unknown",
        targetPath: verified ? targetPath : null,
        integrity: {
          algorithm: "sha256",
          digest: observation.sha256,
        },
        evidence: [
          `Conway target observed bytes=${observation.bytes} sha256=${observation.sha256}.`,
          ...(verified
            ? ["Conway target artifact matches parent manifest."]
            : [
                `Conway target verification mismatch: expected bytes=${source.bytes} sha256=${source.integrity.digest}.`,
              ]),
        ],
        metadata: {
          sandboxId,
          runtimeRoot,
        },
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      entries.push({
        reference: source.reference,
        state: "unavailable",
        evidence: [
          `Conway target artifact materialization failed: ${message}`,
        ],
        metadata: {
          sandboxId,
          runtimeRoot,
        },
      });
      evidence.push(
        `Conway artifact "${source.reference}" could not be materialized: ${message}`,
      );

      try {
        await scoped.exec(
          `rm -f -- ${shellQuote(encodedPath)}`,
          10_000,
        );
      } catch {
        // Cleanup failure does not manufacture a successful materialization.
      }
    }
  }

  return {
    protocolVersion:
      ARTIFACT_MATERIALIZATION_PROTOCOL_VERSION,
    entries,
    evidence,
    metadata: {
      transport: "conway_sandbox_file_api",
      sandboxId,
      runtimeRoot,
    },
  };
}

function parseMaterializationObservation(
  output: string,
): { bytes: number; sha256: string } | null {
  const bytesMatch =
    /(?:^|\n)ABOS_MATERIALIZED_BYTES=(\d+)(?:\n|$)/.exec(
      output,
    );
  const hashMatch =
    /(?:^|\n)ABOS_MATERIALIZED_SHA256=([0-9a-fA-F]{64})(?:\n|$)/.exec(
      output,
    );
  if (!bytesMatch || !hashMatch) return null;

  const bytes = Number(bytesMatch[1]);
  if (!Number.isSafeInteger(bytes) || bytes < 0) {
    return null;
  }

  return {
    bytes,
    sha256: hashMatch[1].toLowerCase(),
  };
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}
