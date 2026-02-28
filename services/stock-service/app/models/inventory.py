"""
Stock Service — Database models

[TRANSACTIONAL DATA] stock_deduction_log — wiped on reset
[CONFIG DATA]        inventory — preserved (initial quantities restored via seed)
"""
import uuid
from datetime import datetime
from sqlalchemy import String, Integer, DateTime, func, Text
from sqlalchemy.orm import Mapped, mapped_column
from app.db.database import Base


class MenuItem(Base):
    """
    [CONFIG DATA] — Menu items and initial inventory setup.
    Preserved across resets; quantities reset by seed script.
    """
    __tablename__ = "menu_items"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=True)
    price: Mapped[int] = mapped_column(Integer, nullable=False)  # in paisa (integer cents)
    category: Mapped[str] = mapped_column(String(100), nullable=False, default="main")
    is_active: Mapped[bool] = mapped_column(default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Inventory(Base):
    """
    [TRANSACTIONAL DATA during ordering] / [CONFIG DATA for initial_stock]
    version_id is the optimistic locking column — incremented on every update.
    """
    __tablename__ = "inventory"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    menu_item_id: Mapped[str] = mapped_column(String(36), unique=True, index=True, nullable=False)
    current_stock: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    initial_stock: Mapped[int] = mapped_column(Integer, nullable=False, default=0)  # for reset
    version_id: Mapped[int] = mapped_column(Integer, nullable=False, default=1)  # optimistic lock
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class StockDeductionLog(Base):
    """
    [TRANSACTIONAL DATA] — Wiped on reset.
    Audit trail for every successful deduction.
    """
    __tablename__ = "stock_deduction_log"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    order_id: Mapped[str] = mapped_column(String(36), index=True, nullable=False)
    menu_item_id: Mapped[str] = mapped_column(String(36), nullable=False)
    quantity_deducted: Mapped[int] = mapped_column(Integer, nullable=False)
    student_id: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
