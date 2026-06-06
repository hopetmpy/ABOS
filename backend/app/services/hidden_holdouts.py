from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.eval import Worldlet


async def get_private_holdouts_for_eval(db: AsyncSession, rubric_id: str, target_type: str) -> list[Worldlet]:
    result = await db.execute(
        select(Worldlet).where(Worldlet.visibility == "private_holdout")
    )
    return list(result.scalars().all())


def summarize_hidden_holdout_result(result: str) -> dict:
    return {
        "hidden_holdout_checked": True,
        "result": result,
        "detail": "pass/fail only - contents private",
    }
