"""Run the full Conway demo flow."""
import asyncio
import json

from app.seed.demo_flow import run_demo_flow
from app.db import async_session, init_db


async def main():
    await init_db()
    async with async_session() as db:
        result = await run_demo_flow(db)

    for step in result["steps"]:
        print(step)

    print()
    print("---")
    print(json.dumps(result["acceptance_snapshot"], indent=2))
    print()
    print(result["message"])


if __name__ == "__main__":
    asyncio.run(main())
