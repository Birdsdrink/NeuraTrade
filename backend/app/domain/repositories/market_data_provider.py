from abc import ABC, abstractmethod
from typing import List
from datetime import datetime

from ...infrastructure.deriv.models import CandleModel, TickModel, SymbolModel


class MarketDataProvider(ABC):

    @abstractmethod
    async def get_symbols(self) -> List[SymbolModel]:
        raise NotImplementedError

    @abstractmethod
    async def get_historical_candles(self, symbol: str, timeframe_seconds: int, count: int) -> List[CandleModel]:
        raise NotImplementedError

    @abstractmethod
    async def subscribe_ticks(self, symbol: str, callback):
        """
        Subscribe to tick updates for `symbol`.
        `callback` is an async callable that receives a TickModel.
        Returns an unsubscribe callable.
        """
        raise NotImplementedError
