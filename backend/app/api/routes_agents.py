from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel

from app.db import get_db
from app.models.agents import Agent

router = APIRouter(prefix="/v1/agents", tags=["agents"])


class AgentCreate(BaseModel):
    id: str
    project_id: str
    name: str
    agent_class: str
    balance: float = 0.0


class AgentResponse(BaseModel):
    id: str
    project_id: str
    name: str
    agent_class: str
    status: str
    current_harness_id: str | None
    current_harness_version: str | None
    balance: float

    class Config:
        from_attributes = True


@router.post("", response_model=AgentResponse)
async def create_agent(data: AgentCreate, db: AsyncSession = Depends(get_db)):
    agent = Agent(
        id=data.id,
        project_id=data.project_id,
        name=data.name,
        agent_class=data.agent_class,
        balance=data.balance,
    )
    db.add(agent)
    await db.commit()
    await db.refresh(agent)
    return agent


@router.get("", response_model=list[AgentResponse])
async def list_agents(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Agent))
    return list(result.scalars().all())


@router.get("/{agent_id}", response_model=AgentResponse)
async def get_agent(agent_id: str, db: AsyncSession = Depends(get_db)):
    agent = await db.get(Agent, agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    return agent


@router.get("/{agent_id}/passport")
async def get_passport(agent_id: str, db: AsyncSession = Depends(get_db)):
    agent = await db.get(Agent, agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    return {
        "agent_id": agent_id,
        "capabilities": {
            "release_monitoring": "silver",
            "deployment": "bronze",
            "mpp_commerce": "bronze",
            "treasury": "shadow",
        },
    }
