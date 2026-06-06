from sqlalchemy import Column, String, Float, DateTime
from datetime import datetime, timezone

from app.db import Base


class BudgetLedgerEntry(Base):
    __tablename__ = "budget_ledger"

    id = Column(String, primary_key=True)
    project_id = Column(String, nullable=False)
    agent_id = Column(String, nullable=True)

    category = Column(String, nullable=False)
    amount_reserved = Column(Float, default=0.0)
    amount_settled = Column(Float, nullable=True)

    status = Column(String, default="reserved")
    reason = Column(String, default="")
    related_object_type = Column(String, nullable=True)
    related_object_id = Column(String, nullable=True)

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    settled_at = Column(DateTime, nullable=True)
