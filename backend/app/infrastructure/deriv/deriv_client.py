import asyncio
import json
import logging
from typing import Any, Dict, Callable

import websockets

logger = logging.getLogger(__name__)

DERIV_WS_URL = "wss://ws.binaryws.com/websockets/v3?app_id=1089"


class DerivWebSocketClient:
    """Robust wrapper around a single websocket connection to Deriv with
    listener management, reconnect/backoff, and request/response helpers.
    """

    def __init__(self, url: str = DERIV_WS_URL, max_retries: int = 8):
        self.url = url
        self._ws = None
        self._lock = asyncio.Lock()
        self._connected = asyncio.Event()
        self._recv_task = None
        self._listeners = []
        self._closed = False
        self._max_retries = max_retries

    async def connect(self):
        async with self._lock:
            if self._ws and not getattr(self._ws, "closed", False):
                return
            attempt = 0
            while not self._closed:
                try:
                    logger.info("Connecting to Deriv WS: %s", self.url)
                    self._ws = await websockets.connect(self.url)
                    self._connected.set()
                    self._recv_task = asyncio.create_task(self._recv_loop())
                    logger.info("Connected to Deriv WS")
                    return
                except Exception as e:
                    attempt += 1
                    backoff = min(60, (2 ** attempt))
                    logger.warning(
                        "Deriv WS connect failed (attempt %s): %s. Retrying in %ss",
                        attempt,
                        e,
                        backoff,
                    )
                    await asyncio.sleep(backoff)
                    if self._max_retries and attempt >= self._max_retries:
                        logger.error("Max retries reached connecting to Deriv WS")
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
                        res = cb(data)
                        # Listeners may be sync (return None) or async (return a
                        # coroutine). Never pass None to create_task — that raises
                        # "a coroutine was expected" and kills the whole recv loop.
                        if asyncio.iscoroutine(res):
                            asyncio.create_task(res)
                    except Exception:
                        logger.exception("Listener raised when scheduling task")
        except Exception:
            logger.exception("Receive loop error, will attempt reconnect")
        finally:
            self._connected.clear()
            # websockets v14+ no longer exposes the old `closed` attribute.
            # Clear the stale socket explicitly so connect() establishes a new
            # session instead of reusing a dead connection after a ping timeout.
            self._ws = None
            if not self._closed:
                asyncio.create_task(self.connect())

    @property
    def is_connected(self) -> bool:
        """True when the WebSocket is currently open and ready for requests."""
        return self._connected.is_set() and self._ws is not None and not self._closed

    async def send(self, payload: Dict[str, Any]):
        await self._connected.wait()
        payload_json = json.dumps(payload)
        try:
            await self._ws.send(payload_json)
        except Exception:
            logger.exception("Failed to send payload, reconnecting and retrying once")
            await self.connect()
            await self._ws.send(payload_json)

    def add_listener(self, cb: Callable[[Any], Any]):
        """Register a listener callback. Returns an unsubscribe callable."""
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


async def deriv_request(client: DerivWebSocketClient, req: Dict[str, Any], timeout: int = 10) -> Dict[str, Any]:
    fut = asyncio.get_event_loop().create_future()

    async def cb(msg):
        if isinstance(msg, dict) and msg.get("echo_req") == req:
            if not fut.done():
                fut.set_result(msg)

    unsubscribe = client.add_listener(cb)
    try:
        # A disconnected provider must not leave an HTTP candle request waiting
        # forever on the client's connection event.
        await asyncio.wait_for(client.send(req), timeout=timeout)
        res = await asyncio.wait_for(fut, timeout=timeout)
        return res
    finally:
        unsubscribe()
