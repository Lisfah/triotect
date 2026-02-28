"""
Order Gateway — Pydantic Schemas
"""
import uuid
from pydantic import BaseModel, Field
from typing import Any


class OrderItemRequest(BaseModel):
    menu_item_id: str = Field(..., examples=["item-001"])
    quantity: int = Field(..., ge=1, le=10)


class OrderRequest(BaseModel):
    items: list[OrderItemRequest] = Field(..., min_length=1, max_length=20)
    special_notes: str | None = Field(None, max_length=500)


class OrderResponse(BaseModel):
    order_id: str
    status: str
    message: str
    estimated_wait_seconds: int | None = None


class HealthResponse(BaseModel):
    status: str
    service: str
    version: str
    dependencies: dict[str, str]
