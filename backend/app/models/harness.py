from sqlalchemy import Column, String, Boolean, JSON, DateTime
from datetime import datetime, timezone

from app.db import Base


class HarnessCapsule(Base):
    __tablename__ = "harness_capsules"

    id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    version = Column(String, nullable=False)
    agent_class = Column(String, nullable=False)
    parent_version = Column(String, nullable=True)

    runtime = Column(JSON, default=dict)
    model_policy = Column(JSON, default=dict)
    instructions = Column(JSON, default=dict)
    orchestration = Column(JSON, default=dict)
    tools = Column(JSON, default=dict)
    permissions = Column(JSON, default=dict)
    memory = Column(JSON, default=dict)
    budget = Column(JSON, default=dict)
    safety = Column(JSON, default=dict)
    eval_hooks = Column(JSON, default=dict)
    observability = Column(JSON, default=dict)
    deployment_policy = Column(JSON, default=dict)
    upgrade = Column(JSON, default=dict)

    lifecycle = Column(String, default="DRAFT")
    created_by = Column(String, default="system")
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class HarnessPatch(Base):
    __tablename__ = "harness_patches"

    id = Column(String, primary_key=True)
    target_harness_id = Column(String, nullable=False)
    target_version = Column(String, nullable=False)

    patch_type = Column(JSON, default=list)
    hypothesis = Column(String, default="")
    evidence_refs = Column(JSON, default=list)

    changed_fields = Column(JSON, default=list)
    patch_payload = Column(JSON, default=dict)
    permission_diff = Column(JSON, default=dict)

    risk = Column(String, default="LOW")
    required_evals = Column(JSON, default=list)

    rollback_available = Column(Boolean, default=True)
    status = Column(String, default="draft")

    created_by = Column(String, default="system")
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
