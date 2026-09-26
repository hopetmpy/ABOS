import type { AbosDatabase, ChildAbosAgent, ConwayClient } from "../types.js";
import { verifyConstitution } from "./constitution.js";
import { verifyFamilyKnowledgeBootstrap } from "./family-knowledge.js";

export interface ChildBootstrapVerification {
  valid: boolean;
  evidence: string[];
  constitutionValid: boolean;
  familyKnowledgeValid: boolean;
  configIdentityValid: boolean;
}

interface ChildConfigProjection {
  name?: unknown;
  walletAddress?: unknown;
  parentAddress?: unknown;
  sandboxId?: unknown;
}

/**
 * Verify the material child bootstrap from the parent's child-scoped execution
 * boundary. This is a gate over existing authorities, not a lifecycle or
 * identity authority of its own.
 */
export async function verifyChildBootstrap(
  childConway: ConwayClient,
  db: AbosDatabase,
  child: ChildAbosAgent,
): Promise<ChildBootstrapVerification> {
  const evidence: string[] = [];

  const constitution = await verifyConstitution(
    childConway,
    child.sandboxId,
    db.raw,
  );
  evidence.push(`constitution: ${constitution.detail}`);

  const family = await verifyFamilyKnowledgeBootstrap(
    childConway,
    child.sandboxId,
    db,
    child.address,
  );
  evidence.push(`family_knowledge: ${family.detail}`);

  let configIdentityValid = false;
  try {
    const raw = await childConway.readFile("/root/.abos/abos.json");
    const config = JSON.parse(raw) as ChildConfigProjection;
    const expectedParent = family.parentAddress;
    const walletMatches = config.walletAddress === child.address;
    const parentMatches =
      typeof expectedParent === "string" &&
      config.parentAddress === expectedParent;
    const nameMatches = config.name === child.name;
    const sandboxMatches =
      typeof config.sandboxId !== "string" ||
      !config.sandboxId.trim() ||
      config.sandboxId === child.sandboxId;

    configIdentityValid =
      walletMatches && parentMatches && nameMatches && sandboxMatches;
    evidence.push(
      configIdentityValid
        ? "identity: child config wallet/name/parent/sandbox matches parent observation"
        : `identity: config mismatch wallet=${walletMatches} name=${nameMatches} parent=${parentMatches} sandbox=${sandboxMatches}`,
    );
  } catch (error) {
    evidence.push(
      `identity: failed to read/parse child config: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const valid = constitution.valid && family.valid && configIdentityValid;
  if (valid) {
    db.setKV(
      `child_bootstrap_attestation:${child.id}`,
      JSON.stringify({
        childId: child.id,
        sandboxId: child.sandboxId,
        walletAddress: child.address,
        constitution: constitution.detail,
        familyKnowledgeHash: family.bundleHash ?? null,
        familyParentAddress: family.parentAddress ?? null,
        verifiedAt: new Date().toISOString(),
      }),
    );
  }

  return {
    valid,
    evidence,
    constitutionValid: constitution.valid,
    familyKnowledgeValid: family.valid,
    configIdentityValid,
  };
}
