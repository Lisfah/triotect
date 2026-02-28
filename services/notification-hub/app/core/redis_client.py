"""
Notification Hub — Redis client with pub/sub support
"""
import redis.asyncio as aioredis
from app.core.config import get_settings

settings = get_settings()
_redis_client: aioredis.Redis | None = None


def get_redis() -> aioredis.Redis:
    global _redis_client
    if _redis_client is None:
        _redis_client = aioredis.from_url(
            settings.redis_url,
            decode_responses=True,
            socket_connect_timeout=settings.HEALTH_CHECK_TIMEOUT,
        )
    return _redis_client


def get_redis_pubsub():
    """Get a fresh pub/sub connection (one per SSE stream)."""
    client = aioredis.from_url(settings.redis_url, decode_responses=True)
    return client.pubsub()


async def close_redis():
    global _redis_client
    if _redis_client:
        await _redis_client.aclose()
        _redis_client = None
