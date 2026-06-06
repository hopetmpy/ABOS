"""Tests for comparative evaluation: baseline vs candidate scoring."""
import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_comparative_eval_via_api(client: AsyncClient):
    """POST /v1/eval/compare auto-generates rubric and scores baseline vs candidate."""
    from app.seed.seed_data import seed
    await seed()

    # Create a production trace so the rubric generator has data
    from app.db import async_session
    from app.models.receipts import AutonomyReceipt
    from app.services.hashing import commitment_for_json

    async with async_session() as db:
        receipt = AutonomyReceipt(
            id="receipt_test_baseline",
            project_id="project_release_briefs",
            agent_id="agent_release_scout",
            harness_id="harness_release_scout_v1",
            capability_class="release_monitoring",
            visibility="PRIVATE_RAW",
            commitment_hash=commitment_for_json({"test": "trace"}, "test/v1"),
            public_summary={"action": "release_monitoring", "outcome": "ok"},
            cost_summary={"total": 0.05},
        )
        db.add(receipt)
        await db.commit()

    resp = await client.post("/v1/eval/compare", json={
        "baseline_id": "cap_release_watcher_v1",
        "candidate_id": "cap_test_candidate",
        "project_id": "project_release_briefs",
        "capability_class": "release_monitoring",
    })
    assert resp.status_code == 200
    data = resp.json()

    assert data["eval_mode"] == "comparative"
    assert data["baseline_id"] == "cap_release_watcher_v1"
    assert data["candidate_id"] == "cap_test_candidate"
    assert data["rubric_auto_generated"] == "true"
    assert data["winner"] in ("candidate", "baseline", "tie")
    assert data["recommendation"] in ("deploy_candidate", "keep_baseline", "needs_review")
    assert isinstance(data["baseline_scores"], dict)
    assert isinstance(data["candidate_scores"], dict)
    assert isinstance(data["score_delta"], dict)
    assert len(data["baseline_scores"]) >= 3


@pytest.mark.asyncio
async def test_comparative_eval_with_explicit_rubric(client: AsyncClient):
    """POST /v1/eval/compare with an explicit rubric_id skips auto-generation."""
    from app.seed.seed_data import seed
    await seed()

    resp = await client.post("/v1/eval/compare", json={
        "baseline_id": "cap_release_watcher_v1",
        "candidate_id": "cap_test_candidate_2",
        "project_id": "project_release_briefs",
        "capability_class": "release_monitoring",
        "rubric_id": "rubric_release_radar_v1",
    })
    assert resp.status_code == 200
    data = resp.json()

    assert data["eval_mode"] == "comparative"
    assert data["rubric_auto_generated"] == "false"
    assert data["rubric_id"] == "rubric_release_radar_v1"
    # The seed rubric has 3 dimensions
    assert len(data["baseline_scores"]) == 3
    assert len(data["candidate_scores"]) == 3


@pytest.mark.asyncio
async def test_comparative_eval_listed_in_runs(client: AsyncClient):
    """Comparative eval runs appear in GET /v1/eval/runs with comparison data."""
    from app.seed.seed_data import seed
    await seed()

    # Create a comparative eval
    await client.post("/v1/eval/compare", json={
        "baseline_id": "cap_release_watcher_v1",
        "candidate_id": "cap_list_test",
        "project_id": "project_release_briefs",
        "rubric_id": "rubric_release_radar_v1",
    })

    resp = await client.get("/v1/eval/runs")
    assert resp.status_code == 200
    runs = resp.json()

    comparative = [r for r in runs if r["eval_mode"] == "comparative"]
    assert len(comparative) >= 1

    run = comparative[0]
    assert "baseline_scores" in run
    assert "candidate_scores" in run
    assert "winner" in run
    assert "recommendation" in run


@pytest.mark.asyncio
async def test_deploy_candidate_succeeds(client: AsyncClient):
    """POST /v1/eval/runs/{id}/deploy-candidate deploys when candidate wins."""
    from app.seed.seed_data import seed
    await seed()

    # Create comparative eval
    compare_resp = await client.post("/v1/eval/compare", json={
        "baseline_id": "cap_release_watcher_v1",
        "candidate_id": "cap_deploy_test",
        "project_id": "project_release_briefs",
        "rubric_id": "rubric_release_radar_v1",
    })
    run_id = compare_resp.json()["id"]

    # Attempt deploy
    deploy_resp = await client.post(f"/v1/eval/runs/{run_id}/deploy-candidate")

    data = deploy_resp.json()
    if compare_resp.json()["winner"] == "candidate":
        assert deploy_resp.status_code == 200
        assert data["deployed"] is True
    else:
        assert deploy_resp.status_code == 400


@pytest.mark.asyncio
async def test_deploy_candidate_rejects_non_comparative(client: AsyncClient):
    """Deploy-candidate rejects single-mode eval runs."""
    from app.seed.seed_data import seed
    await seed()

    # Create a regular (non-comparative) eval
    run_resp = await client.post("/v1/eval/runs", json={
        "target_type": "capability_capsule",
        "target_id": "cap_release_watcher_v1",
        "rubric_id": "rubric_release_radar_v1",
    })
    run_id = run_resp.json()["id"]

    deploy_resp = await client.post(f"/v1/eval/runs/{run_id}/deploy-candidate")
    assert deploy_resp.status_code == 400
    assert "Not a comparative eval run" in deploy_resp.json()["detail"]
