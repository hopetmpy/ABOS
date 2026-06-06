from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.db import get_db
from app.models.suggestions import CandidateSuggestion
from app.services.suggestion_engine import generate_suggestions

router = APIRouter(prefix="/v1/suggestions", tags=["suggestions"])


@router.post("/generate/{project_id}")
async def generate(project_id: str, db: AsyncSession = Depends(get_db)):
    suggestions = await generate_suggestions(db, project_id)
    return [
        {
            "id": s.id,
            "title": s.title,
            "candidate_type": s.candidate_type,
            "recommended_decision": s.recommended_decision,
            "candidate_efficiency": s.candidate_efficiency,
        }
        for s in suggestions
    ]


@router.get("/{project_id}")
async def list_suggestions(project_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(CandidateSuggestion).where(CandidateSuggestion.project_id == project_id)
    )
    suggestions = result.scalars().all()
    return [
        {
            "id": s.id,
            "title": s.title,
            "candidate_type": s.candidate_type,
            "recommended_decision": s.recommended_decision,
            "expected_benefit": s.expected_benefit,
            "expected_cost": s.expected_cost,
            "risk_summary": s.risk_summary,
            "permission_diff": s.permission_diff,
            "candidate_efficiency": s.candidate_efficiency,
            "status": s.status,
        }
        for s in suggestions
    ]


@router.post("/{suggestion_id}/accept")
async def accept_suggestion(suggestion_id: str, db: AsyncSession = Depends(get_db)):
    suggestion = await db.get(CandidateSuggestion, suggestion_id)
    if not suggestion:
        raise HTTPException(status_code=404, detail="Suggestion not found")
    suggestion.status = "accepted"
    await db.commit()
    return {"id": suggestion.id, "status": "accepted"}


@router.post("/{suggestion_id}/reject")
async def reject_suggestion(suggestion_id: str, db: AsyncSession = Depends(get_db)):
    suggestion = await db.get(CandidateSuggestion, suggestion_id)
    if not suggestion:
        raise HTTPException(status_code=404, detail="Suggestion not found")
    suggestion.status = "rejected"
    await db.commit()
    return {"id": suggestion.id, "status": "rejected"}
