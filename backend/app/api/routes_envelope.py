from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel

from app.db import get_db
from app.models.envelope import AutomatonOperatingEnvelope
from app.services.hashing import commitment_for_json

router = APIRouter(prefix="/v1/envelopes", tags=["envelopes"])


class EnvelopeCreate(BaseModel):
    id: str
    agent_id: str
    project_id: str


@router.post("")
async def create_envelope(data: EnvelopeCreate, db: AsyncSession = Depends(get_db)):
    mock_root = lambda domain: commitment_for_json({"agent": data.agent_id}, domain)[:16]

    envelope = AutomatonOperatingEnvelope(
        id=data.id,
        agent_id=data.agent_id,
        project_id=data.project_id,
        pid_star=mock_root("pid_star"),
        agent_identity_root=mock_root("identity"),
        constitution_root=mock_root("constitution"),
        harness_root=mock_root("harness"),
        model_policy_root=mock_root("model_policy"),
        tool_policy_root=mock_root("tool_policy"),
        orchestration_policy_root=mock_root("orchestration"),
        memory_egress_policy_root=mock_root("memory_egress"),
        treasury_policy_root=mock_root("treasury"),
        budget_policy_root=mock_root("budget"),
        survival_reserve_policy_root=mock_root("survival"),
        reward_policy_root=mock_root("reward"),
        memory_index_root=mock_root("memory_index"),
        episodic_memory_root=mock_root("episodic"),
        semantic_memory_root=mock_root("semantic"),
        procedural_memory_root=mock_root("procedural"),
        strategic_memory_root=mock_root("strategic"),
        financial_memory_root=mock_root("financial"),
        installed_capsules_root=mock_root("capsules"),
        subscribed_feeds_root=mock_root("feeds"),
        improvement_policy_root=mock_root("improvement"),
        contribution_policy_root=mock_root("contribution"),
        eval_policy_root=mock_root("eval"),
        capability_passport_root=mock_root("passport"),
        eval_attestation_root=mock_root("attestation"),
        hidden_holdout_policy_root=mock_root("holdout"),
        receipt_policy_root=mock_root("receipt"),
        deployment_policy_root=mock_root("deploy"),
        deployment_registry_root=mock_root("deploy_reg"),
        deployment_lease_root=mock_root("lease"),
        mpp_gateway_policy_root=mock_root("mpp"),
        provider_adapter_policy_root=mock_root("provider"),
        install_ring_policy_root=mock_root("ring"),
        upgrade_policy_root=mock_root("upgrade"),
        rollback_policy_root=mock_root("rollback"),
    )
    db.add(envelope)
    await db.commit()
    await db.refresh(envelope)
    return {"id": envelope.id, "agent_id": envelope.agent_id, "status": "created"}


@router.get("/{agent_id}")
async def get_envelope(agent_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(AutomatonOperatingEnvelope).where(AutomatonOperatingEnvelope.agent_id == agent_id)
    )
    envelope = result.scalars().first()
    if not envelope:
        raise HTTPException(status_code=404, detail="Envelope not found")
    return envelope
