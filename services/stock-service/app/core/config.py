"""
Stock Service — Configuration
"""
from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # ── Service ──────────────────────────────────────────────
    SERVICE_NAME: str = "stock-service"
    SERVICE_VERSION: str = "1.0.0"
    DEBUG: bool = False
    HOST: str = "0.0.0.0"
    PORT: int = 8003

    # ── PostgreSQL ────────────────────────────────────────────
    POSTGRES_HOST: str = "stock-db"
    POSTGRES_PORT: int = 5432
    POSTGRES_DB: str = "stock_db"
    POSTGRES_USER: str = "stock_user"
    POSTGRES_PASSWORD: str = "stock_pass"

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

    # ── Redis ─────────────────────────────────────────────────
    REDIS_HOST: str = "redis"
    REDIS_PORT: int = 6379
    REDIS_DB: int = 0
    REDIS_PASSWORD: str = ""

    @property
    def redis_url(self) -> str:
        if self.REDIS_PASSWORD:
            return f"redis://:{self.REDIS_PASSWORD}@{self.REDIS_HOST}:{self.REDIS_PORT}/{self.REDIS_DB}"
        return f"redis://{self.REDIS_HOST}:{self.REDIS_PORT}/{self.REDIS_DB}"

    # ── Optimistic Locking Retry ──────────────────────────────
    OPT_LOCK_MAX_RETRIES: int = 5
    OPT_LOCK_BASE_DELAY_MS: int = 50      # base exponential backoff delay in ms
    OPT_LOCK_MAX_DELAY_MS: int = 1000     # max backoff cap in ms
    OPT_LOCK_JITTER_MS: int = 50          # random jitter range in ms

    # ── Redis Stock Cache ──────────────────────────────────────
    STOCK_CACHE_TTL_SECONDS: int = 10

    # ── Observability ─────────────────────────────────────────
    METRICS_ENABLED: bool = True
    HEALTH_CHECK_TIMEOUT: float = 5.0


@lru_cache()
def get_settings() -> Settings:
    return Settings()
