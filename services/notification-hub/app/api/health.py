"""
Notification Hub — Health endpoint
"""
import asyncio
from fastapi import APIRouter
from fastapi.responses import JSONResponse
from app.core.config import get_settings
from app.core.redis_client import get_redis

settings = get_settings()
router = APIRouter(tags=["health"])


@router.get("/health")
async def health_check():
    deps: dict[str, str] = {}
    healthy = True
    try:
        redis = get_redis()
        await asyncio.wait_for(redis.ping(), timeout=settings.HEALTH_CHECK_TIMEOUT)
        deps["redis"] = "ok"
    except Exception as e:
        deps["redis"] = f"error: {str(e)[:100]}"
        healthy = False

    # Report chaos status as info (not a failure)
    try:
        redis = get_redis()
        chaos = await redis.get(settings.CHAOS_FLAG_KEY)
        deps["chaos_mode"] = "active" if chaos else "inactive"
    except Exception:
        pass

    return JSONResponse(
        content={"status": "healthy" if healthy else "degraded",
                 "service": settings.SERVICE_NAME, "version": settings.SERVICE_VERSION,
                 "dependencies": deps},
        status_code=200 if healthy else 503,
    )
