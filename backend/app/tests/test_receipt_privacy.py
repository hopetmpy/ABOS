"""Test that raw receipts are private by default."""
import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_raw_receipt_stored_in_vault(client: AsyncClient):
    resp = await client.post("/v1/receipts/autonomy", json={
        "project_id": "test_project",
        "agent_id": "test_agent",
        "capability_class": "test",
        "raw_data": {"full_trace": "sensitive", "prompts": ["secret_prompt"]},
        "public_summary": {"action": "test_action", "outcome": "success"},
    })
    assert resp.status_code == 200
    data = resp.json()
    assert "commitment_hash" in data
    assert len(data["commitment_hash"]) == 64  # SHA256


@pytest.mark.asyncio
async def test_public_receipt_list_excludes_raw_payload(client: AsyncClient):
    await client.post("/v1/receipts/autonomy", json={
        "project_id": "test_project",
        "agent_id": "test_agent",
        "raw_data": {"private": "data"},
        "public_summary": {"summary": "ok"},
    })
    resp = await client.get("/v1/receipts/autonomy")
    assert resp.status_code == 200
    receipts = resp.json()
    for r in receipts:
        assert "raw_data" not in r
        assert "vault_uri" not in r


@pytest.mark.asyncio
async def test_public_receipt_detail_excludes_raw_payload(client: AsyncClient):
    create_resp = await client.post("/v1/receipts/autonomy", json={
        "project_id": "test_project",
        "agent_id": "test_agent",
        "raw_data": {"secret": "value"},
        "public_summary": {"visible": True},
    })
    receipt_id = create_resp.json()["id"]
    resp = await client.get(f"/v1/receipts/autonomy/{receipt_id}")
    assert resp.status_code == 200
    data = resp.json()
    assert "raw_data" not in data
    assert "vault_uri" not in data
    assert "commitment_hash" in data


@pytest.mark.asyncio
async def test_commitment_is_deterministic(client: AsyncClient):
    payload = {"test": "data", "number": 42}
    resp1 = await client.post("/v1/receipts/autonomy", json={
        "project_id": "p1", "agent_id": "a1", "raw_data": payload, "public_summary": {},
    })
    from app.services.hashing import commitment_for_json
    from app.services.canonical_json import canonical_json
    import hashlib
    expected = hashlib.sha256(canonical_json(payload)).hexdigest()
    assert resp1.json()["commitment_hash"] == expected
