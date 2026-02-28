"""
Order Gateway — Idempotency Key Middleware

Implements RFC-style idempotency using Redis:
  - Cache hit  → return cached response immediately (no business logic)
  - Cache miss → execute handler, store response in Redis for 24h
"""
import json
from fastapi import Request, Response
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.config import get_settings
from app.core.redis_client import get_redis

settings = get_settings()

IDEMPOTENCY_PREFIX = "idempotent:"
IDEMPOTENCY_METHODS = {"POST", "PUT", "PATCH"}
IDEMPOTENCY_PATHS = {"/orders", "/orders/"}


class IdempotencyMiddleware(BaseHTTPMiddleware):
    """
    Applies to state-mutating endpoints.
    Reads Idempotency-Key header and either:
      1. Returns cached response (replay)
      2. Executes handler and caches the response
    """

    async def dispatch(self, request: Request, call_next) -> Response:
        if request.method not in IDEMPOTENCY_METHODS:
            return await call_next(request)

        if request.url.path not in IDEMPOTENCY_PATHS:
            return await call_next(request)

        idem_key = request.headers.get("Idempotency-Key")
        if not idem_key:
            return await call_next(request)

        redis = get_redis()
        cache_key = f"{IDEMPOTENCY_PREFIX}{idem_key}"

        # Cache HIT → replay stored response
        cached = await redis.get(cache_key)
        if cached:
            data = json.loads(cached)
            return JSONResponse(
                content=data["body"],
                status_code=data["status_code"],
                headers={"X-Idempotency-Replay": "true"},
            )

        # Cache MISS → proceed to handler
        response = await call_next(request)

        # Capture and cache response body
        body_bytes = b""
        async for chunk in response.body_iterator:
            body_bytes += chunk

        try:
            body = json.loads(body_bytes)
        except Exception:
            body = body_bytes.decode("utf-8", errors="replace")

        if response.status_code < 500:
            await redis.setex(
                cache_key,
                settings.IDEMPOTENCY_KEY_TTL_SECONDS,
                json.dumps({"body": body, "status_code": response.status_code}),
            )

        return Response(
            content=body_bytes,
            status_code=response.status_code,
            media_type=response.media_type,
            headers=dict(response.headers),
        )
