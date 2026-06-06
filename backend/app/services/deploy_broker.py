import uuid
from datetime import datetime, timezone, timedelta
from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.deploy import DeploymentCapsule, DeploymentLease
from app.models.receipts import DeploymentReceipt
from app.services.hashing import commitment_for_json


@dataclass
class DeployDecision:
    approved: bool
    reason: str


def authorize_deploy(project_mode: str, capsule: DeploymentCapsule, budget_remaining: float) -> DeployDecision:
    if project_mode == "RED":
        return DeployDecision(approved=False, reason="Project in RED mode, deploy blocked")

    budget = capsule.budget or {}
    max_cost = budget.get("max_daily_infra_cost", 0)
    if max_cost > budget_remaining:
        return DeployDecision(approved=False, reason="Insufficient budget for deployment")

    return DeployDecision(approved=True, reason="Deploy authorized")


async def create_deployment_lease(
    db: AsyncSession,
    project_id: str,
    agent_id: str,
    capsule: DeploymentCapsule,
    provider: str = "mock",
) -> DeploymentLease:
    lease_id = f"lease_{uuid.uuid4().hex[:12]}"
    lease = DeploymentLease(
        id=lease_id,
        project_id=project_id,
        agent_id=agent_id,
        provider=provider,
        resources=capsule.app_shape or {},
        limits=capsule.budget or {},
        payment={"budget_reservation": True},
        revocation={
            "if_cost_exceeds": "freeze",
            "if_eval_failure": "rollback",
            "if_project_red_mode": "no_renewal",
        },
        status="active",
        expires_at=datetime.now(timezone.utc) + timedelta(days=30),
    )
    db.add(lease)
    await db.commit()
    return lease


async def create_deployment_receipt(
    db: AsyncSession,
    capsule: DeploymentCapsule,
    lease: DeploymentLease,
    deploy_result: dict,
) -> DeploymentReceipt:
    receipt_id = f"deploy_receipt_{uuid.uuid4().hex[:12]}"
    receipt = DeploymentReceipt(
        id=receipt_id,
        project_id=capsule.project_id,
        agent_id=capsule.agent_id,
        deployment_capsule_id=capsule.id,
        provider=lease.provider,
        adapter_version="1.0.0",
        build=deploy_result.get("build", {}),
        authorization=deploy_result.get("authorization", {}),
        deployment=deploy_result.get("deployment", {}),
        checks=deploy_result.get("checks", {}),
        economics=deploy_result.get("economics", {}),
        outcome_windows={"T+24h": "pending", "T+7d": "pending", "T+30d": "pending"},
        commitment_hash=commitment_for_json(deploy_result, "conway/deployment-receipt/v1"),
        vault_uri="",
        public_summary={
            "status": "deployed",
            "provider": lease.provider,
            "preview_url": deploy_result.get("deployment", {}).get("preview_url", ""),
        },
    )
    db.add(receipt)
    await db.commit()
    return receipt
