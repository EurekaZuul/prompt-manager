from functools import lru_cache
from pathlib import Path
from typing import List

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application configuration loaded from environment variables or .env."""

    server_host: str = "0.0.0.0"
    server_port: int = 8080
    log_level: str = "info"

    mongo_uri: str = "mongodb://localhost:27017"
    mongo_db: str = "prompt_manager"

    aliyun_api_key: str = ""
    aliyun_api_url: str = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    aliyun_model: str = "qwen-turbo"
    aliyun_system_prompt: str = ""

    cors_allow_origins: List[str] = Field(default_factory=lambda: ["*"])
    frontend_dist_path: str = Field(default_factory=lambda: str(Path(__file__).resolve().parents[3] / "frontend" / "dist"))

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    @field_validator("cors_allow_origins", mode="before")
    @classmethod
    def split_cors(cls, value: str | list[str]) -> list[str]:
        if isinstance(value, str):
            # Support comma-separated env string
            parts = [item.strip() for item in value.split(",")]
            return [item for item in parts if item]
        return value


@lru_cache
def get_settings() -> Settings:
    return Settings()
