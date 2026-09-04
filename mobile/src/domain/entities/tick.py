from dataclasses import dataclass
from datetime import datetime


@dataclass
class Tick:
    symbol: str
    timestamp: datetime
    bid: float | None = None
    ask: float | None = None
    price: float | None = None
