import asyncio
import logging

from deriv_api.ws.client import DerivWebsocket


async def main():
    logging.basicConfig(level=logging.INFO)
    client = DerivWebsocket()
    await client.connect()

    fut = asyncio.get_event_loop().create_future()

    def _on_msg(msg):
        print("RECV:", msg)
        if isinstance(msg, dict) and msg.get("active_symbols") is not None:
            if not fut.done():
                fut.set_result(msg)

    client.on_message(_on_msg)

    await client.send({"active_symbols": "brief"})

    try:
        res = await asyncio.wait_for(fut, timeout=10)
        print("RESULT:", res)
    except Exception as e:
        print("Timed out or error:", e)

    await client.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
