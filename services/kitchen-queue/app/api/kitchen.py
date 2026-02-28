"""
Kitchen Queue — FastAPI routes
"""
import uuid
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text
from pydantic import BaseModel, Field

from app.db.database import get_db
from app.models.order import Order, OrderItem, OrderStatus
from app.core.config import get_settings

settings = get_settings()
router = APIRouter(prefix="/kitchen", tags=["kitchen"])


class QueueRequest(BaseModel):
    order_id: str
    student_id: str
    items: list[dict]
    special_notes: str | None = None


@router.post("/queue", status_code=202)
async def queue_order(payload: QueueRequest, db: AsyncSession = Depends(get_db)):
    """
    Persist order and dispatch Celery task.
    Returns acknowledgment immediately (<2s), kitchen processes asynchronously.
    """
    order = Order(
        id=payload.order_id,
        student_id=payload.student_id,
        status=OrderStatus.PENDING,
        special_notes=payload.special_notes,
    )
    db.add(order)

    for item in payload.items:
        db.add(OrderItem(
            order_id=payload.order_id,
            menu_item_id=item["menu_item_id"],
            quantity=item["quantity"],
        ))

    await db.commit()

    return {
        "order_id": payload.order_id,
        "status": OrderStatus.PENDING,
        "message": "Order queued for kitchen processing.",
    }


@router.get("/orders")
async def list_orders(
    student_id: str = Query(..., description="Filter orders by student ID"),
    db: AsyncSession = Depends(get_db),
):
    """List all orders for a student, newest first, with their items."""
    result = await db.execute(
        select(Order)
        .where(Order.student_id == student_id)
        .order_by(Order.created_at.desc())
    )
    orders = result.scalars().all()

    out = []
    for order in orders:
        items_result = await db.execute(
            select(OrderItem).where(OrderItem.order_id == order.id)
        )
        items = items_result.scalars().all()
        out.append({
            "order_id": order.id,
            "status": order.status,
            "special_notes": order.special_notes,
            "created_at": order.created_at.isoformat() if order.created_at else None,
            "items": [
                {"menu_item_id": i.menu_item_id, "quantity": i.quantity}
                for i in items
            ],
        })

    return out


@router.get("/orders/{order_id}")
async def get_order(order_id: str, db: AsyncSession = Depends(get_db)):
    """Get order status."""
    result = await db.execute(select(Order).where(Order.id == order_id))
    order = result.scalar_one_or_none()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found.")
    return {"order_id": order.id, "status": order.status, "student_id": order.student_id}


@router.get("/all-orders")
async def list_all_orders(
    status: str | None = Query(None, description="Filter by status (pending, in_kitchen, ready, failed, stock_verified)"),
    db: AsyncSession = Depends(get_db),
):
    """
    Kitchen display board — all orders, newest first, with items.
    Optional ?status= filter. No student_id filter.
    """
    query = select(Order).order_by(Order.created_at.desc())
    if status:
        query = query.where(Order.status == status)

    result = await db.execute(query)
    orders = result.scalars().all()

    out = []
    for order in orders:
        items_result = await db.execute(
            select(OrderItem).where(OrderItem.order_id == order.id)
        )
        items = items_result.scalars().all()
        out.append({
            "order_id": order.id,
            "student_id": order.student_id,
            "status": order.status,
            "special_notes": order.special_notes,
            "created_at": order.created_at.isoformat() if order.created_at else None,
            "updated_at": order.updated_at.isoformat() if order.updated_at else None,
            "items": [
                {"menu_item_id": i.menu_item_id, "quantity": i.quantity}
                for i in items
            ],
        })

    return out


# ── Manual status transition maps ─────────────────────────────────────────────
NEXT_STATUS: dict[str, str] = {
    "PENDING":        "STOCK_VERIFIED",
    "STOCK_VERIFIED": "IN_KITCHEN",
    "IN_KITCHEN":     "READY",
}
PREV_STATUS: dict[str, str] = {
    "READY":          "IN_KITCHEN",
    "IN_KITCHEN":     "STOCK_VERIFIED",
    "STOCK_VERIFIED": "PENDING",
}


@router.post("/orders/{order_id}/advance", status_code=200)
async def advance_order(order_id: str, db: AsyncSession = Depends(get_db)):
    """Manually advance an order to the next stage (kitchen staff action)."""
    row = (await db.execute(
        text("SELECT status::text FROM orders WHERE id = :id"), {"id": order_id}
    )).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Order not found.")
    current = row[0]
    next_s = NEXT_STATUS.get(current)
    if not next_s:
        raise HTTPException(status_code=400, detail=f"Cannot advance order from status '{current}'.")
    await db.execute(
        text("UPDATE orders SET status = CAST(:s AS order_status), updated_at = NOW() WHERE id = :id"),
        {"s": next_s, "id": order_id},
    )
    await db.commit()
    return {"order_id": order_id, "status": next_s.lower()}


@router.post("/orders/{order_id}/revert", status_code=200)
async def revert_order(order_id: str, db: AsyncSession = Depends(get_db)):
    """Manually revert an order to the previous stage (error correction)."""
    row = (await db.execute(
        text("SELECT status::text FROM orders WHERE id = :id"), {"id": order_id}
    )).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Order not found.")
    current = row[0]
    prev_s = PREV_STATUS.get(current)
    if not prev_s:
        raise HTTPException(status_code=400, detail=f"Cannot revert order from status '{current}'.")
    await db.execute(
        text("UPDATE orders SET status = CAST(:s AS order_status), updated_at = NOW() WHERE id = :id"),
        {"s": prev_s, "id": order_id},
    )
    await db.commit()
    return {"order_id": order_id, "status": prev_s.lower()}
