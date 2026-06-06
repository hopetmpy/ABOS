import uuid
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.rewards import PaymentReceipt, RewardLedgerEntry


REVENUE_SPLIT = {
    "project_treasury": 70,
    "capability_authors": 10,
    "deploy_broker": 10,
    "eval_pool": 5,
    "forge_protocol": 5,
}


async def verify_mock_payment(
    db: AsyncSession,
    project_id: str,
    agent_id: str | None,
    deployment_id: str | None,
    route: str,
    amount: float,
    payer_ref: str,
    idempotency_key: str,
) -> PaymentReceipt:
    # Check for duplicate
    result = await db.execute(
        select(PaymentReceipt).where(PaymentReceipt.idempotency_key == idempotency_key)
    )
    existing = result.scalars().first()
    if existing:
        if existing.amount != amount:
            raise ValueError("Same idempotency_key with different amount")
        return existing

    receipt_id = f"pay_{uuid.uuid4().hex[:12]}"
    receipt = PaymentReceipt(
        id=receipt_id,
        project_id=project_id,
        agent_id=agent_id,
        deployment_id=deployment_id,
        route=route,
        amount=amount,
        asset="mock_mpp",
        status="success",
        payer_ref=payer_ref,
        payee_ref=project_id,
        idempotency_key=idempotency_key,
    )
    db.add(receipt)
    await db.commit()
    return receipt


async def route_revenue(db: AsyncSession, payment_receipt_id: str) -> list[RewardLedgerEntry]:
    receipt = await db.get(PaymentReceipt, payment_receipt_id)
    if not receipt:
        return []

    entries = []
    for recipient, percent in REVENUE_SPLIT.items():
        entry_id = f"reward_{uuid.uuid4().hex[:12]}"
        amount = receipt.amount * (percent / 100.0)
        entry = RewardLedgerEntry(
            id=entry_id,
            usage_attestation_id=payment_receipt_id,
            recipient_id=recipient,
            reason=f"Revenue split {percent}% from {receipt.route}",
            amount=amount,
            status="pending",
        )
        db.add(entry)
        entries.append(entry)

    await db.commit()
    return entries


async def refund(db: AsyncSession, payment_receipt_id: str, reason: str) -> PaymentReceipt | None:
    receipt = await db.get(PaymentReceipt, payment_receipt_id)
    if not receipt:
        return None
    if reason not in ("duplicate_charge", "service_error"):
        return None
    receipt.status = "refunded"
    await db.commit()
    return receipt
