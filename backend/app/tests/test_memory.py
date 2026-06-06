"""Test memory system with privacy controls."""
import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_user_secret_memory_cannot_publish_to_forge(client: AsyncClient):
    resp = await client.post("/v1/memory", json={
        "project_id": "proj_mem",
        "memory_type": "episodic",
        "statement": "User shared a private API key pattern.",
        "privacy_label": "user_secret",
        "egress_policy": {
            "can_use_in_context": True,
            "can_show_user": False,
            "can_publish_to_forge": False,
            "can_send_to_remote_model": False,
        },
    })
    assert resp.status_code == 200

    # Memory list should exclude non-visible items
    resp = await client.get("/v1/memory?project_id=proj_mem")
    items = resp.json()
    for item in items:
        assert item.get("privacy_label") != "user_secret" or "can_publish_to_forge" not in str(item)


@pytest.mark.asyncio
async def test_context_compiler_excludes_disallowed(client: AsyncClient):
    await client.post("/v1/projects", json={
        "id": "proj_ctx", "name": "Context", "mission": "Test context compilation",
        "treasury_balance": 50.0,
    })
    # Create a memory that cannot be sent to remote model
    await client.post("/v1/memory", json={
        "project_id": "proj_ctx",
        "memory_type": "semantic",
        "statement": "Secret internal strategy",
        "egress_policy": {
            "can_use_in_context": True,
            "can_show_user": True,
            "can_publish_to_forge": False,
            "can_send_to_remote_model": False,
        },
    })

    # Compile for remote_model target
    resp = await client.post("/v1/memory/compile-context", json={
        "project_id": "proj_ctx",
        "target": "remote_model",
    })
    assert resp.status_code == 200
    ctx = resp.json()
    # The secret memory should be excluded from remote_model context
    for mem in ctx.get("relevant_memories", []):
        assert mem["statement"] != "Secret internal strategy"


@pytest.mark.asyncio
async def test_distillation_creates_memory(client: AsyncClient):
    await client.post("/v1/projects", json={
        "id": "proj_distill", "name": "Distill", "mission": "Test",
        "treasury_balance": 50.0,
    })
    resp = await client.post("/v1/memory/distill", json={
        "project_id": "proj_distill",
        "agent_id": "agent_1",
        "statement": "Deploy canary generated first payment.",
        "source_refs": ["receipt_123"],
        "memory_type": "episodic",
    })
    assert resp.status_code == 200
    assert "Deploy canary" in resp.json()["statement"]
