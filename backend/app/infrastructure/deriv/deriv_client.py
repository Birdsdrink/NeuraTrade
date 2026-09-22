import asyncio
import json
import logging
import time
from typing import Any, Dict, Callable

import websockets

logger = logging.getLogger(__name__)

DERIV_WS_URL = "wss://ws.binaryws.com/websockets/v3?app_id=1089"

# Give up on the TLS/WebSocket handshake quickly. The default is 10s, which is
# an eternity to wait when the machine has no working route to the internet.
_OPEN_TIMEOUT_SECONDS = 5

# Seconds to stop asking Deriv for data after a failed attempt (see the circuit
# breaker in `deriv_request`).
_OFFLINE_COOLDOWN_SECONDS = 20.0

# How long a request may wait for an already in-flight handshake before falling
# back. Keeps offline requests at ~1.5s instead of the full upstream timeout.
_CONNECT_GRACE_SECONDS = 1.5
_offline_until = 0.0


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
                    self._ws = await websockets.connect(self.url, open_timeout=_OPEN_TIMEOUT_SECONDS)
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

    async def wait_connected(self, timeout: float) -> bool:
        """Wait up to ``timeout`` for the socket to come up; True once it is.

        Lets callers bound how long they will wait on an unreachable upstream
        instead of blocking on the connection event indefinitely.
        """
        try:
            await asyncio.wait_for(self._connected.wait(), timeout=timeout)
            return True
        except asyncio.TimeoutError:
            return False

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
    global _offline_until

    # Circuit breaker first: while this machine has no route to Deriv, every
    # request would otherwise pay the upstream timeout again before falling
    # back, making the market list and the candlestick chart feel frozen. After
    # one failure, fail instantly for a short cooldown instead.
    if time.monotonic() < _offline_until:
        raise ConnectionError("Deriv is unreachable; request skipped during cooldown")

    if not client.is_connected and not await client.wait_connected(_CONNECT_GRACE_SECONDS):
        # Nothing to send to: fail immediately instead of waiting out `timeout`.
        _offline_until = time.monotonic() + _OFFLINE_COOLDOWN_SECONDS
        raise ConnectionError("Deriv socket is not connected; request skipped")

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
        # A response means the upstream works again (Deriv reports its own
        # errors inside the payload, which does not reach this branch).
        _offline_until = 0.0
        return res
    except (Exception, asyncio.CancelledError):
        # CancelledError derives from BaseException (not Exception), and it is
        # exactly what an outer asyncio.wait_for timeout raises — without it the
        # cooldown would never arm and every request would rewait the timeout.
        _offline_until = time.monotonic() + _OFFLINE_COOLDOWN_SECONDS
        raise
    finally:
        unsubscribe()
