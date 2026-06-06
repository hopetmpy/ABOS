from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel

from app.db import get_db
from app.models.rewards import UsageAttestation, RewardLedgerEntry, PaymentReceipt
from app.services.reward_router import create_usage_attestation, route_rewards
from app.services.mpp_gateway import verify_mock_payment, route_revenue

router = APIRouter(prefix="/v1/rewards", tags=["rewards"])


class UsageAttestationCreate(BaseModel):
    project_id: str
    agent_id: str | None = None
    capability_id: str
    install_ring: str
    use_count_range: str = "1-5"
    improvement_claim: dict = {}
    hard_gates_pass: bool = True
    royalty_due: float = 0.0


class RouteRewardsRequest(BaseModel):
    usage_attestation_id: str
    reward_manifest: dict = {}
    total_amount: float = 0.0


class PaymentRequest(BaseModel):
    project_id: str
    agent_id: str | None = None
    deployment_id: str | None = None
    route: str
    amount: float
    payer_ref: str
    idempotency_key: str


@router.post("/usage-attestations")
async def create_attestation(data: UsageAttestationCreate, db: AsyncSession = Depends(get_db)):
    att = await create_usage_attestation(
        db, data.project_id, data.agent_id, data.capability_id, data.install_ring,
        data.use_count_range, data.improvement_claim, data.hard_gates_pass, data.royalty_due,
    )
    return {"id": att.id, "capability_id": att.capability_id}


@router.get("/usage-attestations")
async def list_attestations(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(UsageAttestation))
    return [{"id": a.id, "capability_id": a.capability_id, "royalty_due": a.royalty_due} for a in result.scalars().all()]


@router.post("/route")
async def route_rewards_endpoint(data: RouteRewardsRequest, db: AsyncSession = Depends(get_db)):
    entries = await route_rewards(db, data.usage_attestation_id, data.reward_manifest, data.total_amount)
    return [{"id": e.id, "recipient_id": e.recipient_id, "amount": e.amount} for e in entries]


@router.get("/ledger")
async def get_reward_ledger(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(RewardLedgerEntry))
    return [
        {"id": e.id, "recipient_id": e.recipient_id, "amount": e.amount, "status": e.status}
        for e in result.scalars().all()
    ]


@router.post("/ledger/{entry_id}/mark-paid")
async def mark_paid(entry_id: str, db: AsyncSession = Depends(get_db)):
    entry = await db.get(RewardLedgerEntry, entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
    entry.status = "paid"
    await db.commit()
    return {"id": entry.id, "status": "paid"}


@router.post("/payments")
async def create_payment(data: PaymentRequest, db: AsyncSession = Depends(get_db)):
    receipt = await verify_mock_payment(
        db, data.project_id, data.agent_id, data.deployment_id,
        data.route, data.amount, data.payer_ref, data.idempotency_key,
    )
    return {"id": receipt.id, "status": receipt.status, "amount": receipt.amount}


@router.get("/payments")
async def list_payments(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(PaymentReceipt))
    return [{"id": p.id, "route": p.route, "amount": p.amount, "status": p.status} for p in result.scalars().all()]
