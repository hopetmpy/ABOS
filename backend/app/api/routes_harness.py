from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
import uuid

from app.db import get_db
from app.models.harness import HarnessCapsule, HarnessPatch
from app.services.graders import harness_patch_risk_grader, forbidden_mutation_grader

router = APIRouter(prefix="/v1", tags=["harness"])


class HarnessCreate(BaseModel):
    name: str
    version: str
    agent_class: str
    runtime: dict = {}
    model_policy: dict = {}
    instructions: dict = {}
    tools: dict = {}
    permissions: dict = {}
    memory: dict = {}
    budget: dict = {}
    safety: dict = {}


class PatchCreate(BaseModel):
    target_harness_id: str
    target_version: str
    patch_type: list[str] = []
    hypothesis: str = ""
    evidence_refs: list[str] = []
    changed_fields: list[str] = []
    patch_payload: dict = {}
    permission_diff: dict = {}
    required_evals: list[str] = []
    rollback_available: bool = True


@router.post("/harnesses")
async def create_harness(data: HarnessCreate, db: AsyncSession = Depends(get_db)):
    harness = HarnessCapsule(
        id=f"harness_{uuid.uuid4().hex[:12]}",
        name=data.name,
        version=data.version,
        agent_class=data.agent_class,
        runtime=data.runtime,
        model_policy=data.model_policy,
        instructions=data.instructions,
        tools=data.tools,
        permissions=data.permissions,
        memory=data.memory,
        budget=data.budget,
        safety=data.safety,
    )
    db.add(harness)
    await db.commit()
    return {"id": harness.id, "name": harness.name, "version": harness.version}


@router.get("/harnesses")
async def list_harnesses(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(HarnessCapsule))
    return [{"id": h.id, "name": h.name, "version": h.version, "lifecycle": h.lifecycle} for h in result.scalars().all()]


@router.get("/harnesses/{harness_id}")
async def get_harness(harness_id: str, db: AsyncSession = Depends(get_db)):
    harness = await db.get(HarnessCapsule, harness_id)
    if not harness:
        raise HTTPException(status_code=404, detail="Harness not found")
    return harness


@router.post("/harness-patches")
async def create_patch(data: PatchCreate, db: AsyncSession = Depends(get_db)):
    patch = HarnessPatch(
        id=f"patch_{uuid.uuid4().hex[:12]}",
        target_harness_id=data.target_harness_id,
        target_version=data.target_version,
        patch_type=data.patch_type,
        hypothesis=data.hypothesis,
        evidence_refs=data.evidence_refs,
        changed_fields=data.changed_fields,
        patch_payload=data.patch_payload,
        permission_diff=data.permission_diff,
        required_evals=data.required_evals,
        rollback_available=data.rollback_available,
    )
    db.add(patch)
    await db.commit()
    return {"id": patch.id, "status": patch.status}


@router.get("/harness-patches")
async def list_patches(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(HarnessPatch))
    return [{"id": p.id, "risk": p.risk, "status": p.status} for p in result.scalars().all()]


@router.get("/harness-patches/{patch_id}")
async def get_patch(patch_id: str, db: AsyncSession = Depends(get_db)):
    patch = await db.get(HarnessPatch, patch_id)
    if not patch:
        raise HTTPException(status_code=404, detail="Patch not found")
    return patch


@router.post("/harness-patches/{patch_id}/classify-risk")
async def classify_risk(patch_id: str, db: AsyncSession = Depends(get_db)):
    patch = await db.get(HarnessPatch, patch_id)
    if not patch:
        raise HTTPException(status_code=404, detail="Patch not found")

    # Check forbidden mutations
    valid, reason = forbidden_mutation_grader({"patch_payload": patch.patch_payload})
    if not valid:
        patch.status = "rejected"
        await db.commit()
        return {"id": patch.id, "risk": "REJECTED", "reason": reason}

    risk = harness_patch_risk_grader({
        "patch_type": patch.patch_type,
        "changed_fields": patch.changed_fields,
    })
    patch.risk = risk.value
    await db.commit()
    return {"id": patch.id, "risk": risk.value}


@router.post("/harness-patches/{patch_id}/promote")
async def promote_patch(patch_id: str, db: AsyncSession = Depends(get_db)):
    patch = await db.get(HarnessPatch, patch_id)
    if not patch:
        raise HTTPException(status_code=404, detail="Patch not found")

    if patch.risk == "CONSTITUTIONAL":
        return {"id": patch.id, "status": "blocked", "reason": "CONSTITUTIONAL patches require governance approval"}

    patch.status = "promoted"
    await db.commit()
    return {"id": patch.id, "status": "promoted"}
