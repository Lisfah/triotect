"""
Kitchen Queue — FastAPI entrypoint
"""
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from prometheus_fastapi_instrumentator import Instrumentator
from app.core.config import get_settings
from app.db.database import engine, Base
from app.api import kitchen, health

settings = get_settings()

@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    await engine.dispose()

app = FastAPI(title="TrioTect Kitchen Queue", version=settings.SERVICE_VERSION,
              lifespan=lifespan, docs_url="/docs" if settings.DEBUG else None, redoc_url=None)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])
if settings.METRICS_ENABLED:
    Instrumentator().instrument(app).expose(app, endpoint="/metrics")
app.include_router(kitchen.router)
app.include_router(health.router)

@app.get("/")
async def root():
    return {"service": settings.SERVICE_NAME, "version": settings.SERVICE_VERSION}
