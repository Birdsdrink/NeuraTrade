import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.infrastructure.ai.event_impact_service import (
    _parse_number,
    compute_direction,
    indicator_sign,
    surprise_sign,
)
from app.infrastructure.calendar.economic_calendar import (
    _events_from_feed,
    _normalise_impact,
    _parse_event_date,
    _within_window,
    currencies_for,
    recurring_releases,
)


# ── Instrument → currencies ──────────────────────────────────────────────────

def test_forex_pair_maps_to_both_legs():
    assert currencies_for("frxEURUSD") == ["EUR", "USD"]
    assert currencies_for("frxAUDJPY") == ["AUD", "JPY"]


def test_crypto_pair_maps_to_coin_and_quote():
    assert currencies_for("cryBTCUSD") == ["BTC", "USD"]


def test_commodity_and_index_map_to_pricing_currency():
    assert currencies_for("", "Gold") == ["USD"]
    assert currencies_for("", "Germany 40") == ["EUR"]
    assert currencies_for("", "UK 100") == ["GBP"]


def test_unknown_instrument_defaults_to_usd():
    assert currencies_for("", "Something Obscure") == ["USD"]


# ── Feed parsing ─────────────────────────────────────────────────────────────

def test_parse_event_date_converts_offset_to_utc():
    parsed = _parse_event_date("2026-09-23T21:30:00-04:00")
    assert parsed is not None
    assert parsed.tzinfo is not None
    assert parsed.isoformat() == "2026-09-24T01:30:00+00:00"


def test_parse_event_date_handles_z_suffix_and_garbage():
    assert _parse_event_date("2026-09-24T01:30:00Z").isoformat() == "2026-09-24T01:30:00+00:00"
    assert _parse_event_date("not-a-date") is None
    assert _parse_event_date("") is None


def test_impact_normalisation():
    assert _normalise_impact("High") == "high"
    assert _normalise_impact("medium") == "medium"
    assert _normalise_impact("Holiday") == "holiday"
    assert _normalise_impact("") == "low"


def test_events_from_feed_dedupes_sorts_and_normalises():
    payload = [
        {"title": "CPI", "country": "USD", "date": "2026-09-24T08:30:00-04:00",
         "impact": "High", "forecast": "2.9%", "previous": "3.1%"},
        {"title": "CPI", "country": "USD", "date": "2026-09-24T08:30:00-04:00",
         "impact": "High", "forecast": "2.9%", "previous": "3.1%"},
        {"title": "Bank Holiday", "country": "JPY", "date": "2026-09-22T19:00:00-04:00",
         "impact": "Holiday", "forecast": "", "previous": ""},
        {"title": "", "country": "EUR", "date": "2026-09-22T19:00:00-04:00",
         "impact": "Low", "forecast": "", "previous": ""},
    ]

    events = _events_from_feed(payload)

    # The duplicate collapses and the title-less entry is dropped.
    assert len(events) == 2
    assert [e["title"] for e in events] == ["Bank Holiday", "CPI"]
    assert events[0]["impact_level"] == "holiday"
    assert events[1]["scheduled_at"] == "2026-09-24T12:30:00+00:00"
    assert events[1]["forecast"] == "2.9%"
    assert all(e["estimated"] is False for e in events)


def test_events_from_feed_tolerates_non_list_payload():
    assert _events_from_feed({"error": "nope"}) == []


# ── Window / impact selection ────────────────────────────────────────────────

def _event(title, currency, iso, impact):
    return {
        "id": title,
        "title": title,
        "currency": currency,
        "scheduled_at": iso,
        "impact_level": impact,
        "forecast": "",
        "previous": "",
        "estimated": False,
    }


def test_within_window_filters_currency_impact_and_time():
    now = datetime(2026, 9, 21, 12, 0, tzinfo=timezone.utc)
    horizon = datetime(2026, 9, 28, 12, 0, tzinfo=timezone.utc)
    events = [
        _event("USD high future", "USD", "2026-09-23T13:30:00+00:00", "high"),
        _event("EUR high future", "EUR", "2026-09-23T13:30:00+00:00", "high"),
        _event("USD low future", "USD", "2026-09-23T13:30:00+00:00", "low"),
        _event("USD high past", "USD", "2026-09-20T13:30:00+00:00", "high"),
        _event("USD high beyond", "USD", "2026-10-05T13:30:00+00:00", "high"),
    ]

    selected = _within_window(events, ["EUR", "USD"], now, horizon, min_rank=2)

    assert [e["title"] for e in selected] == ["USD high future", "EUR high future"]


def test_within_window_without_currencies_keeps_every_currency():
    now = datetime(2026, 9, 21, 12, 0, tzinfo=timezone.utc)
    horizon = datetime(2026, 9, 28, 12, 0, tzinfo=timezone.utc)
    events = [
        _event("USD high", "USD", "2026-09-23T13:30:00+00:00", "high"),
        _event("JPY high", "JPY", "2026-09-24T13:30:00+00:00", "high"),
    ]

    assert len(_within_window(events, [], now, horizon, min_rank=2)) == 2


# ── Offline fallback ─────────────────────────────────────────────────────────

def test_recurring_fallback_emits_weekly_us_releases():
    # 2026-09-21 is a Monday; the window then covers Wed 23rd and Thu 24th.
    now = datetime(2026, 9, 21, 21, 59, tzinfo=timezone.utc)

    events = recurring_releases(["USD"], now, days=7)

    titles = [e["title"] for e in events]
    assert "Initial Jobless Claims" in titles
    assert "EIA Crude Oil Inventories" in titles
    # Sorted ascending and always flagged as estimates.
    assert events == sorted(events, key=lambda e: e["scheduled_at"])
    assert all(e["estimated"] is True for e in events)
    assert all(e["currency"] == "USD" for e in events)


def test_recurring_fallback_includes_nfp_in_first_week_of_month():
    # 2026-09-01 is a Tuesday, so the first Friday is the 4th.
    now = datetime(2026, 9, 1, 6, 0, tzinfo=timezone.utc)

    events = recurring_releases(["USD"], now, days=7)

    nfp = [e for e in events if e["title"] == "Non-Farm Payrolls"]
    assert len(nfp) == 1
    assert nfp[0]["scheduled_at"].startswith("2026-09-04T13:30")


def test_recurring_fallback_respects_currency_filter():
    now = datetime(2026, 9, 21, 21, 59, tzinfo=timezone.utc)

    # No rules exist for a euro-only instrument, and we would rather render
    # nothing than invent unverifiable central-bank dates.
    assert recurring_releases(["EUR"], now, days=7) == []
    # An empty filter means "no currency restriction".
    assert len(recurring_releases([], now, days=7)) == 2


# ── Deterministic impact direction ───────────────────────────────────────────

def test_number_parsing_handles_feed_formats():
    assert _parse_number("22.5K") == 22500.0
    assert _parse_number("-15.8K") == -15800.0
    assert _parse_number("4.5%") == 4.5
    assert _parse_number("1.2M") == 1200000.0
    assert _parse_number("0.3") == 0.3
    assert _parse_number("") is None
    assert _parse_number("n/a") is None
    assert _parse_number(None) is None


def test_indicator_sign_conventions():
    assert indicator_sign("Non-Farm Payrolls") == 1
    assert indicator_sign("Unemployment Rate") == -1
    assert indicator_sign("Unemployment Claims") == -1
    assert indicator_sign("CPI (MoM/YoY)") == 1
    assert indicator_sign("Flash Manufacturing PMI") == 1
    assert indicator_sign("Interest Rate Decision") == 1
    # Speeches have no numeric convention: the model must decide these.
    assert indicator_sign("RBA Gov Bullock Speaks") is None
    assert indicator_sign("Bank Holiday") is None


def test_surprise_sign_compares_forecast_with_previous():
    assert surprise_sign("22.5K", "-15.8K") == 1
    assert surprise_sign("-15.8K", "22.5K") == -1
    assert surprise_sign("4.5%", "4.5%") == 0
    assert surprise_sign("", "4.5%") == 0


def test_rising_jobless_claims_is_bearish_for_the_dollar_legs():
    """The exact case the model got backwards: weaker USD."""
    # Claims forecast to rise -> USD softens -> bullish EUR/USD, bearish USD/JPY.
    assert compute_direction(["EUR", "USD"], "USD", "Unemployment Claims", "230K", "215K") == "bullish"
    assert compute_direction(["USD", "JPY"], "USD", "Unemployment Claims", "230K", "215K") == "bearish"


def test_stronger_forecast_firms_the_released_currency():
    # A hot CPI print is bullish for the currency that released it.
    assert compute_direction(["USD", "JPY"], "USD", "CPI (MoM/YoY)", "3.2%", "2.9%") == "bullish"
    assert compute_direction(["EUR", "USD"], "USD", "CPI (MoM/YoY)", "3.2%", "2.9%") == "bearish"
    assert compute_direction(["EUR", "USD"], "EUR", "German Flash Manufacturing PMI", "52.0", "48.5") == "bullish"
    assert compute_direction(["EUR", "USD"], "EUR", "German Flash Manufacturing PMI", "46.0", "48.5") == "bearish"


def test_direction_is_none_when_the_rule_table_has_no_read():
    # Speeches and holiday entries defer to the model.
    assert compute_direction(["AUD", "USD"], "AUD", "RBA Gov Bullock Speaks", "", "") is None
    # A recognised indicator with no usable consensus also defers.
    assert compute_direction(["EUR", "USD"], "USD", "Non-Farm Payrolls", "", "") is None
    # Equal forecast and previous gives no directional edge.
    assert compute_direction(["EUR", "USD"], "USD", "Unemployment Rate", "4.5%", "4.5%") is None


def test_single_currency_instrument_inverts_the_driver():
    # Gold is quoted in USD: a firmer USD weighs on it.
    assert compute_direction(["USD"], "USD", "CPI (MoM/YoY)", "3.2%", "2.9%") == "bearish"


def test_unrelated_third_currency_is_neutral():
    assert compute_direction(["EUR", "USD"], "JPY", "CPI (MoM/YoY)", "3.2%", "2.9%") == "neutral"
