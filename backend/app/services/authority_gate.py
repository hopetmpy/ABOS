from dataclasses import dataclass

from app.models.enums import InstallRing, ProjectMode


@dataclass
class AuthorityDecision:
    authorized: bool
    reason: str
    required_actions: list[str] | None = None


def authorize_action(
    install_ring: str,
    project_mode: str,
    has_eval_attestation: bool = False,
    has_rollback: bool = False,
    has_canary_or_approval: bool = False,
    has_passport: bool = False,
    has_governance_approval: bool = False,
    new_permissions: dict | None = None,
) -> AuthorityDecision:
    ring = InstallRing(install_ring)
    mode = ProjectMode(project_mode)

    if ring == InstallRing.R0_KNOW:
        return AuthorityDecision(authorized=True, reason="R0 auto-allowed")

    if ring == InstallRing.R1_THINK:
        if not has_eval_attestation:
            return AuthorityDecision(authorized=False, reason="R1 requires eval attestation")
        if not has_rollback:
            return AuthorityDecision(authorized=False, reason="R1 requires rollback available")
        if new_permissions and (new_permissions.get("external_write") or new_permissions.get("value_movement")):
            return AuthorityDecision(authorized=False, reason="R1 does not allow new permissions")
        return AuthorityDecision(authorized=True, reason="R1 authorized with eval + rollback")

    if ring == InstallRing.R2_READ:
        if not has_eval_attestation:
            return AuthorityDecision(authorized=False, reason="R2 requires eval attestation")
        if new_permissions:
            if new_permissions.get("external_write"):
                return AuthorityDecision(authorized=False, reason="R2 does not allow external_write")
            if new_permissions.get("value_movement"):
                return AuthorityDecision(authorized=False, reason="R2 does not allow value_movement")
        return AuthorityDecision(authorized=True, reason="R2 authorized")

    if ring == InstallRing.R3_WRITE:
        if not has_eval_attestation:
            return AuthorityDecision(authorized=False, reason="R3 requires eval attestation")
        if not has_canary_or_approval:
            return AuthorityDecision(authorized=False, reason="R3 requires canary or human approval")
        if not has_rollback:
            return AuthorityDecision(authorized=False, reason="R3 requires rollback available")
        if mode == ProjectMode.RED:
            return AuthorityDecision(authorized=False, reason="R3 blocked in RED mode")
        return AuthorityDecision(authorized=True, reason="R3 authorized")

    if ring == InstallRing.R4_SPEND:
        if not has_passport:
            return AuthorityDecision(authorized=False, reason="R4 requires capability passport")
        if not has_canary_or_approval:
            return AuthorityDecision(authorized=False, reason="R4 requires approval")
        return AuthorityDecision(authorized=True, reason="R4 authorized with passport + approval")

    if ring == InstallRing.R5_GOVERN:
        if not has_governance_approval:
            return AuthorityDecision(authorized=False, reason="R5 blocked without governance approval")
        return AuthorityDecision(authorized=True, reason="R5 authorized with governance approval")

    return AuthorityDecision(authorized=False, reason="Unknown ring")
