"""
Order Gateway — Health endpoint
"""
import asyncio
import httpx
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

    # Check Redis
    try:
        redis = get_redis()
        await asyncio.wait_for(redis.ping(), timeout=settings.HEALTH_CHECK_TIMEOUT)
        deps["redis"] = "ok"
    except Exception as e:
        deps["redis"] = f"error: {str(e)[:100]}"
        healthy = False

    # Check downstream services (shallow)
    for name, url in [
        ("stock-service", settings.STOCK_SERVICE_URL),
        ("kitchen-queue", settings.KITCHEN_QUEUE_URL),
        ("notification-hub", settings.NOTIFICATION_HUB_URL),
    ]:
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                r = await client.get(f"{url}/health")
                deps[name] = "ok" if r.status_code == 200 else f"degraded: {r.status_code}"
                if r.status_code != 200:
                    healthy = False
        except Exception as e:
            deps[name] = f"error: {str(e)[:100]}"
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
