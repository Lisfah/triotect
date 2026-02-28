"""
Stock Service — API routes
"""
import asyncio
import logging
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel, Field

from app.db.database import get_db
from app.db.stock_ops import deduct_inventory
from app.models.inventory import Inventory, MenuItem
from app.core.redis_client import get_redis
from app.core.config import get_settings

settings = get_settings()
logger = logging.getLogger(__name__)
router = APIRouter(prefix="/stock", tags=["stock"])


class DeductItem(BaseModel):
    menu_item_id: str
    quantity: int = Field(..., ge=1)


class DeductRequest(BaseModel):
    order_id: str
    student_id: str
    items: list[DeductItem]


class StockItem(BaseModel):
    menu_item_id: str
    current_stock: int
    version_id: int


@router.post("/deduct", status_code=status.HTTP_200_OK)
async def deduct_stock(payload: DeductRequest, db: AsyncSession = Depends(get_db)):
    """
    Deduct stock for all items in an order.
    Uses optimistic locking with exponential backoff retry.
    Updates Redis cache after successful deduction.
    """
    results = []
    redis = get_redis()

    for item in payload.items:
        try:
            inv = await deduct_inventory(
                db=db,
                order_id=payload.order_id,
                student_id=payload.student_id,
                menu_item_id=item.menu_item_id,
                quantity=item.quantity,
            )
            # Keep Redis cache in sync
            cache_key = f"stock:{item.menu_item_id}"
            await redis.setex(cache_key, settings.STOCK_CACHE_TTL_SECONDS, inv.current_stock)
            results.append({"menu_item_id": item.menu_item_id, "remaining_stock": inv.current_stock})
        except ValueError as e:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))
        except Exception as e:
            logger.exception("Stock deduction failed for %s", item.menu_item_id)
            raise HTTPException(status_code=500, detail=str(e))

    return {"order_id": payload.order_id, "deducted_items": results, "status": "success"}


@router.get("/{menu_item_id}", response_model=StockItem)
async def get_stock(menu_item_id: str, db: AsyncSession = Depends(get_db)):
    """Get current stock for a menu item. Also warms Redis cache."""
    result = await db.execute(select(Inventory).where(Inventory.menu_item_id == menu_item_id))
    inv = result.scalar_one_or_none()
    if inv is None:
        raise HTTPException(status_code=404, detail="Menu item not found in inventory.")

    # Warm cache
    redis = get_redis()
    await redis.setex(f"stock:{menu_item_id}", settings.STOCK_CACHE_TTL_SECONDS, inv.current_stock)

    return StockItem(menu_item_id=inv.menu_item_id, current_stock=inv.current_stock, version_id=inv.version_id)


@router.get("", response_model=list[StockItem])
async def list_stock(db: AsyncSession = Depends(get_db)):
    """List all inventory items."""
    result = await db.execute(select(Inventory))
    inventories = result.scalars().all()
    return [
        StockItem(menu_item_id=i.menu_item_id, current_stock=i.current_stock, version_id=i.version_id)
        for i in inventories
    ]
