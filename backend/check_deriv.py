import asyncio
import sys
from pathlib import Path
# ensure backend folder is importable
ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from app.infrastructure.deriv.deriv_client import DerivWebSocketClient, deriv_request

async def main():
    client = DerivWebSocketClient()
    try:
        await client.connect()
        print('Connected to Deriv')
        # try a few active_symbols queries with different product_type filters
        for pt in [None, 'forex', 'major_pairs', 'synthetic', 'commodities', 'indices']:
            req = {"active_symbols": "brief"}
            if pt:
                req['product_type'] = pt
            try:
                res = await deriv_request(client, req, timeout=10)
                # print full raw response for inspection
                print(f"product_type={pt!r} -> raw response:")
                print(res)
            except Exception as e:
                print(f"product_type={pt!r} -> error: {e}")

        # try a ticks_history for a common symbol name - may not exist depending on active symbols
        try:
            sample = await deriv_request(client, {"ticks_history": "R_100", "count": 10, "end": "latest"}, timeout=10)
            print('ticks_history keys:', list(sample.keys()))
        except Exception as e:
            print('ticks_history error:', e)
    except Exception as e:
        print('Error:', e)
    finally:
        try:
            await client.disconnect()
        except Exception:
            pass

if __name__ == '__main__':
    asyncio.run(main())
