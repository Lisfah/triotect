"""
Kitchen Queue — Celery tasks (order state machine)

Worker processes these tasks asynchronously, separate from the FastAPI container.
State transitions: PENDING → STOCK_VERIFIED → IN_KITCHEN → READY
On each state change, notifies Notification Hub via HTTP.
"""
import asyncio
import logging
import random
import time

import httpx
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app.core.celery_app import celery_app
from app.core.config import get_settings
from app.models.order import OrderStatus

settings = get_settings()
logger = logging.getLogger(__name__)

# Sync engine for Celery (Celery tasks are not async-native)
sync_engine = create_engine(settings.sync_database_url, pool_pre_ping=True)


def _update_order_status(order_id: str, status: str):
    """Synchronously update order status in DB.

    The Postgres enum type uses UPPER_CASE labels (created before the Python
    model switched to lower-case values).  Raw text() queries bypass SQLAlchemy's
    ORM enum mapping, so we cast to uppercase explicitly.
    """
    db_val = status.upper()          # e.g. "stock_verified" → "STOCK_VERIFIED"
    with Session(sync_engine) as session:
        session.execute(
            text("UPDATE orders SET status = CAST(:status AS order_status), updated_at = NOW() WHERE id = :id"),
            {"status": db_val, "id": order_id},
        )
        session.commit()


def _notify_hub(order_id: str, status: str, student_id: str):
    """Push state change to Notification Hub."""
    try:
        with httpx.Client(timeout=3.0) as client:
            client.post(
                f"{settings.NOTIFICATION_HUB_URL}/notifications/publish",
                json={"order_id": order_id, "status": status, "student_id": student_id},
            )
    except Exception as exc:
        # Notification failures MUST NOT affect order processing
        logger.warning("Notification Hub unreachable: %s", exc)


@celery_app.task(
    name="process_order",
    bind=True,
    max_retries=3,
    default_retry_delay=5,
    acks_late=True,
)
def process_order(self, order_id: str, student_id: str, items: list, special_notes: str | None = None):
    """
    Full kitchen processing pipeline for a single order.
    Runs in a separate Celery worker container, completely isolated from FastAPI.
    """
    try:
        # ── State 1: Stock Verified ──────────────────────────────────────────
        _update_order_status(order_id, OrderStatus.STOCK_VERIFIED)
        _notify_hub(order_id, OrderStatus.STOCK_VERIFIED, student_id)
        logger.info("Order %s: stock verified", order_id)

        # ── State 2: In Kitchen ──────────────────────────────────────────────
        _update_order_status(order_id, OrderStatus.IN_KITCHEN)
        _notify_hub(order_id, OrderStatus.IN_KITCHEN, student_id)
        logger.info("Order %s: in kitchen", order_id)

        # Simulate kitchen prep time (3–7 seconds as per SRS)
        prep_time = random.uniform(settings.KITCHEN_MIN_PREP_SECONDS, settings.KITCHEN_MAX_PREP_SECONDS)
        time.sleep(prep_time)

        # ── State 3: Ready ───────────────────────────────────────────────────
        _update_order_status(order_id, OrderStatus.READY)
        _notify_hub(order_id, OrderStatus.READY, student_id)
        logger.info("Order %s: ready for pickup after %.1fs", order_id, prep_time)

    except Exception as exc:
        logger.exception("Order %s processing failed", order_id)
        _update_order_status(order_id, OrderStatus.FAILED)
        _notify_hub(order_id, OrderStatus.FAILED, student_id)
        raise self.retry(exc=exc)
