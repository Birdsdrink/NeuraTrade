from dataclasses import dataclass
from datetime import datetime


@dataclass
class Candle:
    symbol: str
    timeframe: int
    timestamp: datetime
    open: float
    high: float
    low: float
    close: float
    volume: float | None = None
