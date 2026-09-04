import asyncio
import logging
from typing import List
from datetime import datetime

import aiohttp

from ...domain.interfaces.market_data_provider import MarketDataProvider
from ...domain.entities.instrument import Instrument
from ...domain.entities.tick import Tick
from ...domain.entities.candle import Candle
from ..websocket.websocket_manager import WebSocketManager
from ...config.settings import settings

logger = logging.getLogger(__name__)


class BinanceProvider(MarketDataProvider):
    def __init__(self):
        self.rest_url = settings.BINANCE_REST_URL
        self.ws_base = settings.BINANCE_WS_URL
        self._ws_managers = {}

    async def get_instruments(self) -> List[Instrument]:
        async with aiohttp.ClientSession() as s:
            async with s.get(f"{self.rest_url}/api/v3/exchangeInfo") as r:
                data = await r.json()
        instruments = []
        for sym in data.get("symbols", []):
            instruments.append(Instrument(symbol=sym["symbol"], name=f"{sym['baseAsset']}/{sym['quoteAsset']}", base_currency=sym['baseAsset'], quote_currency=sym['quoteAsset'], status=sym.get('status')))
        return instruments

    async def get_historical_ticks(self, symbol: str, start: int, end: int) -> List[Tick]:
        # Binance provides aggTrades or trades; here fetch recent trades
        params = {"symbol": symbol, "startTime": start * 1000, "endTime": end * 1000}
        async with aiohttp.ClientSession() as s:
            async with s.get(f"{self.rest_url}/api/v3/trades", params={"symbol": symbol, "limit": 1000}) as r:
                data = await r.json()
        ticks = []
        for t in data:
            ticks.append(Tick(symbol=symbol, timestamp=datetime.fromtimestamp(t['time']/1000), price=float(t['price'])))
        return ticks

    async def subscribe_ticks(self, symbol: str, callback):
        # create ws manager per symbol
        stream = f"{symbol.lower()}@trade"
        url = f"{self.ws_base}/{stream}"
        manager = WebSocketManager(url)
        await manager.connect()

        async def _on_msg(msg):
            try:
                # Binance trade payload
                if isinstance(msg, dict) and msg.get('e') == 'trade':
                    ts = datetime.fromtimestamp(msg['T']/1000)
                    tick = Tick(symbol=symbol, timestamp=ts, price=float(msg['p']))
                    await callback(tick)
            except Exception:
                logger.exception("Error handling trade message")

        manager.add_listener(_on_msg)

        async def _unsubscribe():
            await manager.disconnect()

        self._ws_managers[symbol] = manager
        return _unsubscribe

    async def get_candles(self, symbol: str, timeframe: int) -> List[Candle]:
        # timeframe in seconds, map to Binance interval
        # simple mapping for common intervals
        mapping = {60: '1m', 300: '5m', 900: '15m', 3600: '1h', 86400: '1d'}
        interval = mapping.get(timeframe, '1m')
        async with aiohttp.ClientSession() as s:
            async with s.get(f"{self.rest_url}/api/v3/klines", params={"symbol": symbol, "interval": interval, "limit": 500}) as r:
                data = await r.json()
        candles = []
        for item in data:
            candles.append(Candle(symbol=symbol, timeframe=timeframe, timestamp=datetime.fromtimestamp(item[0]/1000), open=float(item[1]), high=float(item[2]), low=float(item[3]), close=float(item[4]), volume=float(item[5])))
        return candles
