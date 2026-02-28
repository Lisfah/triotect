"""
Identity Provider — Health endpoint
"""
import asyncio
from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app.core.config import get_settings
from app.core.redis_client import get_redis
from app.db.database import engine
from app.schemas.auth import HealthResponse

settings = get_settings()
router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse)
async def health_check():
    """
    Deep health check — verifies PostgreSQL and Redis connectivity.
    Returns 200 if all dependencies are healthy, 503 otherwise.
    """
    deps: dict[str, str] = {}
    healthy = True

    # Check PostgreSQL
    try:
        async with engine.connect() as conn:
            await asyncio.wait_for(conn.execute(__import__("sqlalchemy").text("SELECT 1")), timeout=settings.HEALTH_CHECK_TIMEOUT)
        deps["postgresql"] = "ok"
    except Exception as e:
        deps["postgresql"] = f"error: {str(e)[:100]}"
        healthy = False

    # Check Redis
    try:
        redis = get_redis()
        await asyncio.wait_for(redis.ping(), timeout=settings.HEALTH_CHECK_TIMEOUT)
        deps["redis"] = "ok"
    except Exception as e:
        deps["redis"] = f"error: {str(e)[:100]}"
        healthy = False

    response = HealthResponse(
        status="healthy" if healthy else "degraded",
        service=settings.SERVICE_NAME,
        version=settings.SERVICE_VERSION,
        dependencies=deps,
    )

    return JSONResponse(
        content=response.model_dump(),
        status_code=200 if healthy else 503,
    )
