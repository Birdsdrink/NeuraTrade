from pydantic import BaseModel
from datetime import datetime
from typing import Optional


class SymbolModel(BaseModel):
    symbol: str
    display_name: Optional[str] = None
    market: Optional[str] = None
    market_display_name: Optional[str] = None
    exchange_is_open: Optional[bool] = None
    is_fallback: bool = False


class TickModel(BaseModel):
    symbol: str
    epoch: int
    quote: float


class CandleModel(BaseModel):
    timestamp: datetime
    open: float
    high: float
    low: float
    close: float
    volume: Optional[float] = None
