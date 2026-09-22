import asyncio
import logging
import math
import random
import time
from typing import List
from datetime import datetime, timezone
from .deriv_client import deriv_request, DerivWebSocketClient
from .models import CandleModel, TickModel, SymbolModel

logger = logging.getLogger(__name__)


# Rough per-symbol reference prices used only to seed the offline candle
# synthesizer when the Deriv WebSocket is unreachable (local dev / blocked
# networks). Real Deriv data is always preferred when available.
#
# Wavelengths of the two noise octaves that shape the offline price curve.
# The slow one draws the trends, the fast one adds pullbacks and varying bar
# sizes — a single octave renders as an unnaturally even sine wave.
_ANCHOR_SPAN = 18
_FAST_SPAN = 6
_FAST_WEIGHT = 0.45
_REFERENCE_PRICE = {
    "frxEURUSD": 1.09, "frxGBPUSD": 1.27, "frxUSDJPY": 155.0,
    "frxAUDUSD": 0.66, "frxUSDCAD": 1.36, "frxUSDCHF": 0.88,
    "frxNZDUSD": 0.61, "frxXAUUSD": 2350.0, "frxXAGUSD": 28.0,
    "cryBTCUSD": 80000.0, "cryETHUSD": 4500.0, "cryLTCUSD": 90.0,
    "US30": 40000.0, "US500": 5400.0, "USTEC": 19000.0,
    "UK100": 8200.0, "JP225": 40000.0, "EUGERMANY40": 18000.0,
}


def _anchor_offset(symbol: str, granularity: int, tag: str) -> float:
    """Seeded random offset in the range -1..1 for a named anchor point."""
    rng = random.Random(f"{symbol}:{granularity}:anchor:{tag}")
    return rng.uniform(-1.0, 1.0)


def _value_noise(symbol: str, granularity: int, bucket: int, span: int) -> float:
    """Smoothstep-interpolated value noise in -1..1 with wavelength ``span``.

    Interpolating between seeded anchors keeps the curve continuous (open of
    each candle equals the previous close) while still being a pure function of
    the bucket, so the series never shifts between refetches.
    """
    left = bucket // span
    t = (bucket - left * span) / span
    smooth = t * t * (3.0 - 2.0 * t)  # no corners at the anchors
    a0 = _anchor_offset(symbol, granularity, f"{span}:{left}")
    a1 = _anchor_offset(symbol, granularity, f"{span}:{left + 1}")
    return a0 + (a1 - a0) * smooth


def _close_for_bucket(symbol: str, granularity: int, bucket: int) -> float:
    """Deterministic close price for an absolute time bucket.

    The curve is smooth value noise: one seeded offset every ``_ANCHOR_SPAN``
    buckets, smoothstep-interpolated in between, plus a slow sine trend. It is
    still a pure function of (symbol, granularity, bucket), so ANY fetch of the
    same instrument/timeframe returns the identical series and the LAST candle
    is identical regardless of how many candles were requested — which keeps
    history pinned across refetches and lets the live tick stream anchor exactly
    onto the real last close.

    Continuity matters for looks: an independent random draw per bucket renders
    as a sawtooth of unrelated closes (a "messy" chart), not a market.
    """
    base = _REFERENCE_PRICE.get(symbol, 100.0)
    # amp is an ABSOLUTE price offset (≈0.4% of price), so it must be ADDED to
    # base — using it as a multiplier would inflate high-priced instruments by
    # tens of times.
    amp = max(base * 0.004, 0.0004)
    noise = (
        _value_noise(symbol, granularity, bucket, _ANCHOR_SPAN)
        + _FAST_WEIGHT * _value_noise(symbol, granularity, bucket, _FAST_SPAN)
    )
    # Slow trend so the series drifts instead of only oscillating in place.
    trend = 0.5 * math.sin(2.0 * math.pi * bucket / (_ANCHOR_SPAN * 30.0))
    return base + (noise + trend) * amp


def _synthesise_candles(symbol: str, granularity: int, count: int) -> List[CandleModel]:
    """Generate plausible offline candles so analysis endpoints still answer.

    Produces a smooth, zigzagging price series where each candle opens at the
    previous candle's close (continuity) and closes at its own deterministic
    price. The body is a meaningful fraction of the candle's range so bars look
    like real candlesticks, not thin needles. Candles are flagged with a
    ``volume`` of -1 so callers can detect synthetic data.
    """
    now = int(time.time())
    current_bucket = now // granularity
    base_price = _REFERENCE_PRICE.get(symbol, 100.0)
    amp = max(base_price * 0.0012, 0.0003)  # ~0.12% body amplitude per bar

    def _next_close(bucket: int) -> float:
        return _close_for_bucket(symbol, granularity, bucket)

    candles: List[CandleModel] = []
    prev_close: float | None = None
    for k in range(count, 0, -1):
        bucket = current_bucket - k  # completed buckets, oldest -> newest
        close_p = _next_close(bucket)
        # Open at the previous close (or close to it) so the series connects.
        if prev_close is None:
            open_p = close_p  # first bar: no prior close
        else:
            open_p = prev_close
        # Ensure body is visible: if open ≈ close (dojibar), add a tiny nudge.
        body = abs(close_p - open_p)
        if body < amp * 0.15:
            nudge = random.Random(f"{symbol}:{granularity}:nudge:{bucket}").uniform(amp * 0.15, amp * 0.5)
            if close_p >= open_p:
                close_p = open_p + nudge
            else:
                close_p = open_p - nudge
            body = abs(close_p - open_p)
        # Wicks: proportional to the body, not a fixed minimum.
        rng = random.Random(f"{symbol}:{granularity}:w:{bucket}")
        wick_ratio = rng.uniform(0.2, 0.6)  # wick = 20-60% of body
        wick = max(body * wick_ratio, base_price * 0.00005)  # tiny floor
        high = max(open_p, close_p) + wick
        low = min(open_p, close_p) - wick
        prev_close = close_p
        candles.append(CandleModel(
            timestamp=datetime.fromtimestamp(bucket * granularity, tz=timezone.utc),
            open=round(open_p, 5),
            high=round(high, 5),
            low=round(low, 5),
            close=round(close_p, 5),
            volume=-1,  # sentinel: synthetic data
        ))
    return candles


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
    res = await deriv_request(client, req, timeout=3)
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
    """Fetch candles from Deriv, falling back to synthesised offline data."""
    req = {
        "ticks_history": symbol,
        "granularity": granularity,
        "style": "candles",
        "count": count,
        "end": "latest",
    }
    try:
        res = await deriv_request(client, req, timeout=5)
        candles: List[CandleModel] = []
        candle_items = res.get("candles", [])
        if isinstance(candle_items, dict):
            candle_items = candle_items.get("candles", [])
        for item in candle_items:
            candles.append(CandleModel(
                timestamp=datetime.fromtimestamp(item.get("epoch"), tz=timezone.utc),
                open=item.get("open"),
                high=item.get("high"),
                low=item.get("low"),
                close=item.get("close"),
                volume=item.get("volume"),
            ))
        if candles:
            return candles
    except Exception:
        logger.warning(
            "Deriv candle request failed for %s (granularity=%s), using synthesised data",
            symbol, granularity,
        )
    return _synthesise_candles(symbol, granularity, count)


def _synthesise_ticks(symbol: str, cb, start_price: float = None, interval_s: float = 1.0, granularity: int = 60, tick_vol: float = None):
    """Stream synthetic ticks so the chart builds candles in real time even
    when the Deriv feed is unreachable (local dev / blocked networks).

    The pump is a MEAN-REVERTING walk around ``start_price`` (the real last
    candle close when given): every tick is pulled back toward the anchor, so
    the forming candle's high/low stay bounded in a band comparable to the
    historical candles instead of growing forever as more ticks arrive.
    ``tick_vol`` sizes the per-tick noise from the real candles' observed
    range; when omitted a conservative default is used.
    Returns an async unsubscribe callable.
    """
    anchor = (
        start_price
        if start_price is not None and start_price > 0
        # With no real close to anchor on, continue the same offline series the
        # historical endpoint serves — anchoring on the bare reference price
        # would make the forming bar jump away from the chart it continues.
        else _close_for_bucket(symbol, granularity, int(time.time()) // granularity - 1)
    )
    vol = tick_vol if tick_vol is not None else max(anchor * 0.0002, 0.0001)
    rng = random.Random(f"{symbol}:live")
    stopped = False
    price = anchor

    async def _pump():
        nonlocal price, anchor, vol
        while not stopped:
            # Mean-reversion: pull 30% of the distance back to the anchor each
            # tick, then add bounded noise. Keeps the price inside a stable
            # band around the real close — no runaway tall candles.
            pull = (anchor - price) * 0.3
            price = anchor + pull + rng.uniform(-vol, vol)
            tm = TickModel(
                symbol=symbol,
                epoch=int(time.time()),
                quote=round(price, 5),
            )
            try:
                await cb(tm)
            except Exception:
                pass
            await asyncio.sleep(interval_s)

    task = asyncio.create_task(_pump())

    async def unsubscribe():
        nonlocal stopped
        stopped = True
        task.cancel()

    return unsubscribe


async def subscribe_ticks(client: DerivWebSocketClient, symbol: str, cb):
    # send subscribe request — must include subscribe: 1 or Deriv answers
    # with a single one-shot tick instead of a live stream.
    req = {"ticks": symbol, "subscribe": 1}
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
