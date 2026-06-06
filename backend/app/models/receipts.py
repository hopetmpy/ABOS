from sqlalchemy import Column, String, Integer, JSON, DateTime
from datetime import datetime, timezone

from app.db import Base


class AutonomyReceipt(Base):
    __tablename__ = "autonomy_receipts"

    id = Column(String, primary_key=True)
    project_id = Column(String, nullable=False)
    agent_id = Column(String, nullable=False)
    harness_id = Column(String, nullable=True)

    capability_class = Column(String, default="")
    visibility = Column(String, default="PRIVATE_RAW")

    commitment_hash = Column(String, default="")
    vault_uri = Column(String, default="")
    public_summary = Column(JSON, default=dict)

    sanctuary_refs = Column(JSON, default=dict)
    cost_summary = Column(JSON, default=dict)
    outcome_summary = Column(JSON, nullable=True)

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class HarnessTraceReceipt(Base):
    __tablename__ = "harness_trace_receipts"

    id = Column(String, primary_key=True)
    eval_run_id = Column(String, nullable=False)
    task_id = Column(String, default="")
    harness_id = Column(String, nullable=False)
    harness_version = Column(String, default="")

    trace_commitment = Column(String, default="")
    vault_uri = Column(String, default="")
    public_summary = Column(JSON, default=dict)

    spans_count = Column(Integer, default=0)
    cost_summary = Column(JSON, default=dict)
    score_summary = Column(JSON, nullable=True)

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class DeploymentReceipt(Base):
    __tablename__ = "deployment_receipts"

    id = Column(String, primary_key=True)
    project_id = Column(String, nullable=False)
    agent_id = Column(String, nullable=False)
    deployment_capsule_id = Column(String, nullable=False)

    provider = Column(String, default="mock")
    adapter_version = Column(String, default="1.0.0")

    build = Column(JSON, default=dict)
    authorization = Column(JSON, default=dict)
    deployment = Column(JSON, default=dict)
    checks = Column(JSON, default=dict)
    economics = Column(JSON, default=dict)
    outcome_windows = Column(JSON, default=dict)

    commitment_hash = Column(String, default="")
    vault_uri = Column(String, default="")
    public_summary = Column(JSON, default=dict)

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
