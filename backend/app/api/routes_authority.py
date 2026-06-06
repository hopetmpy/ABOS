from fastapi import APIRouter
from pydantic import BaseModel

from app.services.authority_gate import authorize_action, AuthorityDecision

router = APIRouter(prefix="/v1/authority", tags=["authority"])


class AuthorizeRequest(BaseModel):
    install_ring: str
    project_mode: str
    has_eval_attestation: bool = False
    has_rollback: bool = False
    has_canary_or_approval: bool = False
    has_passport: bool = False
    has_governance_approval: bool = False
    new_permissions: dict | None = None


@router.post("/authorize-action")
async def authorize_action_endpoint(data: AuthorizeRequest):
    decision = authorize_action(
        install_ring=data.install_ring,
        project_mode=data.project_mode,
        has_eval_attestation=data.has_eval_attestation,
        has_rollback=data.has_rollback,
        has_canary_or_approval=data.has_canary_or_approval,
        has_passport=data.has_passport,
        has_governance_approval=data.has_governance_approval,
        new_permissions=data.new_permissions,
    )
    return {"authorized": decision.authorized, "reason": decision.reason}


@router.post("/authorize-upgrade")
async def authorize_upgrade(data: AuthorizeRequest):
    return await authorize_action_endpoint(data)


@router.post("/authorize-deployment")
async def authorize_deployment(data: AuthorizeRequest):
    return await authorize_action_endpoint(data)


@router.post("/authorize-harness-patch")
async def authorize_harness_patch(data: AuthorizeRequest):
    return await authorize_action_endpoint(data)
