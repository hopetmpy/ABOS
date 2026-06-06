from sqlalchemy import Column, String, Float, Integer, JSON, DateTime
from datetime import datetime, timezone

from app.db import Base


class Project(Base):
    __tablename__ = "projects"

    id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    mission = Column(String, nullable=False)

    treasury_balance = Column(Float, default=0.0)
    compute_balance = Column(Float, default=0.0)
    storage_runway_days = Column(Integer, default=30)
    survival_reserve = Column(Float, default=10.0)
    eval_budget_percent = Column(Float, default=0.10)
    deploy_budget_percent = Column(Float, default=0.20)

    mode = Column(String, default="GREEN")
    policy = Column(JSON, default=dict)

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
