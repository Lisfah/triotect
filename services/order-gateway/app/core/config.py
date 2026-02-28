"""
Order Gateway — Core config (reuse pattern from identity-provider)
"""
from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    SERVICE_NAME: str = "order-gateway"
    SERVICE_VERSION: str = "1.0.0"
    DEBUG: bool = False
    HOST: str = "0.0.0.0"
    PORT: int = 8002

    JWT_SECRET_KEY: str = "CHANGE_ME_IN_PRODUCTION"
    JWT_ALGORITHM: str = "HS256"

    REDIS_HOST: str = "redis"
    REDIS_PORT: int = 6379
    REDIS_DB: int = 0
    REDIS_PASSWORD: str = ""

    @property
    def redis_url(self) -> str:
        if self.REDIS_PASSWORD:
            return f"redis://:{self.REDIS_PASSWORD}@{self.REDIS_HOST}:{self.REDIS_PORT}/{self.REDIS_DB}"
        return f"redis://{self.REDIS_HOST}:{self.REDIS_PORT}/{self.REDIS_DB}"

    STOCK_CACHE_TTL_SECONDS: int = 10
    IDEMPOTENCY_KEY_TTL_SECONDS: int = 86400

    STOCK_SERVICE_URL: str = "http://stock-service:8003"
    KITCHEN_QUEUE_URL: str = "http://kitchen-queue:8004"
    NOTIFICATION_HUB_URL: str = "http://notification-hub:8005"

    HTTP_TIMEOUT_SECONDS: float = 5.0
    HEALTH_CHECK_TIMEOUT: float = 5.0
    METRICS_ENABLED: bool = True


@lru_cache()
def get_settings() -> Settings:
    return Settings()
