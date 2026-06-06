import uuid
from datetime import datetime, timezone
from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.budget import BudgetLedgerEntry
from app.models.projects import Project
from app.models.enums import ProjectMode


@dataclass
class CostEstimate:
    category: str
    estimated_cost: float
    confidence: float = 0.8


@dataclass
class BudgetDecision:
    approved: bool
    reason: str
    reservation_id: str | None = None


def compute_project_mode(project: Project) -> ProjectMode:
    if project.storage_runway_days < 7 or project.treasury_balance < project.survival_reserve:
        return ProjectMode.RED
    if project.storage_runway_days < 14 or project.treasury_balance < project.survival_reserve * 1.5:
        return ProjectMode.YELLOW
    return ProjectMode.GREEN


def allowed_actions_for_mode(mode: ProjectMode) -> list[str]:
    if mode == ProjectMode.GREEN:
        return ["eval", "canary", "deploy", "upgrade", "experiment", "forge"]
    elif mode == ProjectMode.YELLOW:
        return ["cheap_eval", "high_confidence_canary", "repair", "revenue_collection"]
    elif mode == ProjectMode.RED:
        return ["storage_renewal", "rollback", "repair", "revenue_collection", "low_cost_memory_distillation"]
    elif mode == ProjectMode.HIBERNATE:
        return ["preserve_state"]
    return ["archive", "settle", "withdraw"]


async def reserve_budget(
    db: AsyncSession,
    project_id: str,
    agent_id: str | None,
    category: str,
    estimated_max_cost: float,
    reason: str,
    related_object_type: str | None = None,
    related_object_id: str | None = None,
) -> BudgetDecision:
    project = await db.get(Project, project_id)
    if not project:
        return BudgetDecision(approved=False, reason="Project not found")

    mode = compute_project_mode(project)
    if mode == ProjectMode.RED and category in ("eval", "deploy", "experiment"):
        return BudgetDecision(approved=False, reason=f"Project in RED mode, {category} blocked")
    if mode == ProjectMode.HIBERNATE:
        return BudgetDecision(approved=False, reason="Project in HIBERNATE mode")

    if project.treasury_balance - estimated_max_cost < project.survival_reserve:
        return BudgetDecision(approved=False, reason="Insufficient balance after survival reserve")

    reservation_id = f"budget_{uuid.uuid4().hex[:12]}"
    entry = BudgetLedgerEntry(
        id=reservation_id,
        project_id=project_id,
        agent_id=agent_id,
        category=category,
        amount_reserved=estimated_max_cost,
        status="reserved",
        reason=reason,
        related_object_type=related_object_type,
        related_object_id=related_object_id,
    )
    db.add(entry)

    project.treasury_balance -= estimated_max_cost
    await db.commit()

    return BudgetDecision(approved=True, reason="Approved", reservation_id=reservation_id)


async def settle_budget(db: AsyncSession, reservation_id: str, actual_cost: float) -> BudgetLedgerEntry | None:
    entry = await db.get(BudgetLedgerEntry, reservation_id)
    if not entry or entry.status != "reserved":
        return None

    project = await db.get(Project, entry.project_id)
    if not project:
        return None

    refund = entry.amount_reserved - actual_cost
    if refund > 0:
        project.treasury_balance += refund
    elif refund < 0:
        project.treasury_balance += refund  # deduct the overrun

    entry.amount_settled = actual_cost
    entry.status = "settled"
    entry.settled_at = datetime.now(timezone.utc)
    await db.commit()
    return entry


async def release_budget(db: AsyncSession, reservation_id: str) -> BudgetLedgerEntry | None:
    entry = await db.get(BudgetLedgerEntry, reservation_id)
    if not entry or entry.status != "reserved":
        return None

    project = await db.get(Project, entry.project_id)
    if not project:
        return None

    project.treasury_balance += entry.amount_reserved
    entry.status = "released"
    entry.settled_at = datetime.now(timezone.utc)
    await db.commit()
    return entry
