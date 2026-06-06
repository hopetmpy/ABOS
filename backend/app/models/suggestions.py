from sqlalchemy import Column, String, Float, JSON, DateTime
from datetime import datetime, timezone

from app.db import Base


class CandidateSuggestion(Base):
    __tablename__ = "candidate_suggestions"

    id = Column(String, primary_key=True)
    project_id = Column(String, nullable=False)
    agent_id = Column(String, nullable=True)

    candidate_type = Column(String, nullable=False)
    target_object_type = Column(String, nullable=False)
    target_object_id = Column(String, nullable=False)

    title = Column(String, nullable=False)
    explanation = Column(String, default="")

    expected_benefit = Column(JSON, default=dict)
    expected_cost = Column(JSON, default=dict)
    risk_summary = Column(JSON, default=dict)
    permission_diff = Column(JSON, default=dict)

    feasibility = Column(JSON, default=dict)
    score_vector_delta = Column(JSON, default=dict)
    candidate_efficiency = Column(Float, default=0.0)

    recommended_decision = Column(String, default="ASK_HUMAN")
    status = Column(String, default="open")

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
