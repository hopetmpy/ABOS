from sqlalchemy import Column, String, Float, DateTime
from datetime import datetime, timezone

from app.db import Base


class Agent(Base):
    __tablename__ = "agents"

    id = Column(String, primary_key=True)
    project_id = Column(String, nullable=False)
    name = Column(String, nullable=False)
    agent_class = Column(String, nullable=False)
    status = Column(String, default="active")

    current_harness_id = Column(String, nullable=True)
    current_harness_version = Column(String, nullable=True)
    balance = Column(Float, default=0.0)

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
