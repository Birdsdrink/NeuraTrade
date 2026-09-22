"""Rate how upcoming economic releases are likely to move an instrument.

Two responsibilities, deliberately split:

1. **Direction is computed here, in code.** Which way a release pushes a
   currency depends on the indicator's sign convention (a higher jobless-claims
   reading weakens a currency, a higher CPI reading firms it) and on whether the
   consensus forecast is better or worse than the previous reading.  Both the
   convention and the surprise are arithmetic, so the sign is derived from the
   calendar data rather than trusted to a language model -- models get this
   backwards surprisingly often.
2. **The model explains it.** The LLM supplies expected volatility, a
   confidence level and the narrative (why it matters, how to trade around it).
   It only picks a direction itself for events the rule table cannot read, such
   as central-bank speeches.

Never raises: when no provider is available it returns the computed directions
plus mechanically derived volatility, and a warning the UI can surface.
"""

import re
import time
import asyncio
import logging
from datetime import datetime, timezone
from typing import Any, Optional

from .llm_client import LLMUnavailable, call_llm_json

logger = logging.getLogger(__name__)

# Rating several events is one AI call; caching it avoids burning provider
# quota on every screen refresh (Gemini returns 429 quickly under load).
_CACHE_TTL_SECONDS = 1800

# Only the soonest few releases get an AI narrative.  A single call covering all
# eight releases either truncates mid-JSON (Gemini 3.x spends output tokens on
# thinking) or overruns the request budget, and events past this cap keep their
# computed direction anyway.
_MAX_RATED_EVENTS = 4
_AI_MAX_TOKENS = 2500

# Hard ceiling on the AI step.  The calendar data is already in hand by this
# point, so a slow or unreachable provider must never hold the mobile screen:
# we return the computed directions instead.
_AI_BUDGET_SECONDS = 50.0

_rating_cache: dict[tuple, tuple[float, dict]] = {}

_VOLATILITY_BY_IMPACT = {"high": "high", "medium": "medium", "low": "low", "holiday": "low"}


# ── Deterministic direction model ────────────────────────────────────────────

# +1 = a *higher* reading strengthens the released currency, -1 = weakens it.
# Matched on word boundaries, so "employment" cannot fire inside "Unemployment".
_INDICATOR_SIGN: tuple[tuple[str, int], ...] = (
    ("non-farm", 1),
    ("nonfarm", 1),
    ("payroll", 1),
    ("employment change", 1),
    ("adp", 1),
    ("jobless claims", -1),
    ("unemployment claims", -1),
    ("unemployment rate", -1),
    ("unemployment", -1),
    ("core cpi", 1),
    ("cpi", 1),
    ("inflation", 1),
    ("ppi", 1),
    ("pce", 1),
    ("interest rate decision", 1),
    ("rate decision", 1),
    ("monetary policy", 1),
    ("retail sales", 1),
    ("gdp", 1),
    ("gross domestic", 1),
    ("pmi", 1),
    ("ism", 1),
    ("consumer confidence", 1),
    ("consumer sentiment", 1),
    ("business confidence", 1),
    ("trade balance", 1),
    ("industrial production", 1),
    ("manufacturing production", 1),
    ("housing starts", 1),
    ("building permits", 1),
    ("new home sales", 1),
    ("durable goods", 1),
)

_NUMBER_RE = re.compile(r"(-?\d+(?:\.\d+)?)\s*([kmbt])?", re.IGNORECASE)
_MULTIPLIERS = {"k": 1e3, "m": 1e6, "b": 1e9, "t": 1e12}


def _parse_number(raw: Any) -> Optional[float]:
    """Parse feed values like ``22.5K``, ``4.5%``, ``-15.8K``, ``1.2M``."""
    if raw is None:
        return None
    text = str(raw).strip()
    if not text:
        return None
    match = _NUMBER_RE.search(text)
    if not match:
        return None
    try:
        value = float(match.group(1))
    except (TypeError, ValueError):
        return None
    return value * _MULTIPLIERS.get((match.group(2) or "").lower(), 1.0)


_INDICATOR_PATTERNS = tuple(
    (re.compile(r"\b" + re.escape(needle) + r"\b"), sign) for needle, sign in _INDICATOR_SIGN
)


def indicator_sign(title: str) -> Optional[int]:
    """Sign convention for an indicator, or ``None`` when it has no numeric read.

    Speeches, holidays and press conferences deliberately return ``None`` so the
    model can decide those on its own.
    """
    haystack = (title or "").lower()
    for pattern, sign in _INDICATOR_PATTERNS:
        if pattern.search(haystack):
            return sign
    return None


def surprise_sign(forecast: Any, previous: Any) -> int:
    """+1 when the consensus is better than the last reading, -1 when worse."""
    forecast_value = _parse_number(forecast)
    previous_value = _parse_number(previous)
    if forecast_value is None or previous_value is None:
        return 0
    if forecast_value > previous_value:
        return 1
    if forecast_value < previous_value:
        return -1
    return 0


def compute_direction(
    legs: list[str],
    currency: str,
    title: str,
    forecast: Any,
    previous: Any,
) -> Optional[str]:
    """Direction for the instrument implied by the consensus, or ``None``.

    ``legs`` is the instrument's currency legs in order (``["EUR", "USD"]`` for
    EUR/USD, ``["USD"]`` for gold).  Returns ``None`` whenever the rule table has
    no reliable read, signalling that the model should decide instead.
    """
    sign = indicator_sign(title)
    if sign is None:
        return None
    surprise = surprise_sign(forecast, previous)
    if surprise == 0:
        return None

    strength = sign * surprise  # +1 the released currency firms, -1 softens
    released = (currency or "").upper()
    ordered = [leg.upper() for leg in legs]

    if len(ordered) == 1:
        # Single-currency instrument (gold, US indices): the currency is the
        # pricing driver, so a firmer driver weighs on the instrument.
        pair = -strength
    elif ordered and released == ordered[0]:
        pair = strength
    elif released in ordered:
        pair = -strength
    else:
        return "neutral"

    if pair > 0:
        return "bullish"
    if pair < 0:
        return "bearish"
    return "neutral"


# ── Ratings ──────────────────────────────────────────────────────────────────

def _direction_phrase(direction: str) -> str:
    if direction == "bullish":
        return "bullish"
    if direction == "bearish":
        return "bearish"
    return "neutral"


def _mechanical_rating(event: dict, direction: Optional[str]) -> dict:
    """Rating that needs no AI: computed direction, impact-derived volatility."""
    impact = str(event.get("impact_level") or "low").lower()
    currency = event.get("currency") or ""
    forecast = (event.get("forecast") or "").strip()
    previous = (event.get("previous") or "").strip()

    resolved = direction or "neutral"
    if direction and forecast and previous:
        reason = (
            f"Consensus {forecast} versus a previous {previous} points to a {_direction_phrase(direction)} "
            f"reaction for this instrument."
        )
    elif direction:
        reason = f"The surprise implied by the {currency} consensus reads {_direction_phrase(direction)} for this instrument."
    else:
        reason = (
            f"Scheduled {currency} release; the direction for this instrument depends on the print versus "
            f"{f'the {forecast} forecast' if forecast else 'expectations'}."
        )

    return {
        "direction": resolved,
        "confidence": 0,
        "volatility": _VOLATILITY_BY_IMPACT.get(impact, "low"),
        "reason": reason,
        "playbook": "Stand aside just before the release and trade the reaction rather than the print.",
        "ai_rated": False,
        "direction_basis": "forecast" if direction else "none",
    }


def _coerce_rating(raw: Any, fallback: dict, locked_direction: Optional[str]) -> dict:
    """Validate one AI-supplied rating, keeping computed/mechanical values for gaps."""
    if not isinstance(raw, dict):
        return fallback

    if locked_direction:
        # Code owns the sign; the model only contributes the narrative.
        direction = locked_direction
    else:
        direction = str(raw.get("direction") or "").strip().lower()
        if direction not in ("bullish", "bearish", "neutral"):
            direction = fallback["direction"]

    volatility = str(raw.get("volatility") or "").strip().lower()
    if volatility not in ("high", "medium", "low"):
        volatility = fallback["volatility"]

    try:
        confidence = int(float(raw.get("confidence") or 0))
    except (TypeError, ValueError):
        confidence = 0

    reason = str(raw.get("reason") or "").strip() or fallback["reason"]
    playbook = str(raw.get("playbook") or "").strip() or fallback["playbook"]

    return {
        "direction": direction,
        "confidence": max(0, min(100, confidence)),
        "volatility": volatility,
        "reason": reason[:240],
        "playbook": playbook[:240],
        "ai_rated": True,
        "direction_basis": "forecast" if locked_direction else "ai",
    }


def _build_events_text(events: list[dict], directions: dict) -> str:
    lines = []
    for event in events:
        event_id = event.get("id")
        line = (
            f"- id={event_id} | {event.get('scheduled_at')} | {event.get('currency')} | "
            f"{event.get('impact_level')} impact | {event.get('title')}"
        )
        forecast = (event.get("forecast") or "").strip()
        previous = (event.get("previous") or "").strip()
        extras = []
        if forecast:
            extras.append(f"forecast {forecast}")
        if previous:
            extras.append(f"previous {previous}")
        if event.get("estimated"):
            extras.append("recurring release, exact date may shift")
        computed = directions.get(str(event_id))
        if computed:
            extras.append(f"computed_direction={computed}")
        if extras:
            line += f" ({', '.join(extras)})"
        lines.append(line)
    return "\n".join(lines)


EVENT_IMPACT_PROMPT = """\
You are a macro strategist covering {instrument} ({symbol}).

Today is {today} (UTC). {instrument} is driven mainly by these currencies: \
{currencies}.

Below are scheduled economic releases inside the next {days} days, ordered by \
time:

{events_text}

For EACH event above, describe how it is likely to affect {instrument}'s price.

Return ONLY valid JSON matching this schema:
{{
  "headline": "",
  "events": [
    {{
      "id": "",
      "direction": "bullish | bearish | neutral",
      "confidence": 0,
      "volatility": "high | medium | low",
      "reason": "",
      "playbook": ""
    }}
  ]
}}

Rules:
- Lines carrying computed_direction already have their direction worked out in
  code from the indicator's sign convention and the consensus forecast versus
  the previous reading. Treat it as authoritative: never contradict it. Explain
  in `reason` why the instrument moves that way.
- Only for lines WITHOUT computed_direction should you choose the direction
  yourself, and then reason in two steps: how the release affects the released
  currency, then how that translates into {instrument}. Higher US jobless claims
  mean a weaker USD, which is bearish for a pair where USD is the quote leg.
- volatility = how much {instrument} is likely to move around the release.
- confidence = how reliable your read is (0-100). Use a lower number for events
  the rule table could not read and for distant or minor releases.
- If an event is unlikely to matter for {instrument}, say so and lower the
  confidence.
- Do NOT invent events. Use only the ids listed above, one entry per id.
- Keep reason and playbook under 140 characters each.
- headline: ONE specific sentence that names the next release from the list and
  what it means for {instrument}. Never answer in generalities such as
  "releases may influence volatility".
"""


async def assess_events(
    symbol: str,
    display_name: str,
    events: list[dict],
    currencies: Optional[list[str]] = None,
    days: int = 7,
) -> dict:
    """Return ``{ratings, headline, ai_rated, warnings}``.  Never raises."""
    if not events:
        return {"ratings": {}, "headline": "", "ai_rated": False, "warnings": []}

    legs = [c.upper() for c in (currencies or [])]

    # 1. Deterministic directions for every event, not just the rated subset.
    directions: dict[str, Optional[str]] = {}
    for event in events:
        directions[str(event.get("id"))] = compute_direction(
            legs,
            str(event.get("currency") or ""),
            str(event.get("title") or ""),
            event.get("forecast"),
            event.get("previous"),
        )

    ratings = {
        str(event.get("id")): _mechanical_rating(event, directions[str(event.get("id"))])
        for event in events
    }

    selected = events[:_MAX_RATED_EVENTS]
    cache_key = (symbol, tuple(sorted(str(e.get("id")) for e in selected)))
    cached = _rating_cache.get(cache_key)
    if cached and (time.monotonic() - cached[0]) < _CACHE_TTL_SECONDS:
        return cached[1]

    instrument = display_name or symbol or "this instrument"
    prompt = EVENT_IMPACT_PROMPT.format(
        instrument=instrument,
        symbol=symbol or instrument,
        today=datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        currencies=", ".join(legs) or "its quote currencies",
        days=days,
        events_text=_build_events_text(selected, directions),
    )

    assessments = {"ratings": ratings, "headline": "", "ai_rated": False, "warnings": []}

    try:
        payload = await asyncio.wait_for(
            call_llm_json(prompt, max_tokens=_AI_MAX_TOKENS, temperature=0.2),
            timeout=_AI_BUDGET_SECONDS,
        )
    except (asyncio.TimeoutError, TimeoutError):
        logger.warning("Event impact: AI exceeded the %.0fs budget; using computed directions only", _AI_BUDGET_SECONDS)
        assessments["warnings"] = [
            "AI impact assessment timed out; directions are derived from the consensus forecast."
        ]
        return assessments
    except LLMUnavailable as exc:
        logger.warning("Event impact: AI unavailable (%s); using computed directions only", exc)
        assessments["warnings"] = [
            "AI impact assessment is unavailable right now; directions are derived from the consensus "
            "forecast and scheduled impact levels."
        ]
        return assessments
    except Exception:
        logger.exception("Event impact: unexpected AI failure; using computed directions only")
        assessments["warnings"] = [
            "AI impact assessment failed; directions are derived from the consensus forecast."
        ]
        return assessments

    raw_events = payload.get("events")
    warnings: list[str] = []
    if not isinstance(raw_events, list) or not raw_events:
        logger.warning("Event impact: AI reply contained no usable events list")
        warnings.append("The AI reply could not be parsed; directions come from the consensus forecast.")
    else:
        by_id = {
            str(item["id"]): item
            for item in raw_events
            if isinstance(item, dict) and item.get("id") is not None
        }
        for event in events:
            event_id = str(event.get("id"))
            if event_id in by_id:
                ratings[event_id] = _coerce_rating(by_id[event_id], ratings[event_id], directions.get(event_id))
        assessments["ai_rated"] = any(rating.get("ai_rated") for rating in ratings.values())

    if isinstance(payload.get("warnings"), list):
        warnings.extend(str(w) for w in payload["warnings"] if w)

    headline = str(payload.get("headline") or "").strip()
    # A generic headline is worse than none: the caller has a precise,
    # data-grounded fallback naming the event count and the next release, so only
    # keep the model's sentence when it references that release.
    next_title = str(events[0].get("title") or "").strip()
    if headline and next_title and next_title.lower() not in headline.lower():
        logger.info("Event impact: headline did not name the next release; using deterministic summary")
        headline = ""

    assessments["headline"] = headline
    assessments["warnings"] = warnings[:2]

    _rating_cache[cache_key] = (time.monotonic(), assessments)
    return assessments
