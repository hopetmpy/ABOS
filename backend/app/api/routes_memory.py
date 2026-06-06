from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
import uuid

from app.db import get_db
from app.models.memory import MemoryItem
from app.services.memory_context_compiler import compile_context, distill_receipts_to_memory

router = APIRouter(prefix="/v1/memory", tags=["memory"])


class MemoryCreate(BaseModel):
    project_id: str
    agent_id: str | None = None
    memory_type: str
    statement: str
    summary: str | None = None
    source_refs: list[str] = []
    confidence: float = 0.5
    importance: float = 0.5
    privacy_label: str = "project_private"
    egress_policy: dict = {}


class ContextRequest(BaseModel):
    project_id: str
    agent_id: str | None = None
    task: str = ""
    target: str = "planner"
    token_budget: int = 4000


class DistillRequest(BaseModel):
    project_id: str
    agent_id: str
    statement: str
    source_refs: list[str] = []
    memory_type: str = "episodic"


@router.post("")
async def create_memory(data: MemoryCreate, db: AsyncSession = Depends(get_db)):
    mem = MemoryItem(
        id=f"mem_{uuid.uuid4().hex[:12]}",
        project_id=data.project_id,
        agent_id=data.agent_id,
        memory_type=data.memory_type,
        statement=data.statement,
        summary=data.summary,
        source_refs=data.source_refs,
        confidence=data.confidence,
        importance=data.importance,
        privacy_label=data.privacy_label,
        egress_policy=data.egress_policy or {
            "can_use_in_context": True,
            "can_show_user": True,
            "can_publish_to_forge": False,
            "can_send_to_remote_model": False,
        },
    )
    db.add(mem)
    await db.commit()
    return {"id": mem.id, "statement": mem.statement}


@router.get("")
async def list_memory(project_id: str | None = None, db: AsyncSession = Depends(get_db)):
    query = select(MemoryItem)
    if project_id:
        query = query.where(MemoryItem.project_id == project_id)
    result = await db.execute(query)
    items = result.scalars().all()
    # Only show memories allowed for user display
    visible = []
    for item in items:
        egress = item.egress_policy or {}
        if egress.get("can_show_user", True):
            visible.append({
                "id": item.id,
                "memory_type": item.memory_type,
                "statement": item.statement,
                "confidence": item.confidence,
                "importance": item.importance,
                "privacy_label": item.privacy_label,
            })
    return visible


@router.get("/{memory_id}")
async def get_memory(memory_id: str, db: AsyncSession = Depends(get_db)):
    mem = await db.get(MemoryItem, memory_id)
    if not mem:
        raise HTTPException(status_code=404, detail="Memory item not found")
    return mem


@router.post("/compile-context")
async def compile_context_endpoint(data: ContextRequest, db: AsyncSession = Depends(get_db)):
    ctx = await compile_context(
        db, data.project_id, data.agent_id, data.task, data.target, data.token_budget
    )
    return ctx


@router.post("/distill")
async def distill_endpoint(data: DistillRequest, db: AsyncSession = Depends(get_db)):
    mem = await distill_receipts_to_memory(
        db, data.project_id, data.agent_id, data.statement, data.source_refs, data.memory_type
    )
    return {"id": mem.id, "statement": mem.statement}
