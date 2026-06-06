"""Test harness patch risk classification and forbidden mutations."""
import pytest
from app.services.graders import harness_patch_risk_grader, forbidden_mutation_grader
from app.models.enums import HarnessPatchRisk


def test_prompt_patch_classified_low():
    patch = {"patch_type": ["prompt_patch"], "changed_fields": ["instructions.system"]}
    assert harness_patch_risk_grader(patch) == HarnessPatchRisk.LOW


def test_model_route_patch_classified_medium():
    patch = {"patch_type": ["model_route_patch"], "changed_fields": ["model_routing.primary"]}
    assert harness_patch_risk_grader(patch) == HarnessPatchRisk.MEDIUM


def test_orchestration_patch_classified_high():
    patch = {"patch_type": ["loop_policy_patch"], "changed_fields": ["orchestration.loop_config"]}
    assert harness_patch_risk_grader(patch) == HarnessPatchRisk.HIGH


def test_spend_policy_patch_classified_constitutional():
    patch = {"patch_type": ["spend_policy_patch"], "changed_fields": ["spend_policy.max_daily"]}
    assert harness_patch_risk_grader(patch) == HarnessPatchRisk.CONSTITUTIONAL


def test_constitutional_patch_cannot_auto_promote():
    from httpx import ASGITransport, AsyncClient
    import asyncio

    async def _test():
        import os
        os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///./data/test_harness.db"
        from app.main import app
        from app.db import init_db, engine, Base

        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            # Create harness
            await client.post("/v1/harnesses", json={
                "name": "Test", "version": "1.0.0", "agent_class": "test",
            })
            harnesses = (await client.get("/v1/harnesses")).json()
            harness_id = harnesses[0]["id"]

            # Create CONSTITUTIONAL patch
            resp = await client.post("/v1/harness-patches", json={
                "target_harness_id": harness_id,
                "target_version": "1.0.0",
                "patch_type": ["spend_policy_patch"],
                "changed_fields": ["spend_policy.max_daily"],
            })
            patch_id = resp.json()["id"]

            # Classify
            await client.post(f"/v1/harness-patches/{patch_id}/classify-risk")

            # Try promote
            resp = await client.post(f"/v1/harness-patches/{patch_id}/promote")
            assert resp.json()["status"] == "blocked"

        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)

    asyncio.run(_test())


def test_forbidden_mutation_rejected():
    patch = {"patch_payload": {"action": "disable_tracing"}}
    valid, reason = forbidden_mutation_grader(patch)
    assert not valid
    assert "disable_tracing" in reason
