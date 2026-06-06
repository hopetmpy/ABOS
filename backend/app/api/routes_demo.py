from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.seed.demo_flow import run_demo_flow

router = APIRouter(prefix="/v1/demo", tags=["demo"])


@router.post("/run")
async def run_demo(db: AsyncSession = Depends(get_db)):
    result = await run_demo_flow(db)
    return result
