"""
Optional adapter to use `python-deriv-api` if installed. This file provides compatibility helpers
that the rest of the codebase can call instead of the custom `DerivWebSocketClient`.

To enable: install `python-deriv-api` and the provider will automatically prefer this adapter.
"""

try:
    from deriv_api.ws.client import DerivWebsocket
    HAS_DERIV_API = True
except Exception:
    DerivWebsocket = None
    HAS_DERIV_API = False


class DerivApiAdapter:
    """Light adapter exposing a subset of methods used by the codebase:
    - connect()
    - disconnect()
    - send(req)
    - add_listener(cb) -> unsubscribe
    - request(req, timeout)

    This adapter maps the `deriv_api` client's patterns to the expected interface.
    """

    def __init__(self, url: str = None):
        if not HAS_DERIV_API:
            raise RuntimeError("python-deriv-api not available")
        # deriv_api client accepts app_id/url config via env or args; keep simple for now
        self._client = DerivWebsocket()
        self._listeners = []

    async def connect(self):
        # deriv_api manages its own loop; call open
        await self._client.connect()

    async def disconnect(self):
        await self._client.disconnect()

    async def send(self, payload):
        await self._client.send(payload)

    def add_listener(self, cb):
        # deriv_api uses on_message style; we wrap
        def _on_message(msg):
            try:
                cb(msg)
            except Exception:
                pass

        self._client.on_message(_on_message)

        def _remove():
            # deriv_api doesn't have direct removal here; best-effort
            try:
                self._client.off_message(_on_message)
            except Exception:
                pass

        return _remove

    async def request(self, req, timeout=10):
        # deriv_api provides request patterns; use its send then wait for matching echo
        fut = asyncio.get_event_loop().create_future()

        def _cb(msg):
            if isinstance(msg, dict) and msg.get('echo_req') == req:
                if not fut.done():
                    fut.set_result(msg)

        unsub = self.add_listener(_cb)
        await self.send(req)
        try:
            return await asyncio.wait_for(fut, timeout=timeout)
        finally:
            unsub()
