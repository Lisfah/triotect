"""
Identity Provider — FastAPI application entrypoint
"""
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from prometheus_fastapi_instrumentator import Instrumentator

from app.core.config import get_settings
from app.core.redis_client import close_redis
from app.db.database import engine, Base
from app.middleware.rate_limiter import SlidingWindowRateLimiter
from app.api import auth, health

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: create tables (Alembic handles migrations in production)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    # Shutdown
    await close_redis()
    await engine.dispose()


app = FastAPI(
    title="TrioTect Identity Provider",
    description="JWT authentication service with Redis-backed sliding-window rate limiting.",
    version=settings.SERVICE_VERSION,
    lifespan=lifespan,
    docs_url="/docs" if settings.DEBUG else None,
    redoc_url=None,
)

# ── CORS ──────────────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Tighten in production via env var
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Rate Limiting ─────────────────────────────────────────────────────────────
app.add_middleware(SlidingWindowRateLimiter)

# ── Prometheus Metrics ────────────────────────────────────────────────────────
if settings.METRICS_ENABLED:
    Instrumentator().instrument(app).expose(app, endpoint="/metrics")

# ── Routers ───────────────────────────────────────────────────────────────────
app.include_router(auth.router)
app.include_router(health.router)


@app.get("/")
async def root():
    return {"service": settings.SERVICE_NAME, "version": settings.SERVICE_VERSION}
