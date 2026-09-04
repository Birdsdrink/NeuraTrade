import asyncio
from typing import Callable, Dict, List
from ..domain.entities.candle import Candle as DomainCandle
from ..domain.repositories.market_data_provider import MarketDataProvider
from ..infrastructure.deriv.deriv_market_data import subscribe_ticks, get_historical_candles
from ..infrastructure.deriv.candle_builder import CandleBuilder
from ..infrastructure.deriv.deriv_mapper import map_candle_model_to_domain
from ..infrastructure.deriv.models import TickModel
from datetime import datetime


class MarketDataService:
    def __init__(self, provider: MarketDataProvider):
        self.provider = provider
        self._candle_builders: Dict[str, CandleBuilder] = {}
        self._subscriptions = {}

    async def get_historical(self, symbol: str, timeframe_seconds: int, count: int) -> List[DomainCandle]:
        models = await self.provider.get_historical_candles(symbol, timeframe_seconds, count)
        return [map_candle_model_to_domain(m) for m in models]

    async def subscribe_candles(self, symbol: str, timeframe_seconds: int, callback: Callable):
        """Subscribe and receive completed DomainCandle objects via callback (async callable).
        Returns an unsubscribe callable.
        """
        tb_key = f"{symbol}:{timeframe_seconds}"
        cb = CandleBuilder(timeframe_seconds=timeframe_seconds)

        async def _on_tick(tick: TickModel):
            finished = cb.add_tick(tick)
            for f in finished:
                # map to domain and call
                dom = DomainCandle(timestamp=datetime.fromtimestamp(f["ts"]), open=f["open"], high=f["high"], low=f["low"], close=f["close"], volume=f.get("volume"))
                await callback(dom)

        unsub = await self.provider.subscribe_ticks(symbol, _on_tick)

        async def _unsubscribe():
            try:
                if asyncio.iscoroutinefunction(unsub):
                    await unsub()
                else:
                    unsub()
            except Exception:
                pass

        self._subscriptions[tb_key] = _unsubscribe
        return _unsubscribe
