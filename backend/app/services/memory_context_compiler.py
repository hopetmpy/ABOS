from dataclasses import dataclass, field

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.memory import MemoryItem
from app.models.projects import Project


@dataclass
class CompiledContext:
    mission: str = ""
    mode: str = ""
    runway_days: int = 0
    treasury_balance: float = 0.0
    relevant_memories: list[dict] = field(default_factory=list)
    omitted_count: int = 0


async def compile_context(
    db: AsyncSession,
    project_id: str,
    agent_id: str | None = None,
    task: str = "",
    target: str = "planner",
    token_budget: int = 4000,
) -> CompiledContext:
    project = await db.get(Project, project_id)
    if not project:
        return CompiledContext()

    # Fetch memories
    query = select(MemoryItem).where(MemoryItem.project_id == project_id)
    if agent_id:
        query = query.where(MemoryItem.agent_id == agent_id)
    result = await db.execute(query)
    memories = list(result.scalars().all())

    # Filter by egress policy
    allowed_memories = []
    for mem in memories:
        egress = mem.egress_policy or {}
        if target == "remote_model" and not egress.get("can_send_to_remote_model", True):
            continue
        if target == "user_visible" and not egress.get("can_show_user", True):
            continue
        if target == "forge" and not egress.get("can_publish_to_forge", True):
            continue
        allowed_memories.append(mem)

    # Rank by relevance * importance * confidence
    ranked = sorted(
        allowed_memories,
        key=lambda m: (m.importance or 0.5) * (m.confidence or 0.5),
        reverse=True,
    )

    # Fit within token budget (rough estimate: 1 memory ~ 100 tokens)
    max_items = token_budget // 100
    selected = ranked[:max_items]
    omitted = len(ranked) - len(selected)

    return CompiledContext(
        mission=project.mission,
        mode=project.mode,
        runway_days=project.storage_runway_days,
        treasury_balance=project.treasury_balance,
        relevant_memories=[
            {
                "id": m.id,
                "type": m.memory_type,
                "statement": m.statement,
                "confidence": m.confidence,
                "importance": m.importance,
            }
            for m in selected
        ],
        omitted_count=omitted,
    )


async def distill_receipts_to_memory(
    db: AsyncSession,
    project_id: str,
    agent_id: str,
    statement: str,
    source_refs: list[str],
    memory_type: str = "episodic",
) -> MemoryItem:
    import uuid

    mem = MemoryItem(
        id=f"mem_{uuid.uuid4().hex[:12]}",
        project_id=project_id,
        agent_id=agent_id,
        memory_type=memory_type,
        statement=statement,
        source_refs=source_refs,
        confidence=0.85,
        importance=0.7,
        privacy_label="project_private",
        egress_policy={
            "can_use_in_context": True,
            "can_show_user": True,
            "can_publish_to_forge": False,
            "can_send_to_remote_model": False,
        },
    )
    db.add(mem)
    await db.commit()
    return mem
