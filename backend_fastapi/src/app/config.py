from functools import lru_cache
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

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")


@lru_cache
def get_settings() -> Settings:
    return Settings()
