from sqlalchemy import Column, String, Float, JSON, DateTime
from datetime import datetime, timezone

from app.db import Base


class ReleaseCard(Base):
    __tablename__ = "release_cards"

    id = Column(String, primary_key=True)
    title = Column(String, nullable=False)
    source_name = Column(String, nullable=False)
    source_url = Column(String, nullable=True)
    source_type = Column(String, nullable=False)
    source_commitment = Column(String, default="")

    summary = Column(String, nullable=False)
    affected_domains = Column(JSON, default=list)
    affected_capsules = Column(JSON, default=list)
    affected_agent_classes = Column(JSON, default=list)
    recommended_outputs = Column(JSON, default=list)

    created_by = Column(String, default="system")
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class ImprovementObject(Base):
    __tablename__ = "improvement_objects"

    id = Column(String, primary_key=True)
    title = Column(String, nullable=False)
    source_type = Column(String, nullable=False)
    description = Column(String, nullable=False)
    evidence_refs = Column(JSON, default=list)
    affected_agent_classes = Column(JSON, default=list)
    desired_outputs = Column(JSON, default=list)

    privacy_level = Column(String, default="public")
    status = Column(String, default="discovered")

    created_by = Column(String, default="system")
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class CapabilityCapsule(Base):
    __tablename__ = "capability_capsules"

    id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    version = Column(String, nullable=False)

    capsule_type = Column(JSON, default=list)
    lifecycle = Column(String, default="DRAFT")
    install_ring = Column(String, default="R0_KNOW")

    summary = Column(String, default="")
    agent_card = Column(String, default="")

    artifacts = Column(JSON, default=dict)
    permissions = Column(JSON, default=dict)
    compatibility = Column(JSON, default=dict)
    required_evals = Column(JSON, default=list)
    rollback = Column(JSON, default=dict)
    reward_manifest = Column(JSON, default=dict)

    source_improvement_id = Column(String, nullable=True)

    created_by = Column(String, default="system")
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class RepairRequest(Base):
    __tablename__ = "repair_requests"

    id = Column(String, primary_key=True)
    title = Column(String, nullable=False)
    source_failure_cluster_id = Column(String, nullable=True)
    affected_capsules = Column(JSON, default=list)
    affected_agents = Column(JSON, default=list)
    desired_outputs = Column(JSON, default=list)

    bounty_amount = Column(Float, default=0.0)
    status = Column(String, default="open")

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
