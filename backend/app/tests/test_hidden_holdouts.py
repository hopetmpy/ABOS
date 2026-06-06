"""Test that hidden holdout contents are not exposed."""
import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_private_worldlet_content_hidden_in_public_api(client: AsyncClient):
    # Create a private holdout worldlet
    await client.post("/v1/eval/worldlets", json={
        "name": "Hidden Test",
        "capability_class": "test",
        "visibility": "private_holdout",
        "initial_state": {"secret_test_data": "should_not_be_visible"},
        "observations": [{"type": "secret_observation"}],
        "expected_behavior": {"secret_expected": True},
    })
    resp = await client.get("/v1/eval/worldlets")
    assert resp.status_code == 200
    worldlets = resp.json()
    for w in worldlets:
        if w["visibility"] == "private_holdout":
            assert w["initial_state"] == "[HIDDEN]"
            assert w["observations"] == "[HIDDEN]"
            assert w["expected_behavior"] == "[HIDDEN]"


@pytest.mark.asyncio
async def test_private_worldlet_detail_hidden(client: AsyncClient):
    resp = await client.post("/v1/eval/worldlets", json={
        "name": "Hidden Detail",
        "capability_class": "test",
        "visibility": "private_holdout",
        "initial_state": {"secret": "value"},
    })
    worldlet_id = resp.json()["id"]
    detail_resp = await client.get(f"/v1/eval/worldlets/{worldlet_id}")
    assert detail_resp.status_code == 200
    data = detail_resp.json()
    assert "secret" not in str(data.get("initial_state", ""))


@pytest.mark.asyncio
async def test_eval_public_summary_shows_pass_fail_only(client: AsyncClient):
    # Create rubric
    await client.post("/v1/eval/rubrics", json={
        "name": "TestBench", "capability_class": "test",
    })
    rubrics = (await client.get("/v1/eval/rubrics")).json()
    rubric_id = rubrics[0]["id"]

    # Create holdout
    await client.post("/v1/eval/worldlets", json={
        "name": "Holdout", "capability_class": "test", "visibility": "private_holdout",
    })

    # Run eval
    resp = await client.post("/v1/eval/runs", json={
        "target_type": "capsule", "target_id": "test_cap", "rubric_id": rubric_id,
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "PASSED"
