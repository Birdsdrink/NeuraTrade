from typing import Callable, List
from ...domain.repositories.market_data_provider import MarketDataProvider

# prefer python-deriv-api adapter if available, fall back to custom client
try:
    from .deriv_api_adapter import DerivApiAdapter
    HAS_DERIV_API = True
except Exception:
    DerivApiAdapter = None
    HAS_DERIV_API = False

from .deriv_client import DerivWebSocketClient
from .deriv_market_data import get_active_symbols, get_historical_candles, subscribe_ticks
from .models import SymbolModel, CandleModel, TickModel


class DerivMarketDataProvider(MarketDataProvider):
    def __init__(self, url: str = None):
        if HAS_DERIV_API and DerivApiAdapter is not None:
            try:
                self.client = DerivApiAdapter(url) if url else DerivApiAdapter()
            except Exception:
                # fallback to custom client
                self.client = DerivWebSocketClient(url) if url else DerivWebSocketClient()
        else:
            self.client = DerivWebSocketClient(url) if url else DerivWebSocketClient()

    async def get_symbols(self) -> List[SymbolModel]:
        return await get_active_symbols(self.client)

    async def get_historical_candles(self, symbol: str, timeframe_seconds: int, count: int) -> List[CandleModel]:
        return await get_historical_candles(self.client, symbol, timeframe_seconds, count)

    async def subscribe_ticks(self, symbol: str, callback: Callable):
        # ensure connected
        await self.client.connect()

        # wrap callback to accept TickModel
        async def _cb(tick: TickModel):
            await callback(tick)

        unsub = await subscribe_ticks(self.client, symbol, _cb)
        return unsub
