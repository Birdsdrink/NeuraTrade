from dataclasses import dataclass
from typing import Optional


@dataclass
class Instrument:
    symbol: str
    name: Optional[str] = None
    category: Optional[str] = None
    quote_currency: Optional[str] = None
    base_currency: Optional[str] = None
    minimum_price_increment: Optional[float] = None
    status: Optional[str] = None
