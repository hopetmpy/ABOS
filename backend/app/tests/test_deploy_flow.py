"""Test deployment flow: capsule -> lease -> preview -> canary -> rollback."""
import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_deployment_flow(client: AsyncClient):
    # Create project
    await client.post("/v1/projects", json={
        "id": "proj_deploy", "name": "Deploy Test", "mission": "Test deploy",
        "treasury_balance": 100.0,
    })

    # Create deployment capsule
    resp = await client.post("/v1/deploy/capsules", json={
        "project_id": "proj_deploy",
        "agent_id": "agent_test",
        "name": "Test API",
        "budget": {"max_daily_infra_cost": 2.0, "max_preview_cost": 0.10},
        "monetization": {
            "routes": {"/api/test": {"price": 0.01}},
            "idempotency_key_policy": "required",
        },
        "rollback": {"required": True},
    })
    assert resp.status_code == 200
    capsule_id = resp.json()["id"]

    # Create lease
    resp = await client.post(f"/v1/deploy/leases?project_id=proj_deploy&agent_id=agent_test&capsule_id={capsule_id}")
    assert resp.status_code == 200
    lease_id = resp.json()["id"]

    # Deploy preview
    resp = await client.post(f"/v1/deploy/{capsule_id}/preview?lease_id={lease_id}")
    assert resp.status_code == 200
    assert "preview_url" in resp.json()

    # Canary
    resp = await client.post(f"/v1/deploy/{capsule_id}/canary")
    assert resp.status_code == 200
    assert resp.json()["lifecycle"] == "canary"

    # Rollback
    resp = await client.post(f"/v1/deploy/{capsule_id}/rollback")
    assert resp.status_code == 200
    assert resp.json()["lifecycle"] == "rolled_back"


@pytest.mark.asyncio
async def test_cost_estimate_created(client: AsyncClient):
    await client.post("/v1/projects", json={
        "id": "proj_cost", "name": "Cost", "mission": "Test",
    })
    resp = await client.post("/v1/deploy/capsules", json={
        "project_id": "proj_cost",
        "agent_id": "agent_test",
        "name": "Cost Test",
        "budget": {"max_daily_infra_cost": 2.0},
    })
    capsule_id = resp.json()["id"]

    resp = await client.post(f"/v1/deploy/{capsule_id}/estimate")
    assert resp.status_code == 200
    estimate = resp.json()
    assert estimate["preview_cost"] == 0.10
    assert estimate["daily_infra"] == 1.00


@pytest.mark.asyncio
async def test_red_mode_blocks_deploy(client: AsyncClient):
    await client.post("/v1/projects", json={
        "id": "proj_red_deploy", "name": "Red", "mission": "Test",
        "treasury_balance": 5.0, "survival_reserve": 10.0, "storage_runway_days": 3,
    })
    resp = await client.post("/v1/deploy/capsules", json={
        "project_id": "proj_red_deploy", "agent_id": "a", "name": "Test",
        "budget": {"max_daily_infra_cost": 2.0},
    })
    capsule_id = resp.json()["id"]

    # Try canary in RED mode project
    resp = await client.post(f"/v1/deploy/{capsule_id}/canary")
    assert resp.status_code == 403
