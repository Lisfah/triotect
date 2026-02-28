"""
Notification Hub — Configuration
"""
from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # ── Service ──────────────────────────────────────────────
    SERVICE_NAME: str = "notification-hub"
    SERVICE_VERSION: str = "1.0.0"
    DEBUG: bool = False
    HOST: str = "0.0.0.0"
    PORT: int = 8005

    # ── Redis (pub/sub) ────────────────────────────────────────
    REDIS_HOST: str = "redis"
    REDIS_PORT: int = 6379
    REDIS_DB: int = 0
    REDIS_PASSWORD: str = ""

    @property
    def redis_url(self) -> str:
        if self.REDIS_PASSWORD:
            return f"redis://:{self.REDIS_PASSWORD}@{self.REDIS_HOST}:{self.REDIS_PORT}/{self.REDIS_DB}"
        return f"redis://{self.REDIS_HOST}:{self.REDIS_PORT}/{self.REDIS_DB}"

    # ── SSE ───────────────────────────────────────────────────
    SSE_KEEPALIVE_INTERVAL_SECONDS: int = 15
    SSE_RETRY_MILLISECONDS: int = 3000

    # ── Chaos Engineering ─────────────────────────────────────
    CHAOS_FLAG_KEY: str = "chaos:notification-hub"
    CHAOS_ENABLED_DEFAULT: bool = False

    # ── Observability ─────────────────────────────────────────
    METRICS_ENABLED: bool = True
    HEALTH_CHECK_TIMEOUT: float = 5.0


@lru_cache()
def get_settings() -> Settings:
    return Settings()
