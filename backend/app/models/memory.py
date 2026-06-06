from sqlalchemy import Column, String, Float, JSON, DateTime
from datetime import datetime, timezone

from app.db import Base


class MemoryItem(Base):
    __tablename__ = "memory_items"

    id = Column(String, primary_key=True)
    project_id = Column(String, nullable=False)
    agent_id = Column(String, nullable=True)

    memory_type = Column(String, nullable=False)
    statement = Column(String, nullable=False)
    summary = Column(String, nullable=True)

    source_refs = Column(JSON, default=list)
    confidence = Column(Float, default=0.5)
    importance = Column(Float, default=0.5)

    privacy_label = Column(String, default="project_private")
    egress_policy = Column(JSON, default=dict)
    ttl = Column(JSON, default=dict)
    embedding_stub = Column(JSON, nullable=True)

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
