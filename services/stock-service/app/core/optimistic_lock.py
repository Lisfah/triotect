"""
Stock Service — Optimistic locking retry decorator

Uses exponential backoff + jitter to handle SQLAlchemy StaleDataError.
StaleDataError occurs when version_id in DB was incremented by another
concurrent transaction between our read and write.
"""
import asyncio
import random
import functools
import logging
class StaleDataError(Exception):
    """Raised when an optimistic lock conflict is detected:
    the version_id in the DB changed between our read and update,
    meaning another concurrent transaction won the race.
    """
    pass
from app.core.config import get_settings

settings = get_settings()
logger = logging.getLogger(__name__)


def with_optimistic_retry(max_retries: int | None = None):
    """
    Decorator for async functions that perform optimistic-lock DB writes.
    On StaleDataError, retries with exponential backoff + jitter.

    Usage:
        @with_optimistic_retry()
        async def deduct_stock(db, ...):
            ...
    """
    _max = max_retries or settings.OPT_LOCK_MAX_RETRIES

    def decorator(func):
        @functools.wraps(func)
        async def wrapper(*args, **kwargs):
            for attempt in range(1, _max + 1):
                try:
                    return await func(*args, **kwargs)
                except StaleDataError:
                    if attempt == _max:
                        logger.error(
                            "Optimistic lock conflict unresolved after %d retries for %s",
                            _max, func.__name__,
                        )
                        raise
                    # Exponential backoff: base * 2^attempt + jitter
                    base_delay = settings.OPT_LOCK_BASE_DELAY_MS / 1000.0
                    max_delay = settings.OPT_LOCK_MAX_DELAY_MS / 1000.0
                    jitter = random.uniform(0, settings.OPT_LOCK_JITTER_MS / 1000.0)
                    delay = min(base_delay * (2 ** attempt), max_delay) + jitter
                    logger.warning(
                        "StaleDataError on attempt %d/%d — retrying in %.3fs",
                        attempt, _max, delay,
                    )
                    await asyncio.sleep(delay)
        return wrapper
    return decorator
