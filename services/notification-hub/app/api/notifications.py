"""
Notification Hub — SSE endpoint with Redis pub/sub + Chaos Toggle

Architecture:
  - Celery workers publish state changes to Redis channel: order:{order_id}
  - SSE endpoint subscribes and streams them to the browser EventSource
  - Chaos Toggle checks Redis flag 'chaos:notification-hub' and injects 503s
"""
import asyncio
import json
import logging
from typing import AsyncGenerator

import redis.asyncio as aioredis
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import StreamingResponse, JSONResponse

from app.core.config import get_settings
from app.core.redis_client import get_redis, get_redis_pubsub

settings = get_settings()
logger = logging.getLogger(__name__)
router = APIRouter(prefix="/notifications", tags=["notifications"])


async def _check_chaos(redis: aioredis.Redis) -> bool:
    """Return True if chaos mode is enabled for this service."""
    flag = await redis.get(settings.CHAOS_FLAG_KEY)
    return flag is not None and flag.lower() in ("1", "true", "enabled")


async def _sse_generator(order_id: str, request: Request) -> AsyncGenerator[str, None]:
    """Subscribe to Redis pub/sub and yield SSE events."""
    redis = get_redis()

    # Check chaos before establishing stream
    if await _check_chaos(redis):
        raise HTTPException(
            status_code=503,
            detail="Notification Hub is unavailable (chaos mode active).",
        )

    channel_name = f"order:{order_id}"
    pubsub = redis.pubsub()
    await pubsub.subscribe(channel_name)

    try:
        # Initial keepalive comment
        yield f": connected to order {order_id}\n\n"

        # Set retry interval for the client
        yield f"retry: {settings.SSE_RETRY_MILLISECONDS}\n\n"

        while True:
            if await request.is_disconnected():
                break

            # Check chaos on each iteration
            if await _check_chaos(redis):
                yield "event: error\ndata: {\"detail\": \"Service disrupted (chaos mode)\"}\n\n"
                break

            message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
            if message and message["type"] == "message":
                data = message["data"]
                try:
                    payload = json.loads(data)
                except Exception:
                    payload = {"raw": data}

                yield f"event: order_update\ndata: {json.dumps(payload)}\n\n"

                # Stop streaming when order is in terminal state
                if payload.get("status") in ("ready", "failed"):
                    break
            else:
                # Keepalive ping
                yield f": keepalive\n\n"
                await asyncio.sleep(settings.SSE_KEEPALIVE_INTERVAL_SECONDS)

    finally:
        await pubsub.unsubscribe(channel_name)
        await pubsub.aclose()


@router.get("/stream/{order_id}")
async def stream_notifications(order_id: str, request: Request):
    """
    SSE endpoint. Browser creates an EventSource to this URL.
    Streams order state changes as server-sent events until the order is terminal.
    """
    redis = get_redis()
    if await _check_chaos(redis):
        raise HTTPException(status_code=503, detail="Notification Hub is down (chaos mode).")

    return StreamingResponse(
        _sse_generator(order_id, request),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # Disable Nginx buffering
            "Connection": "keep-alive",
        },
    )


@router.post("/publish")
async def publish_notification(payload: dict):
    """
    Internal endpoint called by Kitchen Queue workers to push state changes.
    Publishes to Redis pub/sub channel for the order.
    """
    order_id = payload.get("order_id")
    if not order_id:
        raise HTTPException(status_code=400, detail="order_id required")

    redis = get_redis()
    channel = f"order:{order_id}"
    await redis.publish(channel, json.dumps(payload))
    return {"published": True, "channel": channel}


@router.get("/chaos")
async def get_chaos_status():
    """Get current chaos toggle state for this service."""
    redis = get_redis()
    enabled = await _check_chaos(redis)
    return {"chaos_enabled": enabled, "flag_key": settings.CHAOS_FLAG_KEY}


@router.post("/chaos/enable")
async def enable_chaos():
    """Enable chaos mode — inject 503s and sever SSE connections."""
    redis = get_redis()
    await redis.set(settings.CHAOS_FLAG_KEY, "true")
    return {"chaos_enabled": True, "message": "Chaos mode activated for Notification Hub."}


@router.post("/chaos/disable")
async def disable_chaos():
    """Disable chaos mode."""
    redis = get_redis()
    await redis.delete(settings.CHAOS_FLAG_KEY)
    return {"chaos_enabled": False, "message": "Chaos mode deactivated."}
