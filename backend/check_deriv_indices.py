import asyncio
import os
import sys

# make backend package importable
sys.path.insert(0, os.path.abspath("backend"))

from app.infrastructure.deriv.deriv_market_data_provider import DerivMarketDataProvider


async def main():
    provider = DerivMarketDataProvider()
    try:
        await provider.client.connect()
    except Exception as e:
        print("Deriv connect failed:", e)

    try:
        symbols = await provider.get_symbols()
    except Exception as e:
        print("Failed to fetch symbols:", e)
        symbols = []

    keywords = ['volatility', 'boom', 'crash', 'v75', 'v10', 'volatile']
    matches = []
    for s in symbols:
        text = (s.display_name or s.symbol or '').lower()
        if any(k in text for k in keywords):
            matches.append(s)

    print(f"Found {len(matches)} matching symbols on Deriv:")
    for m in matches[:200]:
        print(m.symbol, "-", m.display_name)

    await provider.client.disconnect()


if __name__ == '__main__':
    asyncio.run(main())
