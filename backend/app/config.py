from typing import List
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    FRONTEND_URL: str = "http://localhost:3000"
    API_VERSION: str = "0.1.0"
    app_name: str = "CommodityIQ API"
    debug: bool = False
    cors_origins: List[str] = ["http://localhost:3000", "http://127.0.0.1:3000"]

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        extra = "allow"


settings = Settings()
