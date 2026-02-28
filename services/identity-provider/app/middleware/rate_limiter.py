"""
Identity Provider — Sliding window rate limiter middleware (Redis-backed)

Implements: 3 login attempts per 60 seconds per student_id.
Uses sorted sets (ZADD/ZRANGEBYSCORE/ZCARD) for a true sliding window.
"""
import time
from fastapi import Request, Response
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.config import get_settings
from app.core.redis_client import get_redis

settings = get_settings()

RATE_LIMIT_PREFIX = "ratelimit:"


class SlidingWindowRateLimiter(BaseHTTPMiddleware):
    """
    Applies sliding-window rate limiting ONLY to POST /auth/login.
    Key is derived from the student_id in the request body.
    Falls back to IP-based key if student_id cannot be parsed.
    """

    async def dispatch(self, request: Request, call_next) -> Response:
        if request.method == "POST" and request.url.path in ("/auth/login", "/auth/login/"):
            # Read body without consuming the stream
            body = await request.body()
            import json
            try:
                data = json.loads(body)
                tracking_key = data.get("student_id") or request.client.host
            except Exception:
                tracking_key = request.client.host

            redis = get_redis()
            key = f"{RATE_LIMIT_PREFIX}{tracking_key}"
            now = time.time()
            window_start = now - settings.RATE_LIMIT_WINDOW_SECONDS

            pipe = redis.pipeline()
            # Remove entries outside the window
            pipe.zremrangebyscore(key, "-inf", window_start)
            # Count current attempts in window
            pipe.zcard(key)
            # Add this attempt
            pipe.zadd(key, {str(now): now})
            # Set TTL
            pipe.expire(key, settings.RATE_LIMIT_WINDOW_SECONDS + 1)
            results = await pipe.execute()

            attempt_count = results[1]  # count before this attempt

            if attempt_count >= settings.RATE_LIMIT_MAX_ATTEMPTS:
                return JSONResponse(
                    status_code=429,
                    content={
                        "detail": (
                            f"Too many login attempts. Maximum {settings.RATE_LIMIT_MAX_ATTEMPTS} "
                            f"attempts per {settings.RATE_LIMIT_WINDOW_SECONDS} seconds."
                        ),
                        "retry_after_seconds": settings.RATE_LIMIT_WINDOW_SECONDS,
                    },
                    headers={"Retry-After": str(settings.RATE_LIMIT_WINDOW_SECONDS)},
                )

            # Re-attach consumed body so downstream can read it
            from starlette.requests import Request as StarletteRequest
            async def receive():
                return {"type": "http.request", "body": body, "more_body": False}
            request = StarletteRequest(request.scope, receive)

        return await call_next(request)
