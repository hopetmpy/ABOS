"""Test budget governor reserve/settle/release mechanics."""
import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_reservation_required_before_paid_action(client: AsyncClient):
    # Create project with enough budget
    await client.post("/v1/projects", json={
        "id": "proj1", "name": "Test", "mission": "Test", "treasury_balance": 100.0,
    })
    # Reserve budget
    resp = await client.post("/v1/budget/reserve", json={
        "project_id": "proj1", "category": "eval", "estimated_max_cost": 5.0, "reason": "test eval",
    })
    assert resp.status_code == 200
    assert resp.json()["approved"] is True


@pytest.mark.asyncio
async def test_insufficient_reserve_rejects(client: AsyncClient):
    # Create project with low balance
    await client.post("/v1/projects", json={
        "id": "proj_low", "name": "Low", "mission": "Test",
        "treasury_balance": 15.0, "survival_reserve": 10.0,
    })
    # Try to reserve more than available after survival reserve
    resp = await client.post("/v1/budget/reserve", json={
        "project_id": "proj_low", "category": "eval", "estimated_max_cost": 10.0, "reason": "too much",
    })
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_settlement_updates_ledger(client: AsyncClient):
    await client.post("/v1/projects", json={
        "id": "proj_settle", "name": "Settle", "mission": "Test", "treasury_balance": 100.0,
    })
    reserve_resp = await client.post("/v1/budget/reserve", json={
        "project_id": "proj_settle", "category": "eval", "estimated_max_cost": 5.0,
    })
    reservation_id = reserve_resp.json()["reservation_id"]

    settle_resp = await client.post("/v1/budget/settle", json={
        "reservation_id": reservation_id, "actual_cost": 3.0,
    })
    assert settle_resp.status_code == 200
    assert settle_resp.json()["settled_amount"] == 3.0


@pytest.mark.asyncio
async def test_release_restores_reserved_amount(client: AsyncClient):
    await client.post("/v1/projects", json={
        "id": "proj_release", "name": "Release", "mission": "Test", "treasury_balance": 100.0,
    })
    reserve_resp = await client.post("/v1/budget/reserve", json={
        "project_id": "proj_release", "category": "eval", "estimated_max_cost": 10.0,
    })
    reservation_id = reserve_resp.json()["reservation_id"]

    # Check balance went down
    budget = (await client.get("/v1/budget/project/proj_release")).json()
    assert budget["treasury_balance"] == 90.0

    # Release
    await client.post("/v1/budget/release", json={"reservation_id": reservation_id})

    # Check balance restored
    budget = (await client.get("/v1/budget/project/proj_release")).json()
    assert budget["treasury_balance"] == 100.0


@pytest.mark.asyncio
async def test_red_mode_blocks_speculative_actions(client: AsyncClient):
    # Create project with low resources (RED mode)
    await client.post("/v1/projects", json={
        "id": "proj_red", "name": "Red", "mission": "Test",
        "treasury_balance": 5.0, "survival_reserve": 10.0, "storage_runway_days": 5,
    })
    resp = await client.post("/v1/budget/reserve", json={
        "project_id": "proj_red", "category": "deploy", "estimated_max_cost": 2.0,
    })
    assert resp.status_code == 403
    assert "RED" in resp.json()["detail"]
