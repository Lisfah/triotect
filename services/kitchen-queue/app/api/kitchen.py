"""
Kitchen Queue — FastAPI routes
"""
import uuid
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel, Field

from app.db.database import get_db
from app.models.order import Order, OrderItem, OrderStatus
from app.tasks.kitchen_tasks import process_order
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
    # Create order record
    order = Order(
        id=payload.order_id,
        student_id=payload.student_id,
        status=OrderStatus.PENDING,
        special_notes=payload.special_notes,
    )
    db.add(order)

    # Create order items
    for item in payload.items:
        db.add(OrderItem(
            order_id=payload.order_id,
            menu_item_id=item["menu_item_id"],
            quantity=item["quantity"],
        ))

    await db.commit()

    # Dispatch to Celery worker (non-blocking)
    process_order.delay(
        order_id=payload.order_id,
        student_id=payload.student_id,
        items=payload.items,
        special_notes=payload.special_notes,
    )

    return {
        "order_id": payload.order_id,
        "status": OrderStatus.PENDING,
        "message": "Order queued for kitchen processing.",
    }


@router.get("/orders/{order_id}")
async def get_order(order_id: str, db: AsyncSession = Depends(get_db)):
    """Get order status."""
    result = await db.execute(select(Order).where(Order.id == order_id))
    order = result.scalar_one_or_none()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found.")
    return {"order_id": order.id, "status": order.status, "student_id": order.student_id}
