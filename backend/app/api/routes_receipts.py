from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
import uuid

from app.db import get_db
from app.models.receipts import AutonomyReceipt, HarnessTraceReceipt, DeploymentReceipt
from app.services.vault import put_private_json
from app.services.hashing import commitment_for_json

router = APIRouter(prefix="/v1/receipts", tags=["receipts"])


class AutonomyReceiptCreate(BaseModel):
    project_id: str
    agent_id: str
    harness_id: str | None = None
    capability_class: str = ""
    raw_data: dict = {}
    public_summary: dict = {}
    cost_summary: dict = {}


@router.post("/autonomy")
async def create_autonomy_receipt(data: AutonomyReceiptCreate, db: AsyncSession = Depends(get_db)):
    # Store raw data in vault
    vault_ref = put_private_json(data.raw_data, "autonomy-receipt")

    receipt = AutonomyReceipt(
        id=f"receipt_{uuid.uuid4().hex[:12]}",
        project_id=data.project_id,
        agent_id=data.agent_id,
        harness_id=data.harness_id,
        capability_class=data.capability_class,
        visibility="PRIVATE_RAW",
        commitment_hash=vault_ref.commitment,
        vault_uri=vault_ref.uri,
        public_summary=data.public_summary,
        sanctuary_refs={"stc_ids": [f"mock_stc_{uuid.uuid4().hex[:8]}"]},
        cost_summary=data.cost_summary,
    )
    db.add(receipt)
    await db.commit()
    return {"id": receipt.id, "commitment_hash": receipt.commitment_hash}


@router.get("/autonomy")
async def list_autonomy_receipts(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(AutonomyReceipt))
    # Public list - summaries only, no raw data
    return [
        {
            "id": r.id,
            "project_id": r.project_id,
            "agent_id": r.agent_id,
            "capability_class": r.capability_class,
            "commitment_hash": r.commitment_hash,
            "public_summary": r.public_summary,
            "created_at": str(r.created_at) if r.created_at else None,
        }
        for r in result.scalars().all()
    ]


@router.get("/autonomy/{receipt_id}")
async def get_autonomy_receipt(receipt_id: str, db: AsyncSession = Depends(get_db)):
    receipt = await db.get(AutonomyReceipt, receipt_id)
    if not receipt:
        raise HTTPException(status_code=404, detail="Receipt not found")
    # Public view - no raw data, only summary
    return {
        "id": receipt.id,
        "project_id": receipt.project_id,
        "agent_id": receipt.agent_id,
        "capability_class": receipt.capability_class,
        "visibility": receipt.visibility,
        "commitment_hash": receipt.commitment_hash,
        "public_summary": receipt.public_summary,
        "cost_summary": receipt.cost_summary,
        "created_at": str(receipt.created_at) if receipt.created_at else None,
    }


@router.get("/autonomy/{receipt_id}/commitment")
async def get_receipt_commitment(receipt_id: str, db: AsyncSession = Depends(get_db)):
    receipt = await db.get(AutonomyReceipt, receipt_id)
    if not receipt:
        raise HTTPException(status_code=404, detail="Receipt not found")
    return {"id": receipt.id, "commitment_hash": receipt.commitment_hash}


@router.post("/harness-trace")
async def create_harness_trace(
    eval_run_id: str,
    harness_id: str,
    raw_trace: dict = {},
    db: AsyncSession = Depends(get_db),
):
    vault_ref = put_private_json(raw_trace, "harness-trace")
    receipt = HarnessTraceReceipt(
        id=f"trace_{uuid.uuid4().hex[:12]}",
        eval_run_id=eval_run_id,
        harness_id=harness_id,
        trace_commitment=vault_ref.commitment,
        vault_uri=vault_ref.uri,
        spans_count=len(raw_trace.get("spans", [])),
    )
    db.add(receipt)
    await db.commit()
    return {"id": receipt.id, "trace_commitment": receipt.trace_commitment}


@router.get("/harness-trace")
async def list_harness_traces(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(HarnessTraceReceipt))
    return [{"id": t.id, "eval_run_id": t.eval_run_id, "spans_count": t.spans_count} for t in result.scalars().all()]


@router.post("/deployment")
async def create_deployment_receipt_endpoint(
    project_id: str,
    agent_id: str,
    capsule_id: str,
    raw_data: dict = {},
    db: AsyncSession = Depends(get_db),
):
    vault_ref = put_private_json(raw_data, "deployment-receipt")
    receipt = DeploymentReceipt(
        id=f"deploy_receipt_{uuid.uuid4().hex[:12]}",
        project_id=project_id,
        agent_id=agent_id,
        deployment_capsule_id=capsule_id,
        commitment_hash=vault_ref.commitment,
        vault_uri=vault_ref.uri,
        public_summary={"status": "deployed"},
    )
    db.add(receipt)
    await db.commit()
    return {"id": receipt.id}


@router.get("/deployment")
async def list_deployment_receipts(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(DeploymentReceipt))
    return [
        {"id": r.id, "project_id": r.project_id, "public_summary": r.public_summary}
        for r in result.scalars().all()
    ]
