from functools import lru_cache
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "Media Tool API"
    app_env: str = "development"
    database_url: str = "postgresql+psycopg2://postgres:postgres@postgres:5432/media_tool"
    db_connect_timeout_seconds: int = 10
    redis_url: str = "redis://redis:6379/0"
    queue_name: str = "media-queue"
    media_root: str = "/data/media"
    aws_access_key_id: str | None = None
    aws_secret_access_key: str | None = None
    aws_default_region: str = "ap-southeast-2"
    aws_s3_bucket_name: str | None = None
    s3_presign_expires_seconds: int = 3600
    max_image_width: int = 1920
    default_watermark: str = "Media Tool"
    jwt_secret: str = "dev-guest-secret-change-me"
    jwt_algorithm: str = "HS256"
    api_cors_origins: list[str] = Field(
        default_factory=lambda: [
            "http://localhost:3000",
            "http://127.0.0.1:3000",
        ]
    )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
