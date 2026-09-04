from dataclasses import dataclass
from datetime import datetime
from typing import Optional


@dataclass
class Candle:
    timestamp: datetime
    open: float
    high: float
    low: float
    close: float
    volume: Optional[float] = None

    def validate(self) -> bool:
        return self.high >= self.open and self.high >= self.close and self.low <= self.open and self.low <= self.close and self.high >= self.low
