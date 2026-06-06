from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
import uuid

from app.db import get_db
from app.models.deploy import DeploymentCapsule, DeploymentLease
from app.models.projects import Project
from app.services.deploy_adapters import mock_deploy_adapter
from app.services.deploy_broker import create_deployment_lease, create_deployment_receipt, authorize_deploy
from app.services.budget_governor import compute_project_mode

router = APIRouter(prefix="/v1/deploy", tags=["deploy"])


class DeployCapsuleCreate(BaseModel):
    project_id: str
    agent_id: str
    name: str
    version: str = "1.0.0"
    intent: dict = {}
    app_shape: dict = {}
    monetization: dict = {}
    permissions: dict = {}
    budget: dict = {}
    evals: dict = {}
    rollback: dict = {}


@router.post("/capsules")
async def create_deploy_capsule(data: DeployCapsuleCreate, db: AsyncSession = Depends(get_db)):
    capsule = DeploymentCapsule(
        id=f"deploy_{uuid.uuid4().hex[:12]}",
        project_id=data.project_id,
        agent_id=data.agent_id,
        name=data.name,
        version=data.version,
        intent=data.intent,
        app_shape=data.app_shape,
        monetization=data.monetization,
        permissions=data.permissions,
        budget=data.budget,
        evals=data.evals,
        rollback=data.rollback,
    )
    db.add(capsule)
    await db.commit()
    return {"id": capsule.id, "name": capsule.name}


@router.get("/capsules")
async def list_deploy_capsules(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(DeploymentCapsule))
    return [{"id": c.id, "name": c.name, "lifecycle": c.lifecycle} for c in result.scalars().all()]


@router.get("/capsules/{capsule_id}")
async def get_deploy_capsule(capsule_id: str, db: AsyncSession = Depends(get_db)):
    capsule = await db.get(DeploymentCapsule, capsule_id)
    if not capsule:
        raise HTTPException(status_code=404, detail="Deployment capsule not found")
    return capsule


@router.post("/leases")
async def create_lease(project_id: str, agent_id: str, capsule_id: str, db: AsyncSession = Depends(get_db)):
    capsule = await db.get(DeploymentCapsule, capsule_id)
    if not capsule:
        raise HTTPException(status_code=404, detail="Capsule not found")
    lease = await create_deployment_lease(db, project_id, agent_id, capsule)
    return {"id": lease.id, "provider": lease.provider, "status": lease.status}


@router.get("/leases")
async def list_leases(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(DeploymentLease))
    return [{"id": l.id, "provider": l.provider, "status": l.status} for l in result.scalars().all()]


@router.post("/{capsule_id}/estimate")
async def estimate_cost(capsule_id: str, db: AsyncSession = Depends(get_db)):
    capsule = await db.get(DeploymentCapsule, capsule_id)
    if not capsule:
        raise HTTPException(status_code=404, detail="Capsule not found")
    estimate = mock_deploy_adapter.estimate_cost(capsule)
    return {
        "preview_cost": estimate.preview_cost,
        "canary_cost": estimate.canary_cost,
        "production_cost": estimate.production_cost,
        "daily_infra": estimate.daily_infra,
    }


@router.post("/{capsule_id}/preview")
async def deploy_preview(capsule_id: str, lease_id: str, db: AsyncSession = Depends(get_db)):
    capsule = await db.get(DeploymentCapsule, capsule_id)
    if not capsule:
        raise HTTPException(status_code=404, detail="Capsule not found")
    lease = await db.get(DeploymentLease, lease_id)
    if not lease:
        raise HTTPException(status_code=404, detail="Lease not found")

    # Validate
    validation = mock_deploy_adapter.validate(capsule)
    if not validation.valid:
        raise HTTPException(status_code=400, detail={"errors": validation.errors})

    # Deploy
    deploy_result = mock_deploy_adapter.create_preview(capsule, lease)
    receipt = await create_deployment_receipt(db, capsule, lease, deploy_result)

    capsule.lifecycle = "preview_deployed"
    await db.commit()

    return {"receipt_id": receipt.id, "preview_url": deploy_result["deployment"]["preview_url"]}


@router.post("/{capsule_id}/canary")
async def deploy_canary(capsule_id: str, db: AsyncSession = Depends(get_db)):
    capsule = await db.get(DeploymentCapsule, capsule_id)
    if not capsule:
        raise HTTPException(status_code=404, detail="Capsule not found")
    project = await db.get(Project, capsule.project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    current_mode = compute_project_mode(project).value
    decision = authorize_deploy(current_mode, capsule, project.treasury_balance)
    if not decision.approved:
        raise HTTPException(status_code=403, detail=decision.reason)

    capsule.lifecycle = "canary"
    await db.commit()
    return {"capsule_id": capsule.id, "lifecycle": "canary"}


@router.post("/{capsule_id}/rollback")
async def rollback_deploy(capsule_id: str, db: AsyncSession = Depends(get_db)):
    capsule = await db.get(DeploymentCapsule, capsule_id)
    if not capsule:
        raise HTTPException(status_code=404, detail="Capsule not found")
    capsule.lifecycle = "rolled_back"
    await db.commit()
    return {"capsule_id": capsule.id, "lifecycle": "rolled_back"}
