import uuid
import math
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.suggestions import CandidateSuggestion
from app.models.projects import Project
from app.models.forge import CapabilityCapsule
from app.models.harness import HarnessPatch
from app.models.deploy import DeploymentCapsule
from app.models.enums import ProjectMode, InstallRing
from app.services.budget_governor import compute_project_mode


# Weights for utility calculation
WEIGHTS = {
    "beta_cash": 0.1,
    "beta_budget": 0.05,
    "lambda_cost": 2.0,
    "lambda_risk": 1.5,
    "lambda_privacy": 3.0,
    "lambda_complexity": 0.5,
}
EPS = 0.01


def rank_candidate(
    expected_value: float,
    cost: float,
    risk: float,
    privacy_risk: float,
    cash_after: float,
    complexity: float = 0.0,
) -> float:
    utility = (
        expected_value
        + WEIGHTS["beta_cash"] * math.log(max(cash_after, 0) + EPS)
        - WEIGHTS["lambda_cost"] * cost
        - WEIGHTS["lambda_risk"] * risk
        - WEIGHTS["lambda_privacy"] * privacy_risk
        - WEIGHTS["lambda_complexity"] * complexity
    )
    total_cost = max(cost, EPS)
    return utility / total_cost


async def generate_suggestions(db: AsyncSession, project_id: str) -> list[CandidateSuggestion]:
    project = await db.get(Project, project_id)
    if not project:
        return []

    mode = compute_project_mode(project)
    suggestions = []

    # Find published capsules that could be upgraded
    result = await db.execute(
        select(CapabilityCapsule).where(CapabilityCapsule.lifecycle == "PUBLISHED")
    )
    capsules = result.scalars().all()

    for capsule in capsules:
        efficiency = rank_candidate(
            expected_value=0.15,
            cost=0.03,
            risk=0.1,
            privacy_risk=0.0,
            cash_after=project.treasury_balance - 0.03,
        )

        ring = capsule.install_ring or "R0_KNOW"
        decision = "AUTO_INSTALL"
        if ring in ("R3_WRITE", "R4_SPEND"):
            decision = "CANARY"
        if ring == "R5_GOVERN":
            decision = "BLOCKED"
        if mode == ProjectMode.RED and ring not in ("R0_KNOW", "R1_THINK"):
            decision = "BLOCKED"

        suggestion = CandidateSuggestion(
            id=f"suggestion_{uuid.uuid4().hex[:12]}",
            project_id=project_id,
            candidate_type="capability_upgrade",
            target_object_type="capability_capsule",
            target_object_id=capsule.id,
            title=f"Upgrade {capsule.name} to v{capsule.version}",
            explanation=f"Improves {capsule.name} capabilities. Eval required: {capsule.required_evals}",
            expected_benefit={"reliability_lift": "12-18%"},
            expected_cost={"eval_credits": 0.03, "install_credits": 0.0},
            risk_summary={"level": "low", "rollback": capsule.rollback},
            permission_diff=capsule.permissions or {},
            feasibility={"budget_ok": True, "mode_ok": mode != ProjectMode.RED},
            score_vector_delta={"task_success": 0.05, "tool_correctness": 0.08},
            candidate_efficiency=efficiency,
            recommended_decision=decision,
            status="open",
        )
        suggestions.append(suggestion)

    # Find deployment capsules
    result = await db.execute(
        select(DeploymentCapsule).where(DeploymentCapsule.lifecycle == "draft")
    )
    deploy_capsules = result.scalars().all()

    for dc in deploy_capsules:
        efficiency = rank_candidate(
            expected_value=5.0,
            cost=0.50,
            risk=0.3,
            privacy_risk=0.0,
            cash_after=project.treasury_balance - 0.50,
        )

        suggestion = CandidateSuggestion(
            id=f"suggestion_{uuid.uuid4().hex[:12]}",
            project_id=project_id,
            candidate_type="deployment_plan",
            target_object_type="deployment_capsule",
            target_object_id=dc.id,
            title=f"Deploy {dc.name}",
            explanation=f"Expected revenue from {dc.name}. Budget cap: {dc.budget}",
            expected_benefit={"weekly_revenue": "$3-12"},
            expected_cost={"max_daily": dc.budget.get("max_daily_infra_cost", 2.0) if dc.budget else 2.0},
            risk_summary={"level": "medium", "rollback": dc.rollback},
            permission_diff=dc.permissions or {},
            feasibility={"budget_ok": True, "mode_ok": mode == ProjectMode.GREEN},
            score_vector_delta={"economic_value": 0.15, "deployment_reliability": 0.10},
            candidate_efficiency=efficiency,
            recommended_decision="CANARY" if mode == ProjectMode.GREEN else "BLOCKED",
            status="open",
        )
        suggestions.append(suggestion)

    # Sort by efficiency
    suggestions.sort(key=lambda s: s.candidate_efficiency, reverse=True)

    # Save to DB
    for s in suggestions:
        db.add(s)
    await db.commit()

    return suggestions
