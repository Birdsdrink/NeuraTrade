import asyncio
from typing import Callable
from .deriv_client import DerivWebSocketClient


class DerivWebSocketManager:
    def __init__(self, url: str = None):
        self.client = DerivWebSocketClient(url) if url else DerivWebSocketClient()
        self._subs = {}
        self._lock = asyncio.Lock()

    async def ensure_connected(self):
        await self.client.connect()

    async def subscribe_ticks(self, symbol: str, callback: Callable):
        await self.ensure_connected()
        return await self.client.add_listener(lambda msg: asyncio.create_task(callback(msg)))

    async def unsubscribe(self, handler):
        handler()

    async def close(self):
        await self.client.disconnect()
