import os
from typing import Optional


class Settings:
    BINANCE_API_KEY: Optional[str] = os.getenv("BINANCE_API_KEY")
    BINANCE_WS_URL: str = os.getenv("BINANCE_WS_URL", "wss://stream.binance.com:9443/ws")
    BINANCE_REST_URL: str = os.getenv("BINANCE_REST_URL", "https://api.binance.com")
    DATABASE_URL: str = os.getenv("DATABASE_URL", "sqlite+aiosqlite:///./market_data.db")


settings = Settings()
