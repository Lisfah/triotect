"""
Order Gateway — Orders API

Flow:
  1. JWT validated by middleware (request.state.user set)
  2. Check Redis cache for stock availability (High-Speed Cache Stock Check)
  3. Forward to Stock Service for deduction (idempotency key forwarded)
  4. Publish to Kitchen Queue
  5. Return acknowledgment in < 2s
"""
import uuid
import httpx
from fastapi import APIRouter, Request, HTTPException, status, Depends

from app.core.config import get_settings
from app.core.redis_client import get_redis
from app.schemas.order import OrderRequest, OrderResponse

settings = get_settings()
router = APIRouter(prefix="/orders", tags=["orders"])

STOCK_CACHE_KEY = "stock:{menu_item_id}"


@router.post("", response_model=OrderResponse, status_code=status.HTTP_202_ACCEPTED)
async def create_order(payload: OrderRequest, request: Request):
    """
    Place an order. Requires valid JWT (enforced by JWTAuthMiddleware).
    Idempotency enforced by IdempotencyMiddleware.
    """
    user = request.state.user
    redis = get_redis()

    # ── Step 1: High-Speed Cache Stock Check ───────────────────────────────────
    for item in payload.items:
        cache_key = f"stock:{item.menu_item_id}"
        cached_stock = await redis.get(cache_key)
        if cached_stock is not None:
            try:
                stock = int(cached_stock)
            except ValueError:
                stock = 1
            if stock <= 0:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Menu item '{item.menu_item_id}' is out of stock (cache hit). Order rejected.",
                )

    # ── Step 2: Call Stock Service to deduct inventory ────────────────────────
    order_id = str(uuid.uuid4())
    idempotency_key = request.headers.get("Idempotency-Key", order_id)

    try:
        async with httpx.AsyncClient(timeout=settings.HTTP_TIMEOUT_SECONDS) as client:
            stock_response = await client.post(
                f"{settings.STOCK_SERVICE_URL}/stock/deduct",
                json={
                    "order_id": order_id,
                    "student_id": user.get("student_id"),
                    "items": [i.model_dump() for i in payload.items],
                },
                headers={"Idempotency-Key": idempotency_key},
            )
    except httpx.TimeoutException:
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="Stock Service did not respond in time. Please retry.",
        )
    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Stock Service unreachable: {exc}",
        )

    if stock_response.status_code == 409:
        raise HTTPException(status_code=409, detail="Some items are out of stock.")
    if not stock_response.is_success:
        raise HTTPException(
            status_code=stock_response.status_code,
            detail=stock_response.json().get("detail", "Stock deduction failed."),
        )

    # ── Step 3: Publish to Kitchen Queue ──────────────────────────────────────
    try:
        async with httpx.AsyncClient(timeout=settings.HTTP_TIMEOUT_SECONDS) as client:
            kitchen_response = await client.post(
                f"{settings.KITCHEN_QUEUE_URL}/kitchen/queue",
                json={
                    "order_id": order_id,
                    "student_id": user.get("student_id"),
                    "items": [i.model_dump() for i in payload.items],
                    "special_notes": payload.special_notes,
                },
            )
    except (httpx.TimeoutException, httpx.RequestError):
        # Kitchen queue failure → non-critical, order still accepted
        pass

    # Update Redis stock cache estimate
    for item in payload.items:
        try:
            cache_key = f"stock:{item.menu_item_id}"
            current = await redis.get(cache_key)
            if current is not None:
                new_val = max(0, int(current) - item.quantity)
                await redis.setex(cache_key, settings.STOCK_CACHE_TTL_SECONDS, new_val)
        except Exception:
            pass

    return OrderResponse(
        order_id=order_id,
        status="queued",
        message="Order accepted and queued for kitchen processing.",
        estimated_wait_seconds=7,
    )


@router.get("/{order_id}")
async def get_order_status(order_id: str, request: Request):
    """Get order status from Kitchen Queue service."""
    try:
        async with httpx.AsyncClient(timeout=settings.HTTP_TIMEOUT_SECONDS) as client:
            r = await client.get(f"{settings.KITCHEN_QUEUE_URL}/kitchen/orders/{order_id}")
            return r.json()
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc))
