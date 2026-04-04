import os
from typing import List
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="allow",
        case_sensitive=False,
    )

    FRONTEND_URL: str = "http://localhost:3000"
    API_VERSION: str = "0.1.0"
    app_name: str = "CommodityIQ API"
    debug: bool = False
    cors_origins: List[str] = ["http://localhost:3000", "http://127.0.0.1:3000"]
    ANTHROPIC_API_KEY: str = os.environ.get("ANTHROPIC_API_KEY", "")
    CLAUDE_MODEL: str = "claude-sonnet-4-20250514"
    CLAUDE_MAX_TOKENS: int = 4096


settings = Settings()
