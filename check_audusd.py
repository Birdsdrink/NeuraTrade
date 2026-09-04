import asyncio
import sys
from pprint import pprint

import os
sys.path.insert(0, os.path.abspath("."))

from src.infrastructure.providers.binance_provider import BinanceProvider


async def main():
    prov = BinanceProvider()
    instruments = await prov.get_instruments()
    matches = [i for i in instruments if 'AUD' in i.symbol or 'AUD' in (i.base_currency or '') or 'AUD' in (i.quote_currency or '')]
    # filter for usd as well
    audusd = [i for i in matches if 'USD' in i.symbol or 'USD' in (i.base_currency or '') or 'USD' in (i.quote_currency or '')]
    print(f"Found {len(audusd)} symbols that include AUD and USD:")
    for s in audusd[:20]:
        pprint(s)


if __name__ == '__main__':
    asyncio.run(main())
