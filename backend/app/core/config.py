import os
from dataclasses import dataclass
from functools import lru_cache

from dotenv import load_dotenv

load_dotenv()


@dataclass(frozen=True)
class Settings:
    app_name: str
    environment: str
    api_v1_prefix: str
    database_url: str | None
    jwt_secret_key: str | None
    jwt_algorithm: str
    access_token_expire_minutes: int
    evidencias_path: str = r"\\172.20.10.32\web"
    expo_push_token_encryption_key: str | None = None
    expo_access_token: str | None = None
    expo_poll_interval_seconds: int = 5
    expo_poll_batch_size: int = 100
    cors_origins: tuple[str, ...] = (
        "http://localhost:8081",
        "http://127.0.0.1:8081",
    )
    cors_origin_regex: str | None = None


@lru_cache
def get_settings() -> Settings:
    return Settings(
        app_name=os.getenv("APP_NAME", "AppMovil API"),
        environment=os.getenv("ENVIRONMENT", "development"),
        api_v1_prefix=os.getenv("API_V1_PREFIX", "/api/v1"),
        cors_origins=tuple(
            origin.strip().rstrip("/")
            for origin in os.getenv(
                "CORS_ORIGINS",
                "http://localhost:8081,http://127.0.0.1:8081",
            ).split(",")
            if origin.strip()
        ),
        cors_origin_regex=(
            os.getenv("CORS_ORIGIN_REGEX")
            or r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$"
        ),
        database_url=os.getenv("DATABASE_URL") or None,
        jwt_secret_key=os.getenv("JWT_SECRET_KEY") or None,
        jwt_algorithm=os.getenv("JWT_ALGORITHM", "HS256"),
        access_token_expire_minutes=int(
            os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "30")
        ),
        evidencias_path=os.getenv(
            "EVIDENCIAS_PATH",
            r"\\172.20.10.32\web",
        ),
        expo_push_token_encryption_key=(
            os.getenv("EXPO_PUSH_TOKEN_ENCRYPTION_KEY") or None
        ),
        expo_access_token=os.getenv("EXPO_ACCESS_TOKEN") or None,
        expo_poll_interval_seconds=int(
            os.getenv("EXPO_POLL_INTERVAL_SECONDS", "5")
        ),
        expo_poll_batch_size=int(os.getenv("EXPO_POLL_BATCH_SIZE", "100")),
    )
