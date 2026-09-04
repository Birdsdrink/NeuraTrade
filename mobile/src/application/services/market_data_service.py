import logging
from typing import List

from ...domain.entities.instrument import Instrument
from ...domain.entities.tick import Tick
from ...domain.entities.candle import Candle
from ...domain.interfaces.market_data_provider import MarketDataProvider

logger = logging.getLogger(__name__)


class MarketDataService:
    def __init__(self, provider: MarketDataProvider):
        self.provider = provider

    async def list_instruments(self) -> List[Instrument]:
        return await self.provider.get_instruments()

    async def get_candles(self, symbol: str, timeframe: int) -> List[Candle]:
        return await self.provider.get_candles(symbol, timeframe)

    async def subscribe_ticks(self, symbol: str, callback):
        return await self.provider.subscribe_ticks(symbol, callback)
