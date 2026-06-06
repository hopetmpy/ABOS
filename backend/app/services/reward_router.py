import uuid
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.rewards import UsageAttestation, RewardLedgerEntry


async def create_usage_attestation(
    db: AsyncSession,
    project_id: str,
    agent_id: str | None,
    capability_id: str,
    install_ring: str,
    use_count_range: str = "1-5",
    improvement_claim: dict | None = None,
    hard_gates_pass: bool = True,
    royalty_due: float = 0.0,
) -> UsageAttestation:
    att_id = f"usage_{uuid.uuid4().hex[:12]}"
    attestation = UsageAttestation(
        id=att_id,
        project_id=project_id,
        agent_id=agent_id,
        capability_id=capability_id,
        install_ring=install_ring,
        use_count_range=use_count_range,
        improvement_claim=improvement_claim or {},
        hard_gates={"all_pass": hard_gates_pass},
        royalty_due=royalty_due,
        raw_receipts_private=True,
    )
    db.add(attestation)
    await db.commit()
    return attestation


async def route_rewards(
    db: AsyncSession,
    usage_attestation_id: str,
    reward_manifest: dict,
    total_amount: float,
) -> list[RewardLedgerEntry]:
    attestation = await db.get(UsageAttestation, usage_attestation_id)
    if not attestation:
        return []

    # If hard gates failed, pay zero
    hard_gates = attestation.hard_gates or {}
    if not hard_gates.get("all_pass", False):
        return []

    contributors = reward_manifest.get("contributors", {})
    total_shares = sum(contributors.values())
    if total_shares == 0:
        return []

    entries = []
    for recipient, share in contributors.items():
        entry_id = f"reward_{uuid.uuid4().hex[:12]}"
        amount = total_amount * (share / total_shares) * 0.2  # 20% immediate
        entry = RewardLedgerEntry(
            id=entry_id,
            usage_attestation_id=usage_attestation_id,
            recipient_id=recipient,
            reason=f"Contribution reward ({share}/{total_shares} share)",
            amount=amount,
            status="pending",
        )
        db.add(entry)
        entries.append(entry)

    await db.commit()
    return entries
