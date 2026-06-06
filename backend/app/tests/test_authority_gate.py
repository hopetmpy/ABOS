"""Test install ring authority gate."""
import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_r0_allowed(client: AsyncClient):
    resp = await client.post("/v1/authority/authorize-action", json={
        "install_ring": "R0_KNOW", "project_mode": "GREEN",
    })
    assert resp.json()["authorized"] is True


@pytest.mark.asyncio
async def test_r1_allowed_with_eval_and_rollback(client: AsyncClient):
    resp = await client.post("/v1/authority/authorize-action", json={
        "install_ring": "R1_THINK", "project_mode": "GREEN",
        "has_eval_attestation": True, "has_rollback": True,
    })
    assert resp.json()["authorized"] is True


@pytest.mark.asyncio
async def test_r2_blocked_if_external_write(client: AsyncClient):
    resp = await client.post("/v1/authority/authorize-action", json={
        "install_ring": "R2_READ", "project_mode": "GREEN",
        "has_eval_attestation": True,
        "new_permissions": {"external_write": True},
    })
    assert resp.json()["authorized"] is False


@pytest.mark.asyncio
async def test_r3_requires_eval_canary_rollback(client: AsyncClient):
    # Missing canary
    resp = await client.post("/v1/authority/authorize-action", json={
        "install_ring": "R3_WRITE", "project_mode": "GREEN",
        "has_eval_attestation": True, "has_rollback": True,
        "has_canary_or_approval": False,
    })
    assert resp.json()["authorized"] is False

    # With canary
    resp = await client.post("/v1/authority/authorize-action", json={
        "install_ring": "R3_WRITE", "project_mode": "GREEN",
        "has_eval_attestation": True, "has_rollback": True,
        "has_canary_or_approval": True,
    })
    assert resp.json()["authorized"] is True


@pytest.mark.asyncio
async def test_r4_requires_passport_approval(client: AsyncClient):
    resp = await client.post("/v1/authority/authorize-action", json={
        "install_ring": "R4_SPEND", "project_mode": "GREEN",
        "has_passport": True, "has_canary_or_approval": True,
    })
    assert resp.json()["authorized"] is True

    resp = await client.post("/v1/authority/authorize-action", json={
        "install_ring": "R4_SPEND", "project_mode": "GREEN",
    })
    assert resp.json()["authorized"] is False


@pytest.mark.asyncio
async def test_r5_blocked_without_governance(client: AsyncClient):
    resp = await client.post("/v1/authority/authorize-action", json={
        "install_ring": "R5_GOVERN", "project_mode": "GREEN",
        "has_governance_approval": False,
    })
    assert resp.json()["authorized"] is False

    resp = await client.post("/v1/authority/authorize-action", json={
        "install_ring": "R5_GOVERN", "project_mode": "GREEN",
        "has_governance_approval": True,
    })
    assert resp.json()["authorized"] is True
