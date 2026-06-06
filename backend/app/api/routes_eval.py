from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
import uuid

from app.db import get_db
from app.models.eval import Rubric, Worldlet, EvalRun, EvalAttestation
from app.models.deploy import DeploymentCapsule
from app.services.eval_runner import run_eval, run_comparative_eval, issue_attestation
from app.services.rubric_generator import generate_rubric_from_traces, generate_worldlets_from_traces

router = APIRouter(prefix="/v1/eval", tags=["eval"])


class RubricCreate(BaseModel):
    name: str
    capability_class: str
    version: str = "1.0.0"
    dimensions: list[dict] = []
    hard_gates: list[str] = []
    visibility: str = "public"


class WorldletCreate(BaseModel):
    name: str
    capability_class: str
    visibility: str = "public"
    initial_state: dict = {}
    observations: list[dict] = []
    expected_behavior: dict = {}
    graders: list[str] = []


class EvalRunCreate(BaseModel):
    target_type: str
    target_id: str
    rubric_id: str
    dataset_refs: list[str] = []


class ComparativeEvalCreate(BaseModel):
    baseline_id: str
    candidate_id: str
    project_id: str
    capability_class: str = "release_monitoring"
    rubric_id: str | None = None
    target_type: str = "capability_capsule"


@router.post("/rubrics")
async def create_rubric(data: RubricCreate, db: AsyncSession = Depends(get_db)):
    rubric = Rubric(
        id=f"rubric_{uuid.uuid4().hex[:12]}",
        name=data.name,
        capability_class=data.capability_class,
        version=data.version,
        dimensions=data.dimensions,
        hard_gates=data.hard_gates,
        visibility=data.visibility,
    )
    db.add(rubric)
    await db.commit()
    return {"id": rubric.id, "name": rubric.name}


@router.get("/rubrics")
async def list_rubrics(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Rubric))
    return [{"id": r.id, "name": r.name, "capability_class": r.capability_class} for r in result.scalars().all()]


@router.get("/rubrics/{rubric_id}")
async def get_rubric(rubric_id: str, db: AsyncSession = Depends(get_db)):
    rubric = await db.get(Rubric, rubric_id)
    if not rubric:
        raise HTTPException(status_code=404, detail="Rubric not found")
    return rubric


@router.post("/worldlets")
async def create_worldlet(data: WorldletCreate, db: AsyncSession = Depends(get_db)):
    worldlet = Worldlet(
        id=f"worldlet_{uuid.uuid4().hex[:12]}",
        name=data.name,
        capability_class=data.capability_class,
        visibility=data.visibility,
        initial_state=data.initial_state,
        observations=data.observations,
        expected_behavior=data.expected_behavior,
        graders=data.graders,
    )
    db.add(worldlet)
    await db.commit()
    return {"id": worldlet.id, "name": worldlet.name}


@router.get("/worldlets")
async def list_worldlets(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Worldlet))
    worldlets = result.scalars().all()
    # Hide private holdout content
    items = []
    for w in worldlets:
        item = {"id": w.id, "name": w.name, "capability_class": w.capability_class, "visibility": w.visibility}
        if w.visibility != "private_holdout":
            item["initial_state"] = w.initial_state
            item["observations"] = w.observations
            item["expected_behavior"] = w.expected_behavior
        else:
            item["initial_state"] = "[HIDDEN]"
            item["observations"] = "[HIDDEN]"
            item["expected_behavior"] = "[HIDDEN]"
        items.append(item)
    return items


@router.get("/worldlets/{worldlet_id}")
async def get_worldlet(worldlet_id: str, db: AsyncSession = Depends(get_db)):
    worldlet = await db.get(Worldlet, worldlet_id)
    if not worldlet:
        raise HTTPException(status_code=404, detail="Worldlet not found")
    if worldlet.visibility == "private_holdout":
        return {
            "id": worldlet.id,
            "name": worldlet.name,
            "visibility": "private_holdout",
            "detail": "Content hidden - private holdout",
        }
    return worldlet


@router.post("/runs")
async def create_eval_run(data: EvalRunCreate, db: AsyncSession = Depends(get_db)):
    eval_run = await run_eval(db, data.target_type, data.target_id, data.rubric_id, data.dataset_refs)
    return {"id": eval_run.id, "status": eval_run.status, "score_vector": eval_run.score_vector}


@router.post("/compare")
async def create_comparative_eval(data: ComparativeEvalCreate, db: AsyncSession = Depends(get_db)):
    """Run a comparative evaluation: baseline vs candidate.

    If no rubric_id is provided, auto-generates one from production traces.
    Both agents are simulated against worldlets and scored on each rubric dimension.
    """
    rubric_auto_generated = False

    if data.rubric_id:
        rubric_id = data.rubric_id
    else:
        # Auto-generate rubric from production traces
        rubric = await generate_rubric_from_traces(db, data.project_id, data.capability_class)
        rubric_id = rubric.id
        rubric_auto_generated = True

        # Auto-generate worldlets from traces
        await generate_worldlets_from_traces(db, data.project_id, data.capability_class)

    eval_run = await run_comparative_eval(
        db,
        baseline_id=data.baseline_id,
        candidate_id=data.candidate_id,
        rubric_id=rubric_id,
        target_type=data.target_type,
        rubric_auto_generated=rubric_auto_generated,
    )

    return {
        "id": eval_run.id,
        "eval_mode": eval_run.eval_mode,
        "status": eval_run.status,
        "baseline_id": eval_run.baseline_id,
        "candidate_id": eval_run.target_id,
        "baseline_scores": eval_run.baseline_scores,
        "candidate_scores": eval_run.candidate_scores,
        "score_delta": eval_run.score_delta,
        "winner": eval_run.winner,
        "recommendation": eval_run.recommendation,
        "rubric_id": eval_run.rubric_id,
        "rubric_auto_generated": eval_run.rubric_auto_generated,
        "public_summary": eval_run.public_summary,
    }


@router.get("/runs")
async def list_eval_runs(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(EvalRun))
    runs = result.scalars().all()
    items = []
    for r in runs:
        item = {
            "id": r.id,
            "target_id": r.target_id,
            "status": r.status,
            "eval_mode": r.eval_mode or "single",
        }
        if r.eval_mode == "comparative":
            item["baseline_id"] = r.baseline_id
            item["baseline_scores"] = r.baseline_scores
            item["candidate_scores"] = r.candidate_scores
            item["score_delta"] = r.score_delta
            item["winner"] = r.winner
            item["recommendation"] = r.recommendation
            item["rubric_auto_generated"] = r.rubric_auto_generated
        items.append(item)
    return items


@router.get("/runs/{run_id}")
async def get_eval_run(run_id: str, db: AsyncSession = Depends(get_db)):
    run = await db.get(EvalRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Eval run not found")
    return run


@router.post("/runs/{run_id}/issue-attestation")
async def issue_attestation_endpoint(run_id: str, db: AsyncSession = Depends(get_db)):
    attestation = await issue_attestation(db, run_id)
    if not attestation:
        raise HTTPException(status_code=400, detail="Cannot issue attestation - eval not passed or hard gate failed")
    return {"id": attestation.id, "target_id": attestation.target_id}


@router.post("/runs/{run_id}/deploy-candidate")
async def deploy_candidate(run_id: str, db: AsyncSession = Depends(get_db)):
    """Deploy the winning candidate from a comparative eval run."""
    eval_run = await db.get(EvalRun, run_id)
    if not eval_run:
        raise HTTPException(status_code=404, detail="Eval run not found")

    if eval_run.eval_mode != "comparative":
        raise HTTPException(status_code=400, detail="Not a comparative eval run")

    if eval_run.winner != "candidate":
        raise HTTPException(
            status_code=400,
            detail=f"Cannot deploy: winner is '{eval_run.winner}', not 'candidate'",
        )

    # Find existing deployment capsule for the candidate
    result = await db.execute(
        select(DeploymentCapsule).where(DeploymentCapsule.id == eval_run.target_id)
    )
    capsule = result.scalars().first()

    if capsule:
        capsule.lifecycle = "canary"
        await db.commit()
        return {
            "deployed": True,
            "capsule_id": capsule.id,
            "lifecycle": "canary",
            "message": f"Candidate {eval_run.target_id} promoted to canary",
        }

    # If no deployment capsule exists, just record the promotion intent
    return {
        "deployed": True,
        "candidate_id": eval_run.target_id,
        "message": f"Candidate {eval_run.target_id} approved for deployment",
        "recommendation": eval_run.recommendation,
    }


@router.get("/attestations")
async def list_attestations(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(EvalAttestation))
    return [{"id": a.id, "target_id": a.target_id, "canary_status": a.canary_status} for a in result.scalars().all()]


@router.get("/attestations/{attestation_id}")
async def get_attestation(attestation_id: str, db: AsyncSession = Depends(get_db)):
    att = await db.get(EvalAttestation, attestation_id)
    if not att:
        raise HTTPException(status_code=404, detail="Attestation not found")
    return att
