from sqlalchemy import Column, String, JSON, DateTime
from datetime import datetime, timezone

from app.db import Base


class Rubric(Base):
    __tablename__ = "rubrics"

    id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    capability_class = Column(String, nullable=False)
    version = Column(String, default="1.0.0")

    dimensions = Column(JSON, default=list)
    hard_gates = Column(JSON, default=list)
    visibility = Column(String, default="public")

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class Worldlet(Base):
    __tablename__ = "worldlets"

    id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    capability_class = Column(String, nullable=False)
    visibility = Column(String, default="public")

    initial_state = Column(JSON, default=dict)
    observations = Column(JSON, default=list)
    expected_behavior = Column(JSON, default=dict)
    graders = Column(JSON, default=list)

    source_receipt_commitments = Column(JSON, default=list)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class EvalRun(Base):
    __tablename__ = "eval_runs"

    id = Column(String, primary_key=True)
    target_type = Column(String, nullable=False)
    target_id = Column(String, nullable=False)
    rubric_id = Column(String, nullable=False)
    dataset_refs = Column(JSON, default=list)

    status = Column(String, default="PENDING")
    score_vector = Column(JSON, nullable=True)
    hard_gate_results = Column(JSON, nullable=True)
    hidden_holdout_result = Column(String, default="not_run")

    # Comparative eval fields
    eval_mode = Column(String, default="single")  # "single" or "comparative"
    baseline_id = Column(String, nullable=True)
    baseline_scores = Column(JSON, nullable=True)
    candidate_scores = Column(JSON, nullable=True)
    rubric_auto_generated = Column(String, default="false")  # "true" if auto-generated
    winner = Column(String, nullable=True)  # "baseline", "candidate", or "tie"
    score_delta = Column(JSON, nullable=True)  # per-dimension deltas
    recommendation = Column(String, nullable=True)  # "deploy_candidate", "keep_baseline", "needs_review"

    cost_summary = Column(JSON, default=dict)
    public_summary = Column(JSON, default=dict)
    private_notes_vault_uri = Column(String, nullable=True)

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    completed_at = Column(DateTime, nullable=True)


class EvalAttestation(Base):
    __tablename__ = "eval_attestations"

    id = Column(String, primary_key=True)
    target_type = Column(String, nullable=False)
    target_id = Column(String, nullable=False)
    eval_run_id = Column(String, nullable=False)

    install_rings_allowed = Column(JSON, default=list)
    hard_gates = Column(JSON, default=dict)
    score_vector = Column(JSON, default=dict)

    canary_status = Column(String, default="none")
    expires_at = Column(DateTime, nullable=True)
    public_claim = Column(JSON, default=dict)
    signature_mock = Column(String, default="")

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
