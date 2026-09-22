"""Upcoming economic-calendar events and their expected price impact.

Primary source is the keyless Forex Factory weekly calendar mirror
(``nfs.faireconomy.media``), which serves the current week as JSON.  When the
feed is unreachable -- or the current week has no releases left inside the
requested window -- we fall back to a deterministic set of *recurring* US
releases (NFP, CPI, jobless claims, ...).  Every fallback entry carries
``estimated: True`` so the UI can label it honestly rather than presenting a
guess as a confirmed date.
"""

import re
import time
import logging
from datetime import date, datetime, time as dtime, timedelta, timezone
from typing import Any, Optional

import httpx

from ..ai.event_impact_service import assess_events

logger = logging.getLogger(__name__)

FEED_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json"
_FEED_TTL_SECONDS = 900
_FEED_TIMEOUT_SECONDS = 10.0
_USER_AGENT = "Mozilla/5.0 (compatible; NeuraTrade/1.0)"

IMPACT_ORDER = {"holiday": 0, "low": 1, "medium": 2, "high": 3}
DEFAULT_MIN_IMPACT = "medium"
MIN_IMPACT_ALIASES = {"med": "medium", "moderate": "medium", "hi": "high", "none": "low", "all": "low"}

_FIAT_CURRENCIES = {"USD", "EUR", "GBP", "JPY", "AUD", "CAD", "CHF", "NZD", "CNY"}
_CRYPTO_CURRENCIES = {"BTC", "ETH", "LTC", "XRP", "BCH", "SOL", "ADA", "DOGE"}
_KNOWN_CURRENCIES = _FIAT_CURRENCIES | _CRYPTO_CURRENCIES

# Commodities and indices are priced against the currency of their dominant
# venue.  Mirrors the naming already used by the news service.
_INSTRUMENT_CURRENCY = {
    "Gold": "USD",
    "Silver": "USD",
    "US Dollar Index": "USD",
    "Wall Street 30": "USD",
    "US 500": "USD",
    "US Tech 100": "USD",
    "US Small Cap 2000": "USD",
    "Germany 40": "EUR",
    "UK 100": "GBP",
    "Japan 225": "JPY",
}

_PAIR_RE = re.compile(r"^(?:frx|cry)([A-Za-z]{3})([A-Za-z]{3})$")

_feed_cache: dict[str, Any] = {"at": 0.0, "events": []}


# ── Instrument → currencies ──────────────────────────────────────────────────

def currencies_for(symbol: str = "", display_name: str = "") -> list[str]:
    """Currencies whose releases can move this instrument.

    ``frxEURUSD`` -> ``["EUR", "USD"]``, ``cryBTCUSD`` -> ``["BTC", "USD"]``,
    commodities/indices -> their pricing currency.
    """
    match = _PAIR_RE.match((symbol or "").strip())
    if match:
        codes = [match.group(1).upper(), match.group(2).upper()]
        return list(dict.fromkeys(codes))

    name = (display_name or "").strip()
    if name in _INSTRUMENT_CURRENCY:
        return [_INSTRUMENT_CURRENCY[name]]

    cleaned = re.sub(r"^(frx|cry)", "", (display_name or symbol or ""), flags=re.IGNORECASE).strip().upper()
    if len(cleaned) == 6:
        codes = [code for code in (cleaned[:3], cleaned[3:]) if code in _KNOWN_CURRENCIES]
        if codes:
            return list(dict.fromkeys(codes))

    return ["USD"]


# ── Live feed ────────────────────────────────────────────────────────────────

def _normalise_impact(raw: Any) -> str:
    value = str(raw or "").strip().lower()
    if value in IMPACT_ORDER:
        return value
    for level in ("holiday", "high", "medium", "low"):
        if value.startswith(level):
            return level
    return "low"


def _parse_event_date(raw: Any) -> Optional[datetime]:
    """Parse a feed timestamp into an aware UTC datetime."""
    if not raw:
        return None
    text = str(raw).strip().replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _events_from_feed(payload: Any) -> list[dict]:
    if not isinstance(payload, list):
        return []

    events: list[dict] = []
    seen: set[tuple] = set()
    for index, item in enumerate(payload):
        if not isinstance(item, dict):
            continue
        scheduled = _parse_event_date(item.get("date"))
        title = str(item.get("title") or "").strip()
        if scheduled is None or not title:
            continue
        currency = str(item.get("country") or "").strip().upper()
        key = (title, currency, scheduled.isoformat())
        if key in seen:
            continue
        seen.add(key)
        events.append({
            "id": f"ff-{scheduled:%Y%m%dT%H%M}-{currency}-{index}",
            "title": title,
            "currency": currency,
            "scheduled_at": scheduled.isoformat(),
            "impact_level": _normalise_impact(item.get("impact")),
            "forecast": str(item.get("forecast") or "").strip(),
            "previous": str(item.get("previous") or "").strip(),
            "estimated": False,
        })
    events.sort(key=lambda e: e["scheduled_at"])
    return events


async def fetch_weekly_events(force: bool = False) -> list[dict]:
    """Fetch (and cache) the current week's calendar.  Returns [] on failure."""
    now = time.monotonic()
    cached = _feed_cache["events"]
    if not force and cached and (now - _feed_cache["at"]) < _FEED_TTL_SECONDS:
        return cached

    try:
        async with httpx.AsyncClient(timeout=_FEED_TIMEOUT_SECONDS, follow_redirects=True) as client:
            response = await client.get(FEED_URL, headers={"User-Agent": _USER_AGENT})
            response.raise_for_status()
            payload = response.json()
    except Exception as exc:
        logger.warning("Economic calendar feed unavailable (%s: %s)", type(exc).__name__, exc)
        return cached  # stale beats empty

    events = _events_from_feed(payload)
    if events:
        _feed_cache["at"] = now
        _feed_cache["events"] = events
        return events
    return cached


# ── Offline fallback: genuinely recurring releases ───────────────────────────

# Only rules whose recurrence is a real calendar fact are used here.  Approximate
# mid-month US releases are flagged `estimated` so the UI can say so.
_RECURRING_RULES: list[dict] = [
    {
        "title": "Non-Farm Payrolls",
        "currency": "USD",
        "impact": "high",
        "hour": 13,
        "minute": 30,
        "matches": lambda d: d.weekday() == 4 and d.day <= 7,
        "note": "First Friday of the month",
    },
    {
        "title": "US CPI (MoM/YoY)",
        "currency": "USD",
        "impact": "high",
        "hour": 13,
        "minute": 30,
        "matches": lambda d: d.day == 12,
        "note": "Typically released mid-month",
    },
    {
        "title": "US Retail Sales",
        "currency": "USD",
        "impact": "high",
        "hour": 13,
        "minute": 30,
        "matches": lambda d: d.day == 16,
        "note": "Typically released mid-month",
    },
    {
        "title": "Initial Jobless Claims",
        "currency": "USD",
        "impact": "medium",
        "hour": 13,
        "minute": 30,
        "matches": lambda d: d.weekday() == 3,
        "note": "Every Thursday",
    },
    {
        "title": "EIA Crude Oil Inventories",
        "currency": "USD",
        "impact": "medium",
        "hour": 15,
        "minute": 30,
        "matches": lambda d: d.weekday() == 2,
        "note": "Every Wednesday",
    },
]


def recurring_releases(
    currencies: Optional[list[str]],
    now: Optional[datetime] = None,
    days: int = 7,
) -> list[dict]:
    """Deterministic recurring releases inside the window, flagged ``estimated``."""
    now = now or datetime.now(timezone.utc)
    horizon = now + timedelta(days=max(1, days))
    wanted = {c.upper() for c in (currencies or []) if c}

    events: list[dict] = []
    day: date = now.date()
    last_day = horizon.date()
    while day <= last_day:
        for rule in _RECURRING_RULES:
            if wanted and rule["currency"] not in wanted:
                continue
            try:
                if not rule["matches"](day):
                    continue
            except Exception:
                continue
            scheduled = datetime.combine(day, dtime(rule["hour"], rule["minute"]), tzinfo=timezone.utc)
            if scheduled < now or scheduled > horizon:
                continue
            events.append({
                "id": f"est-{rule['currency']}-{rule['title'][:18]}-{scheduled:%Y%m%dT%H%M}",
                "title": rule["title"],
                "currency": rule["currency"],
                "scheduled_at": scheduled.isoformat(),
                "impact_level": rule["impact"],
                "forecast": "",
                "previous": "",
                "estimated": True,
                "note": rule["note"],
            })
        day += timedelta(days=1)

    events.sort(key=lambda e: e["scheduled_at"])
    return events


# ── Selection ────────────────────────────────────────────────────────────────

def _within_window(
    events: list[dict],
    currencies: list[str],
    now: datetime,
    horizon: datetime,
    min_rank: int,
) -> list[dict]:
    wanted = {c.upper() for c in currencies}
    selected = []
    for event in events:
        currency = str(event.get("currency") or "").upper()
        if wanted and currency not in wanted:
            continue
        if IMPACT_ORDER.get(str(event.get("impact_level")), 0) < min_rank:
            continue
        scheduled = _parse_event_date(event.get("scheduled_at"))
        if scheduled is None or scheduled < now or scheduled > horizon:
            continue
        selected.append(event)
    selected.sort(key=lambda e: e["scheduled_at"])
    return selected


def _auto_headline(instrument: str, events: list[dict], now: datetime) -> str:
    if not events:
        return f"No scheduled releases are expected to move {instrument} in the next few days."
    high = [e for e in events if e.get("impact_level") == "high"]
    next_event = events[0]
    scheduled = _parse_event_date(next_event.get("scheduled_at"))
    when = ""
    if scheduled:
        minutes = int((scheduled - now).total_seconds() // 60)
        if minutes < 60:
            when = f" in {max(minutes, 1)}m"
        elif minutes < 1440:
            when = f" in {minutes // 60}h {minutes % 60}m"
        else:
            when = f" in {minutes // 1440}d {(minutes % 1440) // 60}h"
    if high:
        return (
            f"{len(high)} high-impact release{'s' if len(high) != 1 else ''} ahead for {instrument}; "
            f"next is {next_event.get('title')}{when}."
        )
    return f"{len(events)} scheduled release{'s' if len(events) != 1 else ''} ahead for {instrument}; next is {next_event.get('title')}{when}."


def _public_event(event: dict, rating: Optional[dict]) -> dict:
    rating = rating or {}
    return {
        "id": event.get("id"),
        "title": event.get("title"),
        "currency": event.get("currency"),
        "scheduled_at": event.get("scheduled_at"),
        "impact_level": event.get("impact_level"),
        "forecast": event.get("forecast") or "",
        "previous": event.get("previous") or "",
        "estimated": bool(event.get("estimated")),
        "direction": rating.get("direction", "neutral"),
        "direction_basis": rating.get("direction_basis", "none"),
        "direction_confidence": rating.get("confidence", 0),
        "volatility": rating.get("volatility", "low"),
        "reason": rating.get("reason", ""),
        "playbook": rating.get("playbook", ""),
        "ai_rated": bool(rating.get("ai_rated")),
    }


async def get_upcoming_events(
    symbol: str = "",
    display_name: str = "",
    days: int = 7,
    min_impact: str = DEFAULT_MIN_IMPACT,
) -> dict:
    """Scheduled releases for an instrument, with expected price impact."""
    try:
        days = max(1, min(int(days or 7), 14))
    except (TypeError, ValueError):
        days = 7

    impact_key = str(min_impact or "").strip().lower()
    impact_key = MIN_IMPACT_ALIASES.get(impact_key, impact_key)
    min_rank = IMPACT_ORDER.get(impact_key, IMPACT_ORDER[DEFAULT_MIN_IMPACT])

    now = datetime.now(timezone.utc)
    horizon = now + timedelta(days=days)
    currencies = currencies_for(symbol, display_name) if symbol else []
    instrument = display_name or symbol or "All instruments"

    warnings: list[str] = []

    # 1. Live calendar first; fall back to genuinely recurring releases.
    feed_events = await fetch_weekly_events()
    live = _within_window(feed_events, currencies, now, horizon, min_rank) if feed_events else []

    if live:
        events, source = live, "live"
    else:
        estimated = _within_window(recurring_releases(currencies, now, days), currencies, now, horizon, min_rank)
        if estimated:
            events, source = estimated, "estimated"
            if not feed_events:
                warnings.append(
                    "Live calendar data is unavailable; showing recurring scheduled releases with estimated dates."
                )
            else:
                warnings.append(
                    "No live releases remain in this window; showing recurring scheduled releases with estimated dates."
                )
        else:
            events = []
            source = "live" if feed_events else "unavailable"
            if feed_events:
                warnings.append(f"No scheduled releases match {instrument} in the next {days} days.")
            else:
                warnings.append(
                    "Live calendar data is unavailable and no recurring releases match this instrument."
                )

    # 2. Rate the impact on this instrument (skipped when no instrument is set).
    ratings: dict = {}
    headline = ""
    ai_rated = False
    if events and symbol:
        assessment = await assess_events(symbol, display_name, events, currencies, days)
        ratings = assessment.get("ratings", {})
        headline = assessment.get("headline", "")
        ai_rated = bool(assessment.get("ai_rated"))
        warnings.extend(assessment.get("warnings", []))

    public_events = [_public_event(event, ratings.get(event.get("id"))) for event in events]
    if not ai_rated and events and not symbol:
        warnings.append("Select an instrument to see the expected price impact of each release.")

    high = [e for e in public_events if e.get("impact_level") == "high"]

    return {
        "symbol": symbol,
        "instrument": instrument,
        "currencies": currencies,
        "source": source,
        "generated_at": now.isoformat(),
        "window_days": days,
        "min_impact": impact_key if impact_key in IMPACT_ORDER else DEFAULT_MIN_IMPACT,
        "ai_rated": ai_rated,
        "events": public_events,
        "summary": {
            "event_count": len(public_events),
            "high_impact_count": len(high),
            "next_event": public_events[0] if public_events else None,
            "next_high_impact": high[0] if high else None,
            "headline": headline or _auto_headline(instrument, events, now),
        },
        "warnings": warnings,
    }
