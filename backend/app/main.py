from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.db import init_db
from app.api.routes_projects import router as projects_router
from app.api.routes_agents import router as agents_router
from app.api.routes_envelope import router as envelope_router
from app.api.routes_memory import router as memory_router
from app.api.routes_forge import router as forge_router
from app.api.routes_eval import router as eval_router
from app.api.routes_harness import router as harness_router
from app.api.routes_deploy import router as deploy_router
from app.api.routes_budget import router as budget_router
from app.api.routes_receipts import router as receipts_router
from app.api.routes_rewards import router as rewards_router
from app.api.routes_suggestions import router as suggestions_router
from app.api.routes_authority import router as authority_router
from app.api.routes_demo import router as demo_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield


app = FastAPI(
    title="Conway Everyone-Improving Agent OS",
    version="0.1.0",
    description="Local MVP for the Conway Agent Operating System",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"status": "ok", "version": "0.1.0", "system": "Conway Agent OS"}


app.include_router(projects_router)
app.include_router(agents_router)
app.include_router(envelope_router)
app.include_router(memory_router)
app.include_router(forge_router)
app.include_router(eval_router)
app.include_router(harness_router)
app.include_router(deploy_router)
app.include_router(budget_router)
app.include_router(receipts_router)
app.include_router(rewards_router)
app.include_router(suggestions_router)
app.include_router(authority_router)
app.include_router(demo_router)
