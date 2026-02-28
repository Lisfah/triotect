"""
Stock Service — Health endpoint
"""
import asyncio
from fastapi import APIRouter
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.core.config import get_settings
from app.core.redis_client import get_redis
from app.db.database import engine

settings = get_settings()
router = APIRouter(tags=["health"])


@router.get("/health")
async def health_check():
    deps: dict[str, str] = {}
    healthy = True

    try:
        async with engine.connect() as conn:
            await asyncio.wait_for(conn.execute(text("SELECT 1")), timeout=settings.HEALTH_CHECK_TIMEOUT)
        deps["postgresql"] = "ok"
    except Exception as e:
        deps["postgresql"] = f"error: {str(e)[:100]}"
        healthy = False

    try:
        redis = get_redis()
        await asyncio.wait_for(redis.ping(), timeout=settings.HEALTH_CHECK_TIMEOUT)
        deps["redis"] = "ok"
    except Exception as e:
        deps["redis"] = f"error: {str(e)[:100]}"
        healthy = False

    return JSONResponse(
        content={
            "status": "healthy" if healthy else "degraded",
            "service": settings.SERVICE_NAME,
            "version": settings.SERVICE_VERSION,
            "dependencies": deps,
        },
        status_code=200 if healthy else 503,
    )
