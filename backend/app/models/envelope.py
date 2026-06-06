from sqlalchemy import Column, String, DateTime
from datetime import datetime, timezone

from app.db import Base


class AutomatonOperatingEnvelope(Base):
    __tablename__ = "envelopes"

    id = Column(String, primary_key=True)
    agent_id = Column(String, nullable=False, unique=True)
    project_id = Column(String, nullable=False)

    pid_star = Column(String, default="")
    agent_identity_root = Column(String, default="")
    constitution_root = Column(String, default="")

    harness_root = Column(String, default="")
    model_policy_root = Column(String, default="")
    tool_policy_root = Column(String, default="")
    orchestration_policy_root = Column(String, default="")
    memory_egress_policy_root = Column(String, default="")

    treasury_policy_root = Column(String, default="")
    budget_policy_root = Column(String, default="")
    survival_reserve_policy_root = Column(String, default="")
    reward_policy_root = Column(String, default="")

    memory_index_root = Column(String, default="")
    episodic_memory_root = Column(String, default="")
    semantic_memory_root = Column(String, default="")
    procedural_memory_root = Column(String, default="")
    strategic_memory_root = Column(String, default="")
    financial_memory_root = Column(String, default="")

    installed_capsules_root = Column(String, default="")
    subscribed_feeds_root = Column(String, default="")
    improvement_policy_root = Column(String, default="")
    contribution_policy_root = Column(String, default="")

    eval_policy_root = Column(String, default="")
    capability_passport_root = Column(String, default="")
    eval_attestation_root = Column(String, default="")
    hidden_holdout_policy_root = Column(String, default="")
    receipt_policy_root = Column(String, default="")

    deployment_policy_root = Column(String, default="")
    deployment_registry_root = Column(String, default="")
    deployment_lease_root = Column(String, default="")
    mpp_gateway_policy_root = Column(String, default="")
    provider_adapter_policy_root = Column(String, default="")

    install_ring_policy_root = Column(String, default="")
    upgrade_policy_root = Column(String, default="")
    rollback_policy_root = Column(String, default="")

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
