from typing import List
from datetime import datetime
from .deriv_client import deriv_request, DerivWebSocketClient
from .models import CandleModel, TickModel, SymbolModel


# Comprehensive fallback list covering all tradeable categories.
# Used when the Deriv WebSocket connection is unavailable.
FALLBACK_SYMBOLS = (
    # ── Forex ──────────────────────────────────────────────────────────
    ("frxEURUSD", "EUR/USD", "forex", "Forex"),
    ("frxGBPUSD", "GBP/USD", "forex", "Forex"),
    ("frxUSDJPY", "USD/JPY", "forex", "Forex"),
    ("frxAUDUSD", "AUD/USD", "forex", "Forex"),
    ("frxUSDCAD", "USD/CAD", "forex", "Forex"),
    ("frxUSDCHF", "USD/CHF", "forex", "Forex"),
    ("frxNZDUSD", "NZD/USD", "forex", "Forex"),
    ("frxEURGBP", "EUR/GBP", "forex", "Forex"),
    ("frxEURJPY", "EUR/JPY", "forex", "Forex"),
    ("frxGBPJPY", "GBP/JPY", "forex", "Forex"),
    ("frxEURCHF", "EUR/CHF", "forex", "Forex"),
    ("frxEURAUD", "EUR/AUD", "forex", "Forex"),
    ("frxEURCAD", "EUR/CAD", "forex", "Forex"),
    ("frxEURSGD", "EUR/SGD", "forex", "Forex"),
    ("frxUSDSGD", "USD/SGD", "forex", "Forex"),
    ("frxUSDHKD", "USD/HKD", "forex", "Forex"),
    ("frxUSDMXN", "USD/MXN", "forex", "Forex"),
    ("frxUSDZAR", "USD/ZAR", "forex", "Forex"),
    ("frxUSDTRY", "USD/TRY", "forex", "Forex"),
    ("frxUSDINR", "USD/INR", "forex", "Forex"),
    ("frxGBPCHF", "GBP/CHF", "forex", "Forex"),
    ("frxGBPAUD", "GBP/AUD", "forex", "Forex"),
    ("frxGBPCAD", "GBP/CAD", "forex", "Forex"),
    ("frxGBPSGD", "GBP/SGD", "forex", "Forex"),
    ("frxAUDCAD", "AUD/CAD", "forex", "Forex"),
    ("frxAUDCHF", "AUD/CHF", "forex", "Forex"),
    ("frxAUDJPY", "AUD/JPY", "forex", "Forex"),
    ("frxAUDNZD", "AUD/NZD", "forex", "Forex"),
    ("frxCADJPY", "CAD/JPY", "forex", "Forex"),
    ("frxCHFJPY", "CHF/JPY", "forex", "Forex"),
    ("frxNZDJPY", "NZD/JPY", "forex", "Forex"),
    ("frxUSDNOK", "USD/NOK", "forex", "Forex"),
    ("frxUSDSEK", "USD/SEK", "forex", "Forex"),
    ("frxUSDPLN", "USD/PLN", "forex", "Forex"),
    ("frxUSDCNH", "USD/CNH", "forex", "Forex"),
    # ── Commodities ────────────────────────────────────────────────────
    ("frxXAUUSD", "Gold / USD", "commodities", "Commodities"),
    ("frxXAGUSD", "Silver / USD", "commodities", "Commodities"),
    # ── Stock Indices ──────────────────────────────────────────────────
    ("US30", "US Wall Street 30", "indices", "Stock Indices"),
    ("US500", "US 500", "indices", "Stock Indices"),
    ("USTEC", "US Tech 100", "indices", "Stock Indices"),
    ("U100", "US SmallCap 2000", "indices", "Stock Indices"),
    ("EUGERMANY40", "Germany 40", "indices", "Stock Indices"),
    ("UK100", "UK 100", "indices", "Stock Indices"),
    ("EUFRAANCE40", "France 40", "indices", "Stock Indices"),
    ("JP225", "Japan 225", "indices", "Stock Indices"),
    ("HKCH50", "Hang Seng 50", "indices", "Stock Indices"),
    ("AUS200", "Australia 200", "indices", "Stock Indices"),
    # ── Crypto ─────────────────────────────────────────────────────────
    ("cryBTCUSD", "Bitcoin / USD", "cryptocurrency", "Cryptocurrencies"),
    ("cryETHUSD", "Ethereum / USD", "cryptocurrency", "Cryptocurrencies"),
    ("cryLTCUSD", "Litecoin / USD", "cryptocurrency", "Cryptocurrencies"),
    ("cryXRPUSD", "XRP / USD", "cryptocurrency", "Cryptocurrencies"),
    ("cryBCHUSD", "Bitcoin Cash / USD", "cryptocurrency", "Cryptocurrencies"),
)


def get_fallback_symbols() -> List[SymbolModel]:
    return [
        SymbolModel(
            symbol=symbol,
            display_name=display_name,
            market=market,
            market_display_name=market_display_name,
            exchange_is_open=True,
            is_fallback=True,
        )
        for symbol, display_name, market, market_display_name in FALLBACK_SYMBOLS
    ]


async def get_active_symbols(client: DerivWebSocketClient) -> List[SymbolModel]:
    # "full" includes the market classification and exchange state needed by
    # clients to distinguish always-open crypto from closed asset classes.
    req = {
        "active_symbols": "full",
        "product_type": "basic",
        # Deriv uses this landing company to determine the public symbol list.
        "landing_company_short": "svg",
    }
    res = await deriv_request(client, req)
    symbols = []
    for s in res.get("active_symbols", []):
        # Deriv's current API names these fields `underlying_*`; retain the
        # legacy aliases for compatibility with older WebSocket responses.
        symbol = s.get("underlying_symbol") or s.get("symbol")
        if not symbol:
            continue
        symbols.append(SymbolModel(
            symbol=symbol,
            display_name=s.get("underlying_symbol_name") or s.get("display_name"),
            market=s.get("market"),
            market_display_name=s.get("market_display_name") or s.get("submarket"),
            exchange_is_open=s.get("exchange_is_open"),
        ))
    if symbols:
        return symbols

    return get_fallback_symbols()


async def get_historical_candles(client: DerivWebSocketClient, symbol: str, granularity: int, count: int) -> List[CandleModel]:
    # Deriv supports 'candles' endpoint with ticks or candles depending on subscription
    req = {
        "ticks_history": symbol,
        "granularity": granularity,
        "style": "candles",
        "count": count,
        "end": "latest",
    }
    res = await deriv_request(client, req)
    candles = []
    # The WebSocket API returns `candles` as an array. Keep the nested form as
    # a compatibility fallback for older adapters.
    candle_items = res.get("candles", [])
    if isinstance(candle_items, dict):
        candle_items = candle_items.get("candles", [])
    for item in candle_items:
        candles.append(CandleModel(
            timestamp=datetime.fromtimestamp(item.get("epoch")),
            open=item.get("open"),
            high=item.get("high"),
            low=item.get("low"),
            close=item.get("close"),
            volume=item.get("volume")
        ))
    return candles


async def subscribe_ticks(client: DerivWebSocketClient, symbol: str, cb):
    # send subscribe request
    req = {"ticks": symbol}
    await client.send(req)

    def _on_msg(msg):
        # Deriv sends tick objects under 'tick'
        if isinstance(msg, dict) and msg.get("tick"):
            t = msg["tick"]
            tm = TickModel(symbol=symbol, epoch=t.get("epoch"), quote=t.get("quote"))
            # schedule callback
            import asyncio
            asyncio.create_task(cb(tm))

    unsub = client.add_listener(_on_msg)

    async def unsubscribe():
        unsub()
        # send unsubscribe if needed
        await client.send({"forget": "ticks"})

    return unsubscribe
