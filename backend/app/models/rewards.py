from sqlalchemy import Column, String, Float, Integer, Boolean, JSON, DateTime
from datetime import datetime, timezone

from app.db import Base


class PaymentReceipt(Base):
    __tablename__ = "payment_receipts"

    id = Column(String, primary_key=True)
    project_id = Column(String, nullable=False)
    agent_id = Column(String, nullable=True)
    deployment_id = Column(String, nullable=True)

    route = Column(String, nullable=False)
    amount = Column(Float, nullable=False)
    asset = Column(String, default="mock_mpp")
    status = Column(String, default="success")

    payer_ref = Column(String, default="")
    payee_ref = Column(String, default="")
    idempotency_key = Column(String, nullable=False, unique=True)

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class UsageAttestation(Base):
    __tablename__ = "usage_attestations"

    id = Column(String, primary_key=True)
    project_id = Column(String, nullable=False)
    agent_id = Column(String, nullable=True)

    capability_id = Column(String, nullable=False)
    install_ring = Column(String, default="R0_KNOW")

    use_count_range = Column(String, default="1-5")
    improvement_claim = Column(JSON, default=dict)
    hard_gates = Column(JSON, default=dict)
    royalty_due = Column(Float, default=0.0)
    raw_receipts_private = Column(Boolean, default=True)

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class RewardLedgerEntry(Base):
    __tablename__ = "reward_ledger"

    id = Column(String, primary_key=True)
    usage_attestation_id = Column(String, nullable=False)

    recipient_id = Column(String, nullable=False)
    reason = Column(String, default="")
    amount = Column(Float, default=0.0)

    status = Column(String, default="pending")
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    settled_at = Column(DateTime, nullable=True)
