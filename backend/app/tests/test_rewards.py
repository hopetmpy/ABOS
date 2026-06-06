"""Test reward routing and usage attestations."""
import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_failed_hard_gates_pays_zero(client: AsyncClient):
    # Create attestation with hard gate failure
    resp = await client.post("/v1/rewards/usage-attestations", json={
        "project_id": "proj_rew",
        "capability_id": "cap_test",
        "install_ring": "R2_READ",
        "hard_gates_pass": False,
        "royalty_due": 1.0,
    })
    att_id = resp.json()["id"]

    # Try to route rewards - should get empty
    resp = await client.post("/v1/rewards/route", json={
        "usage_attestation_id": att_id,
        "reward_manifest": {"contributors": {"alice": 50, "bob": 50}},
        "total_amount": 1.0,
    })
    assert resp.status_code == 200
    assert resp.json() == []  # No rewards when hard gates fail


@pytest.mark.asyncio
async def test_passed_usage_routes_rewards(client: AsyncClient):
    resp = await client.post("/v1/rewards/usage-attestations", json={
        "project_id": "proj_rew2",
        "capability_id": "cap_test2",
        "install_ring": "R2_READ",
        "hard_gates_pass": True,
        "royalty_due": 1.0,
    })
    att_id = resp.json()["id"]

    resp = await client.post("/v1/rewards/route", json={
        "usage_attestation_id": att_id,
        "reward_manifest": {"contributors": {"alice": 60, "bob": 40}},
        "total_amount": 1.0,
    })
    assert resp.status_code == 200
    entries = resp.json()
    assert len(entries) == 2


@pytest.mark.asyncio
async def test_reward_split_follows_manifest(client: AsyncClient):
    resp = await client.post("/v1/rewards/usage-attestations", json={
        "project_id": "proj_rew3",
        "capability_id": "cap_test3",
        "install_ring": "R2_READ",
        "hard_gates_pass": True,
        "royalty_due": 10.0,
    })
    att_id = resp.json()["id"]

    resp = await client.post("/v1/rewards/route", json={
        "usage_attestation_id": att_id,
        "reward_manifest": {"contributors": {"alice": 70, "bob": 30}},
        "total_amount": 10.0,
    })
    entries = resp.json()
    alice = next(e for e in entries if e["recipient_id"] == "alice")
    bob = next(e for e in entries if e["recipient_id"] == "bob")
    # 20% immediate: alice gets 70/100 * 10.0 * 0.2 = 1.4
    assert abs(alice["amount"] - 1.4) < 0.01
    assert abs(bob["amount"] - 0.6) < 0.01
