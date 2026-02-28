"""
Order Gateway — FastAPI application entrypoint
"""
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from prometheus_fastapi_instrumentator import Instrumentator

from app.core.config import get_settings
from app.core.redis_client import close_redis
from app.middleware.auth import JWTAuthMiddleware
from app.middleware.idempotency import IdempotencyMiddleware
from app.api import orders, health

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    await close_redis()


app = FastAPI(
    title="TrioTect Order Gateway",
    description="Central API gateway: JWT enforcement, Redis cache stock check, idempotency, routing.",
    version=settings.SERVICE_VERSION,
    lifespan=lifespan,
    docs_url="/docs" if settings.DEBUG else None,
    redoc_url=None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Order matters: Idempotency runs before Auth so replays skip validation
app.add_middleware(IdempotencyMiddleware)
app.add_middleware(JWTAuthMiddleware)

if settings.METRICS_ENABLED:
    Instrumentator().instrument(app).expose(app, endpoint="/metrics")

app.include_router(orders.router)
app.include_router(health.router)


@app.get("/")
async def root():
    return {"service": settings.SERVICE_NAME, "version": settings.SERVICE_VERSION}
