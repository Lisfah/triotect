"""
Stock Service — Stock deduction logic with optimistic locking
"""
import uuid
import logging
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text
from app.core.optimistic_lock import StaleDataError

from app.models.inventory import Inventory, StockDeductionLog
from app.core.optimistic_lock import with_optimistic_retry
from app.core.config import get_settings

settings = get_settings()
logger = logging.getLogger(__name__)


@with_optimistic_retry()
async def deduct_inventory(
    db: AsyncSession,
    order_id: str,
    student_id: str,
    menu_item_id: str,
    quantity: int,
) -> Inventory:
    """
    Atomically deduct stock using optimistic locking.

    The version_id column acts as the conflict detector:
      - READ:  fetch current stock + version_id
      - WRITE: UPDATE WHERE version_id = <read_version>
      - If another transaction committed first → StaleDataError → retry

    This completely prevents overselling without heavy row locks.
    """
    # Read current inventory row
    result = await db.execute(
        select(Inventory).where(Inventory.menu_item_id == menu_item_id)
    )
    inv: Inventory | None = result.scalar_one_or_none()

    if inv is None:
        raise ValueError(f"Menu item '{menu_item_id}' not found in inventory.")

    if inv.current_stock < quantity:
        raise ValueError(
            f"Insufficient stock for '{menu_item_id}': "
            f"requested={quantity}, available={inv.current_stock}"
        )

    # Optimistically update: WHERE version_id = <snapshot_version>
    current_version = inv.version_id
    new_stock = inv.current_stock - quantity
    new_version = current_version + 1

    result = await db.execute(
        text(
            "UPDATE inventory SET current_stock = :new_stock, version_id = :new_version, "
            "updated_at = NOW() "
            "WHERE menu_item_id = :menu_item_id AND version_id = :expected_version"
        ),
        {
            "new_stock": new_stock,
            "new_version": new_version,
            "menu_item_id": menu_item_id,
            "expected_version": current_version,
        },
    )

    if result.rowcount == 0:
        # Another transaction won the race → trigger retry
        await db.rollback()
        raise StaleDataError("Optimistic lock conflict: inventory version changed concurrently.")

    # Write audit log
    log_entry = StockDeductionLog(
        id=str(uuid.uuid4()),
        order_id=order_id,
        menu_item_id=menu_item_id,
        quantity_deducted=quantity,
        student_id=student_id,
    )
    db.add(log_entry)
    await db.commit()

    inv.current_stock = new_stock
    inv.version_id = new_version
    return inv
