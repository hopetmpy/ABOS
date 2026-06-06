from app.models.enums import InstallRing, HarnessPatchRisk


FORBIDDEN_MUTATIONS = [
    "disable_tracing",
    "disable_receipt_capture",
    "bypass_budget_reservation",
    "remove_hard_gates",
    "expose_secrets",
    "weaken_hidden_holdout",
    "relax_privacy_policy",
    "expand_r4_r5_authority_silently",
]


def manifest_valid_grader(capsule: dict) -> tuple[bool, str]:
    required = ["id", "name", "version", "install_ring"]
    for field in required:
        if not capsule.get(field):
            return False, f"Missing required field: {field}"
    return True, "manifest valid"


def permission_diff_grader(permissions: dict, install_ring: str) -> tuple[bool, str]:
    ring = InstallRing(install_ring)
    if ring in (InstallRing.R0_KNOW, InstallRing.R1_THINK):
        if permissions.get("external_write"):
            return False, f"external_write not allowed for {ring.value}"
        if permissions.get("value_movement"):
            return False, f"value_movement not allowed for {ring.value}"
    if ring == InstallRing.R2_READ:
        if permissions.get("external_write"):
            return False, f"external_write not allowed for {ring.value}"
    return True, "permissions compatible"


def install_ring_grader(requested_ring: str, max_authorized: str) -> tuple[bool, str]:
    ring_order = [r.value for r in InstallRing]
    req_idx = ring_order.index(requested_ring) if requested_ring in ring_order else -1
    max_idx = ring_order.index(max_authorized) if max_authorized in ring_order else -1
    if req_idx > max_idx:
        return False, f"Requested {requested_ring} exceeds max authorized {max_authorized}"
    return True, "ring allowed"


def rollback_available_grader(capsule: dict) -> tuple[bool, str]:
    rollback = capsule.get("rollback", {})
    if rollback.get("available") or rollback.get("required"):
        return True, "rollback available"
    ring = capsule.get("install_ring", "R0_KNOW")
    if ring in ("R3_WRITE", "R4_SPEND", "R5_GOVERN"):
        return False, f"Rollback required for {ring}"
    return True, "rollback not required for this ring"


def hard_gate_grader(hard_gate_results: dict) -> tuple[bool, str]:
    for gate, result in hard_gate_results.items():
        if result != "pass":
            return False, f"Hard gate failed: {gate}"
    return True, "all hard gates pass"


def harness_patch_risk_grader(patch: dict) -> HarnessPatchRisk:
    patch_types = patch.get("patch_type", [])
    changed = patch.get("changed_fields", [])

    constitutional_fields = ["spend_policy", "privacy_policy", "upgrade_policy", "credential_scope", "authority"]
    high_fields = ["orchestration", "tool_wrapper", "deploy_behavior"]
    medium_fields = ["model_routing", "retrieval", "critic_policy", "memory_compaction"]

    for field in changed:
        if any(c in field for c in constitutional_fields):
            return HarnessPatchRisk.CONSTITUTIONAL
    for field in changed:
        if any(h in field for h in high_fields):
            return HarnessPatchRisk.HIGH
    for field in changed:
        if any(m in field for m in medium_fields):
            return HarnessPatchRisk.MEDIUM

    if any(t in patch_types for t in ["spend_policy_patch", "privacy_policy_patch", "upgrade_policy_patch"]):
        return HarnessPatchRisk.CONSTITUTIONAL
    if any(t in patch_types for t in ["loop_policy_patch", "deploy_policy_patch"]):
        return HarnessPatchRisk.HIGH
    if any(t in patch_types for t in ["model_route_patch", "memory_policy_patch"]):
        return HarnessPatchRisk.MEDIUM

    return HarnessPatchRisk.LOW


def forbidden_mutation_grader(patch: dict) -> tuple[bool, str]:
    payload = patch.get("patch_payload", {})
    for mutation in FORBIDDEN_MUTATIONS:
        if mutation in str(payload).lower():
            return False, f"Forbidden mutation detected: {mutation}"
    return True, "no forbidden mutations"


def deployment_health_grader(capsule: dict) -> tuple[bool, str]:
    budget = capsule.get("budget", {})
    if not budget.get("max_daily_infra_cost"):
        return False, "Missing max_daily_infra_cost"
    return True, "deployment budget valid"


def payment_route_grader(monetization: dict) -> tuple[bool, str]:
    if not monetization.get("routes"):
        return False, "No payment routes defined"
    idempotency = monetization.get("idempotency_key_policy", "")
    if idempotency != "required":
        return False, "idempotency_key_policy must be 'required'"
    return True, "payment routes valid"
