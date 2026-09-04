from abc import ABC, abstractmethod
from typing import Callable, Iterable, List

from ..entities.instrument import Instrument
from ..entities.tick import Tick
from ..entities.candle import Candle


class MarketDataProvider(ABC):
    @abstractmethod
    async def get_instruments(self) -> List[Instrument]:
        raise NotImplementedError

    @abstractmethod
    async def get_historical_ticks(self, symbol: str, start: int, end: int) -> List[Tick]:
        raise NotImplementedError

    @abstractmethod
    async def subscribe_ticks(self, symbol: str, callback: Callable[[Tick], None]):
        raise NotImplementedError

    @abstractmethod
    async def get_candles(self, symbol: str, timeframe: int) -> List[Candle]:
        raise NotImplementedError
