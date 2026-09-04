import asyncio
import logging

from src.config.settings import settings
from src.infrastructure.providers.binance_provider import BinanceProvider
from src.application.services.market_data_service import MarketDataService


logging.basicConfig(level=logging.INFO)


async def demo():
    provider = BinanceProvider()
    service = MarketDataService(provider)

    instruments = await service.list_instruments()
    print("Found instruments:", len(instruments))
    for i in instruments[:5]:
        print(i)

    if instruments:
        sym = instruments[0].symbol
        candles = await service.get_candles(sym, 60)
        print(f"Latest candles for {sym}:", len(candles))

        async def on_tick(tick):
            print("Tick:", tick)

        unsub = await service.subscribe_ticks(sym, on_tick)

        # run for a short while to receive ticks
        await asyncio.sleep(10)
        await unsub()


if __name__ == "__main__":
    asyncio.run(demo())
