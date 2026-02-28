"""
Kitchen Queue — Configuration
"""
from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # ── Service ──────────────────────────────────────────────
    SERVICE_NAME: str = "kitchen-queue"
    SERVICE_VERSION: str = "1.0.0"
    DEBUG: bool = False
    HOST: str = "0.0.0.0"
    PORT: int = 8004

    # ── PostgreSQL (Order DB) ─────────────────────────────────
    POSTGRES_HOST: str = "kitchen-db"
    POSTGRES_PORT: int = 5432
    POSTGRES_DB: str = "kitchen_db"
    POSTGRES_USER: str = "kitchen_user"
    POSTGRES_PASSWORD: str = "kitchen_pass"

    @property
    def database_url(self) -> str:
        return (
            f"postgresql+asyncpg://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}"
            f"@{self.POSTGRES_HOST}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"
        )

    @property
    def sync_database_url(self) -> str:
        return (
            f"postgresql://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}"
            f"@{self.POSTGRES_HOST}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"
        )

    # ── Redis / Celery Broker ──────────────────────────────────
    REDIS_HOST: str = "redis"
    REDIS_PORT: int = 6379
    REDIS_DB: int = 0
    REDIS_PASSWORD: str = ""

    @property
    def redis_url(self) -> str:
        if self.REDIS_PASSWORD:
            return f"redis://:{self.REDIS_PASSWORD}@{self.REDIS_HOST}:{self.REDIS_PORT}/{self.REDIS_DB}"
        return f"redis://{self.REDIS_HOST}:{self.REDIS_PORT}/{self.REDIS_DB}"

    @property
    def celery_broker_url(self) -> str:
        return self.redis_url

    @property
    def celery_result_backend(self) -> str:
        return self.redis_url

    # ── Kitchen Timing ──────────────────────────────────────
    KITCHEN_MIN_PREP_SECONDS: int = 3
    KITCHEN_MAX_PREP_SECONDS: int = 7

    # ── Downstream Services ────────────────────────────────────
    NOTIFICATION_HUB_URL: str = "http://notification-hub:8005"
    STOCK_SERVICE_URL: str = "http://stock-service:8003"

    # ── Observability ─────────────────────────────────────────
    METRICS_ENABLED: bool = True
    HEALTH_CHECK_TIMEOUT: float = 5.0


@lru_cache()
def get_settings() -> Settings:
    return Settings()
