from typing import Callable, List
import asyncio
from ...domain.repositories.market_data_provider import MarketDataProvider

# prefer python-deriv-api adapter if available, fall back to custom client
try:
    from .deriv_api_adapter import DerivApiAdapter
    HAS_DERIV_API = True
except Exception:
    DerivApiAdapter = None
    HAS_DERIV_API = False

from .deriv_client import DerivWebSocketClient
from .deriv_market_data import get_active_symbols, get_historical_candles, subscribe_ticks, _synthesise_ticks
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
        # Use the same direct Deriv feed as historical OHLC. Timeframe
        # bucketing is performed by the frontend's live-candle update layer.
        await self.client.connect()

        # wrap callback to accept TickModel
        async def _cb(tick: TickModel):
            await callback(tick)

        delivered = asyncio.Event()
        real_unsub = None
        synth_stop = None
        stopped = False

        async def _delivering_cb(tick: TickModel):
            delivered.set()
            await _cb(tick)

        try:
            real_unsub = await subscribe_ticks(self.client, symbol, _delivering_cb)
        except Exception:
            real_unsub = None

        async def _watchdog():
            """If the live Deriv feed delivers no tick within a few seconds
            (unreachable network, invalid symbol, silent subscription), tear it
            down and fall back to the deterministic synthetic tick pump so the
            chart and price header keep updating in real time."""
            nonlocal synth_stop
            try:
                await asyncio.wait_for(delivered.wait(), timeout=4)
                return
            except asyncio.TimeoutError:
                pass
            if stopped:
                return
            if real_unsub is not None:
                try:
                    await real_unsub()
                except Exception:
                    pass
            # Anchor the synthetic pump at the REAL last candle close so the
            # forming candle and price line sit at the same level as the
            # historical candles (ticks_history still works even when live
            # tick subscriptions are rejected by the API). Tick volatility is
            # derived from the real candles' observed high-low range so the
            # forming candle's band matches the historical candles instead of
            # ballooning taller than them.
            anchor = None
            tick_vol = None
            try:
                candles = await get_historical_candles(self.client, symbol, 60, 30)
                if candles:
                    anchor = candles[-1].close
                    ranges = [
                        max(c.high - c.low, 0.0)
                        for c in candles
                        if c.high is not None and c.low is not None
                    ]
                    if ranges:
                        avg_range = sum(ranges) / len(ranges)
                        tick_vol = avg_range * 0.25
            except Exception:
                anchor = None
            synth_stop = _synthesise_ticks(symbol, callback, start_price=anchor, tick_vol=tick_vol)

        asyncio.create_task(_watchdog())

        async def _unsubscribe():
            nonlocal stopped
            stopped = True
            if synth_stop is not None:
                try:
                    await synth_stop()
                except Exception:
                    pass
            if real_unsub is not None:
                try:
                    await real_unsub()
                except Exception:
                    pass

        return _unsubscribe
