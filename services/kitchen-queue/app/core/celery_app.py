"""
Kitchen Queue — Celery application

Uses Redis as both broker and result backend.
Workers run in separate containers (kitchen-worker).
"""
from celery import Celery
from app.core.config import get_settings

settings = get_settings()

celery_app = Celery(
    "kitchen_queue",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
    include=["app.tasks.kitchen_tasks"],
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    task_acks_late=True,           # Only ack after task completes (fault-tolerant)
    task_reject_on_worker_lost=True,
    worker_prefetch_multiplier=1,  # One task at a time per worker
    task_track_started=True,
)
