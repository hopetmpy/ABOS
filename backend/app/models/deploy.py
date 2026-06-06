from sqlalchemy import Column, String, JSON, DateTime
from datetime import datetime, timezone

from app.db import Base


class DeploymentCapsule(Base):
    __tablename__ = "deployment_capsules"

    id = Column(String, primary_key=True)
    project_id = Column(String, nullable=False)
    agent_id = Column(String, nullable=False)

    name = Column(String, nullable=False)
    version = Column(String, default="1.0.0")

    intent = Column(JSON, default=dict)
    source = Column(JSON, default=dict)
    app_shape = Column(JSON, default=dict)
    auth = Column(JSON, default=dict)
    monetization = Column(JSON, default=dict)
    permissions = Column(JSON, default=dict)
    budget = Column(JSON, default=dict)
    evals = Column(JSON, default=dict)
    rollback = Column(JSON, default=dict)

    lifecycle = Column(String, default="draft")
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class DeploymentLease(Base):
    __tablename__ = "deployment_leases"

    id = Column(String, primary_key=True)
    project_id = Column(String, nullable=False)
    agent_id = Column(String, nullable=False)

    provider = Column(String, default="mock")
    resources = Column(JSON, default=dict)
    limits = Column(JSON, default=dict)
    payment = Column(JSON, default=dict)
    revocation = Column(JSON, default=dict)

    status = Column(String, default="active")
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    expires_at = Column(DateTime, nullable=True)
