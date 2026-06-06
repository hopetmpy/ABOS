from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel

from app.db import get_db
from app.models.projects import Project
from app.services.budget_governor import compute_project_mode

router = APIRouter(prefix="/v1/projects", tags=["projects"])


class ProjectCreate(BaseModel):
    id: str
    name: str
    mission: str
    treasury_balance: float = 100.0
    compute_balance: float = 50.0
    storage_runway_days: int = 30
    survival_reserve: float = 10.0
    policy: dict = {}


class ProjectResponse(BaseModel):
    id: str
    name: str
    mission: str
    treasury_balance: float
    compute_balance: float
    storage_runway_days: int
    survival_reserve: float
    mode: str
    policy: dict

    class Config:
        from_attributes = True


@router.post("", response_model=ProjectResponse)
async def create_project(data: ProjectCreate, db: AsyncSession = Depends(get_db)):
    project = Project(
        id=data.id,
        name=data.name,
        mission=data.mission,
        treasury_balance=data.treasury_balance,
        compute_balance=data.compute_balance,
        storage_runway_days=data.storage_runway_days,
        survival_reserve=data.survival_reserve,
        mode="GREEN",
        policy=data.policy or {
            "min_storage_runway_days": 30,
            "min_compute_runway_days": 7,
            "max_daily_infra_cost": 2.0,
            "max_eval_spend_percent": 0.10,
            "max_deploy_spend_percent": 0.20,
            "allow_public_improvements": False,
            "human_required_for": ["R4_SPEND", "R5_GOVERN"],
        },
    )
    db.add(project)
    await db.commit()
    await db.refresh(project)
    return project


@router.get("", response_model=list[ProjectResponse])
async def list_projects(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Project))
    return list(result.scalars().all())


@router.get("/{project_id}", response_model=ProjectResponse)
async def get_project(project_id: str, db: AsyncSession = Depends(get_db)):
    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


@router.post("/{project_id}/recompute-mode")
async def recompute_mode(project_id: str, db: AsyncSession = Depends(get_db)):
    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    new_mode = compute_project_mode(project)
    project.mode = new_mode.value
    await db.commit()
    return {"project_id": project_id, "mode": new_mode.value}
