"""
Kitchen Queue — Order DB models

[TRANSACTIONAL DATA] — orders and state transitions are wiped on reset.
"""
import uuid
from datetime import datetime
from enum import Enum as PyEnum
from sqlalchemy import String, Integer, DateTime, func, Text, Enum
from sqlalchemy.orm import Mapped, mapped_column
from app.db.database import Base


class OrderStatus(str, PyEnum):
    PENDING = "pending"
    STOCK_VERIFIED = "stock_verified"
    IN_KITCHEN = "in_kitchen"
    READY = "ready"
    FAILED = "failed"


class Order(Base):
    """
    [TRANSACTIONAL DATA] — wiped on reset.
    Tracks order state through the kitchen pipeline.
    """
    __tablename__ = "orders"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    student_id: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    status: Mapped[str] = mapped_column(
        Enum(OrderStatus, name="order_status"), default=OrderStatus.PENDING, nullable=False
    )
    special_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class OrderItem(Base):
    """
    [TRANSACTIONAL DATA] — wiped on reset.
    """
    __tablename__ = "order_items"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    order_id: Mapped[str] = mapped_column(String(36), index=True, nullable=False)
    menu_item_id: Mapped[str] = mapped_column(String(36), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
