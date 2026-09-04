import asyncio
import json
import logging
from typing import Any, Callable

import websockets

logger = logging.getLogger(__name__)


class WebSocketManager:
    def __init__(self, url: str, max_retries: int = 5):
        self.url = url
        self._ws = None
        self._listeners: list[Callable[[Any], None]] = []
        self._lock = asyncio.Lock()
        self._connected = asyncio.Event()
        self._closed = False
        self._recv_task = None
        self._max_retries = max_retries

    async def connect(self):
        async with self._lock:
            if self._ws and not getattr(self._ws, "closed", False):
                return
            attempt = 0
            while not self._closed:
                try:
                    logger.info("Connecting to websocket: %s", self.url)
                    self._ws = await websockets.connect(self.url)
                    self._connected.set()
                    self._recv_task = asyncio.create_task(self._recv_loop())
                    return
                except Exception as e:
                    attempt += 1
                    backoff = min(60, 2 ** attempt)
                    logger.warning("Websocket connect failed (attempt %s): %s. Retrying in %ss", attempt, e, backoff)
                    await asyncio.sleep(backoff)
                    if self._max_retries and attempt >= self._max_retries:
                        logger.error("Max retries reached connecting to websocket")
                        raise

    async def _recv_loop(self):
        try:
            async for msg in self._ws:
                try:
                    data = json.loads(msg)
                except Exception:
                    data = msg
                for cb in list(self._listeners):
                    try:
                        asyncio.create_task(cb(data))
                    except Exception:
                        logger.exception("Listener raised when scheduling task")
        except Exception:
            logger.exception("Receive loop error, will attempt reconnect")
        finally:
            self._connected.clear()
            if not self._closed:
                asyncio.create_task(self.connect())

    async def send(self, payload: Any):
        await self._connected.wait()
        try:
            await self._ws.send(json.dumps(payload))
        except Exception:
            logger.exception("Send failed, reconnecting and retrying once")
            await self.connect()
            await self._ws.send(json.dumps(payload))

    def add_listener(self, cb: Callable[[Any], None]):
        self._listeners.append(cb)

        def _remove():
            try:
                self._listeners.remove(cb)
            except ValueError:
                pass

        return _remove

    async def disconnect(self):
        async with self._lock:
            self._closed = True
            if self._ws:
                try:
                    await self._ws.close()
                except Exception:
                    logger.exception("Error closing websocket")
                self._ws = None
            if self._recv_task:
                self._recv_task.cancel()
                self._recv_task = None
            self._connected.clear()
