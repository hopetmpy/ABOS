from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel

from app.db import get_db
from app.models.budget import BudgetLedgerEntry
from app.models.projects import Project
from app.services.budget_governor import reserve_budget, settle_budget, release_budget, compute_project_mode

router = APIRouter(prefix="/v1/budget", tags=["budget"])


class ReserveRequest(BaseModel):
    project_id: str
    agent_id: str | None = None
    category: str
    estimated_max_cost: float
    reason: str = ""


class SettleRequest(BaseModel):
    reservation_id: str
    actual_cost: float


class ReleaseRequest(BaseModel):
    reservation_id: str


@router.get("/project/{project_id}")
async def get_project_budget(project_id: str, db: AsyncSession = Depends(get_db)):
    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    result = await db.execute(
        select(BudgetLedgerEntry).where(
            BudgetLedgerEntry.project_id == project_id,
            BudgetLedgerEntry.status == "reserved",
        )
    )
    reserved_entries = result.scalars().all()
    total_reserved = sum(e.amount_reserved for e in reserved_entries)

    return {
        "project_id": project_id,
        "treasury_balance": project.treasury_balance,
        "compute_balance": project.compute_balance,
        "storage_runway_days": project.storage_runway_days,
        "survival_reserve": project.survival_reserve,
        "total_reserved": total_reserved,
        "mode": project.mode,
        "computed_mode": compute_project_mode(project).value,
    }


@router.post("/reserve")
async def reserve(data: ReserveRequest, db: AsyncSession = Depends(get_db)):
    decision = await reserve_budget(
        db, data.project_id, data.agent_id, data.category, data.estimated_max_cost, data.reason
    )
    if not decision.approved:
        raise HTTPException(status_code=403, detail=decision.reason)
    return {"reservation_id": decision.reservation_id, "approved": True}


@router.post("/settle")
async def settle(data: SettleRequest, db: AsyncSession = Depends(get_db)):
    entry = await settle_budget(db, data.reservation_id, data.actual_cost)
    if not entry:
        raise HTTPException(status_code=404, detail="Reservation not found or already settled")
    return {"reservation_id": entry.id, "status": entry.status, "settled_amount": entry.amount_settled}


@router.post("/release")
async def release(data: ReleaseRequest, db: AsyncSession = Depends(get_db)):
    entry = await release_budget(db, data.reservation_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Reservation not found or already settled")
    return {"reservation_id": entry.id, "status": entry.status}
