"""End-to-end demo test."""
import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_demo_full_loop(client: AsyncClient):
    # First seed
    from app.seed.seed_data import seed
    await seed()

    # Run demo
    resp = await client.post("/v1/demo/run")
    assert resp.status_code == 200
    data = resp.json()

    assert "steps" in data
    assert "acceptance_snapshot" in data

    snapshot = data["acceptance_snapshot"]
    assert snapshot["demo_loop_completed"] is True
    assert snapshot["project_mode"] == "GREEN"
    assert snapshot["privacy_checks"]["raw_receipt_publicly_visible"] is False
    assert snapshot["privacy_checks"]["hidden_holdout_publicly_visible"] is False
    assert snapshot["budget_checks"]["reservation_required"] is True
    assert snapshot["budget_checks"]["survival_reserve_preserved"] is True
    assert snapshot["authority_checks"]["r2_upgrade_authorized"] is True
    assert snapshot["authority_checks"]["r5_govern_blocked"] is True

    objects = snapshot["objects_created"]
    assert objects["release_cards"] >= 1
    assert objects["improvement_objects"] >= 2
    assert objects["capability_capsules"] >= 1
    assert objects["harness_patches"] >= 1
    assert objects["eval_runs"] >= 2
    assert objects["eval_attestations"] >= 2
    assert objects["deployment_capsules"] >= 1
    assert objects["deployment_leases"] >= 1
    assert objects["deployment_receipts"] >= 1
    assert objects["payment_receipts"] >= 1
    assert objects["autonomy_receipts"] >= 1
    assert objects["memory_items"] >= 1
    assert objects["usage_attestations"] >= 1
    assert objects["reward_entries"] >= 3

    # Comparative eval assertions
    comp = snapshot["comparative_eval"]
    assert comp["baseline_id"] == "cap_release_watcher_v1"
    assert comp["candidate_id"] is not None
    assert comp["rubric_auto_generated"] is True
    assert comp["dimensions_evaluated"] >= 3
    assert comp["winner"] in ("candidate", "baseline", "tie")
    assert comp["recommendation"] in ("deploy_candidate", "keep_baseline", "needs_review")
    assert isinstance(comp["baseline_avg"], (int, float))
    assert isinstance(comp["candidate_avg"], (int, float))
