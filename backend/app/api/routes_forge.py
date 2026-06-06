from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
import uuid

from app.db import get_db
from app.models.forge import ReleaseCard, ImprovementObject, CapabilityCapsule, RepairRequest

router = APIRouter(prefix="/v1/forge", tags=["forge"])


class ReleaseCardCreate(BaseModel):
    title: str
    source_name: str
    source_url: str | None = None
    source_type: str
    summary: str
    affected_domains: list[str] = []
    affected_capsules: list[str] = []
    affected_agent_classes: list[str] = []


class ImprovementCreate(BaseModel):
    title: str
    source_type: str
    description: str
    evidence_refs: list[str] = []
    affected_agent_classes: list[str] = []
    privacy_level: str = "public"


class CapsuleCreate(BaseModel):
    name: str
    version: str
    capsule_type: list[str] = []
    install_ring: str = "R0_KNOW"
    summary: str = ""
    permissions: dict = {}
    required_evals: list[str] = []
    rollback: dict = {}
    reward_manifest: dict = {}
    source_improvement_id: str | None = None


@router.post("/release-cards")
async def create_release_card(data: ReleaseCardCreate, db: AsyncSession = Depends(get_db)):
    card = ReleaseCard(
        id=f"rc_{uuid.uuid4().hex[:12]}",
        title=data.title,
        source_name=data.source_name,
        source_url=data.source_url,
        source_type=data.source_type,
        summary=data.summary,
        affected_domains=data.affected_domains,
        affected_capsules=data.affected_capsules,
        affected_agent_classes=data.affected_agent_classes,
    )
    db.add(card)
    await db.commit()
    return {"id": card.id, "title": card.title}


@router.get("/release-cards")
async def list_release_cards(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(ReleaseCard))
    return [{"id": r.id, "title": r.title, "source_name": r.source_name} for r in result.scalars().all()]


@router.post("/improvements")
async def create_improvement(data: ImprovementCreate, db: AsyncSession = Depends(get_db)):
    imp = ImprovementObject(
        id=f"imp_{uuid.uuid4().hex[:12]}",
        title=data.title,
        source_type=data.source_type,
        description=data.description,
        evidence_refs=data.evidence_refs,
        affected_agent_classes=data.affected_agent_classes,
        privacy_level=data.privacy_level,
    )
    db.add(imp)
    await db.commit()
    return {"id": imp.id, "title": imp.title}


@router.get("/improvements")
async def list_improvements(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(ImprovementObject))
    return [{"id": i.id, "title": i.title, "status": i.status} for i in result.scalars().all()]


@router.get("/improvements/{improvement_id}")
async def get_improvement(improvement_id: str, db: AsyncSession = Depends(get_db)):
    imp = await db.get(ImprovementObject, improvement_id)
    if not imp:
        raise HTTPException(status_code=404, detail="Improvement not found")
    return imp


@router.post("/capsules")
async def create_capsule(data: CapsuleCreate, db: AsyncSession = Depends(get_db)):
    capsule = CapabilityCapsule(
        id=f"cap_{uuid.uuid4().hex[:12]}",
        name=data.name,
        version=data.version,
        capsule_type=data.capsule_type,
        install_ring=data.install_ring,
        summary=data.summary,
        permissions=data.permissions,
        required_evals=data.required_evals,
        rollback=data.rollback,
        reward_manifest=data.reward_manifest,
        source_improvement_id=data.source_improvement_id,
    )
    db.add(capsule)
    await db.commit()
    return {"id": capsule.id, "name": capsule.name}


@router.get("/capsules")
async def list_capsules(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(CapabilityCapsule))
    return [{"id": c.id, "name": c.name, "version": c.version, "lifecycle": c.lifecycle} for c in result.scalars().all()]


@router.get("/capsules/{capsule_id}")
async def get_capsule(capsule_id: str, db: AsyncSession = Depends(get_db)):
    capsule = await db.get(CapabilityCapsule, capsule_id)
    if not capsule:
        raise HTTPException(status_code=404, detail="Capsule not found")
    return capsule


@router.post("/capsules/{capsule_id}/publish")
async def publish_capsule(capsule_id: str, db: AsyncSession = Depends(get_db)):
    capsule = await db.get(CapabilityCapsule, capsule_id)
    if not capsule:
        raise HTTPException(status_code=404, detail="Capsule not found")
    capsule.lifecycle = "PUBLISHED"
    await db.commit()
    return {"id": capsule.id, "lifecycle": capsule.lifecycle}


@router.post("/repair-requests")
async def create_repair_request(title: str = "", db: AsyncSession = Depends(get_db)):
    rr = RepairRequest(id=f"repair_{uuid.uuid4().hex[:12]}", title=title or "Untitled repair")
    db.add(rr)
    await db.commit()
    return {"id": rr.id}


@router.get("/repair-requests")
async def list_repair_requests(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(RepairRequest))
    return [{"id": r.id, "title": r.title, "status": r.status} for r in result.scalars().all()]
