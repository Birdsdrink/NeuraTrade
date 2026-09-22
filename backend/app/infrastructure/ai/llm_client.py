"""Shared LLM client for the News page: Gemini only.

Owns the Gemini configuration, the provider-health cooldown and the robust JSON
parser used by both the news-sentiment and event-impact features.

Three behaviours matter for the screens that depend on this:

* **Enough output budget.** Gemini 3.x spends part of ``maxOutputTokens`` on
  *thinking*, so a tight cap truncates the JSON mid-object and the whole reply
  becomes unreadable.  The budget is generous for that reason.
* **Truncation is survivable.** If a reply is still cut off, the complete fields
  are salvaged by closing the open objects, so a partial-but-valid analysis beats
  a raw JSON blob on screen.
* **Bounded, expiring failures.** A rate-limited provider is skipped for a
  cooldown rather than for the lifetime of the process, so one 429 does not
  disable AI until the next restart.  And a request never stalls: each call has
  a tight timeout and a garbled reply is retried on the next model.
"""

import os
import re
import json
import time
import asyncio
import logging
from dotenv import load_dotenv

load_dotenv()  # idempotent; ensures env is present even if imported first

from typing import Optional

import httpx

logger = logging.getLogger(__name__)

# ── Provider config ──────────────────────────────────────────────────────────

GEMINI_API_KEY = os.getenv("AI_API_KEY", "") or os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL = os.getenv("AI_MODEL", "gemini-3.6-flash") or os.getenv("GEMINI_MODEL", "gemini-3.6-flash")
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta"

HAS_GEMINI = bool(GEMINI_API_KEY)

_GEMINI_TIMEOUT = 45.0
_GEMINI_ATTEMPTS = 2

# Thinking tokens come out of this budget, so it is deliberately generous: a
# truncated reply is unparseable and loses the entire analysis.
DEFAULT_MAX_TOKENS = 4096

# A rate-limited or failing provider is skipped only for a cooldown, not for the
# lifetime of the process.
_GEMINI_COOLDOWN_SECONDS = 60.0
_gemini_failed_until = 0.0

# Last model that actually answered, tried first from then on.
_preferred_model: Optional[str] = None

# Replies a provider returned that we could not read as JSON.  Tracked so a
# garbled answer is retried on the next model instead of being accepted.
_unparseable_replies: list[str] = []

logger.info("LLM client init: HAS_GEMINI=%s, model=%s", HAS_GEMINI, GEMINI_MODEL)


class LLMUnavailable(RuntimeError):
    """Raised when Gemini could not return a usable reply."""


def gemini_available() -> bool:
    """True when a Gemini request is worth attempting right now."""
    return HAS_GEMINI and time.monotonic() >= _gemini_failed_until


def _mark_gemini_failed() -> None:
    global _gemini_failed_until
    _gemini_failed_until = time.monotonic() + _GEMINI_COOLDOWN_SECONDS


def _mark_gemini_healthy() -> None:
    global _gemini_failed_until
    _gemini_failed_until = 0.0


def provider_status() -> dict:
    """Expose provider health for diagnostics."""
    return {
        "provider": "gemini",
        "has_gemini": HAS_GEMINI,
        "model": GEMINI_MODEL,
        "cooldown_remaining": round(max(0.0, _gemini_failed_until - time.monotonic()), 1),
    }


# ── Robust JSON parsing ──────────────────────────────────────────────────────

def _strip_trailing_commas(text: str) -> str:
    """Remove commas that directly precede a closing brace/bracket."""
    previous = None
    cleaned = text
    while previous != cleaned:
        previous = cleaned
        cleaned = re.sub(r",\s*([}\]])", r"\1", cleaned)
    return cleaned


def _outermost_object(raw: str) -> Optional[str]:
    """The outermost ``{...}`` embedded in a reply."""
    start = raw.find("{")
    end = raw.rfind("}")
    if start < 0 or end <= start:
        return None
    return raw[start:end + 1]


def close_truncated_json(text: str) -> Optional[str]:
    """Close an abruptly truncated JSON object so its complete fields survive.

    Walks the text tracking string state and bracket depth, drops the final
    incomplete element, then appends the missing closers.  Returns ``None`` when
    the text is not a repairable prefix of an object.
    """
    if not text:
        return None

    in_string = False
    escaped = False
    closers: list[str] = []
    last_comma = -1

    for index, char in enumerate(text):
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue

        if char == '"':
            in_string = True
        elif char == "{":
            closers.append("}")
        elif char == "[":
            closers.append("]")
        elif char in "}]":
            if closers:
                closers.pop()
        elif char == ",":
            last_comma = index

    if not closers or last_comma <= 0:
        return None

    # Drop everything from the last comma onward: that element is the incomplete
    # one, and cutting before the comma avoids leaving a trailing comma.
    repaired = _strip_trailing_commas(text[:last_comma].rstrip())
    if not repaired.startswith("{"):
        return None
    repaired += "".join(reversed(closers))
    return _strip_trailing_commas(repaired)


def try_parse_json(raw: str) -> Optional[dict]:
    """Best-effort parse of LLM output; ``None`` when nothing readable is found.

    Tolerates markdown fences, leading chatter, trailing commas and a reply that
    was cut off mid-object.
    """
    raw = (raw or "").strip()
    if not raw:
        return None

    # Strip markdown fences (handles CRLF and single-line fences).
    cleaned = re.sub(r"^```(?:json|JSON)?\s*", "", raw)
    cleaned = re.sub(r"\s*```\s*$", "", cleaned).strip()
    cleaned = _strip_trailing_commas(cleaned)

    outer = _outermost_object(raw)
    candidates = (
        cleaned,
        outer,
        close_truncated_json(cleaned),
        close_truncated_json(outer or ""),
    )

    for candidate in candidates:
        if not candidate:
            continue
        try:
            parsed = json.loads(_strip_trailing_commas(candidate))
        except (json.JSONDecodeError, ValueError):
            continue
        if isinstance(parsed, dict) and parsed:
            return parsed
    return None


def parse_json(raw: str) -> dict:
    """Parse LLM output into a dict.

    Never raises: when nothing parseable is found it returns a degraded verdict
    whose ``analysis`` is a human message.  The raw reply is logged, never shown
    to the user -- a raw JSON blob on screen is a bug, not a fallback.
    """
    parsed = try_parse_json(raw)
    if parsed is not None:
        return parsed

    logger.warning("Could not parse Gemini JSON. First 500 chars: %s", (raw or "")[:500])
    return {
        "instrument": "",
        "sentiment": "neutral",
        "sentiment_score": 0,
        "confidence": 0,
        "recommendation": "WAIT",
        "bias": "Analysis unavailable",
        "key_themes": [],
        "news_impact": [],
        "economic_factors": [],
        "central_bank_outlook": "",
        "geopolitical_risk": "",
        "analysis": (
            "Gemini returned a response that could not be read as a structured analysis. "
            "Refresh in a moment to try again."
        ),
        "reasons": [],
        "warnings": ["Gemini replied in a format the app could not read, so no structured analysis is available."],
        "news_count": 0,
    }


# ── Provider call ────────────────────────────────────────────────────────────

def gemini_models() -> list[str]:
    """Gemini models to try, in order, de-duplicated.

    The configured model is tried first so explicit config wins, but Gemini
    preview/versioned models get quota-exhausted (HTTP 429) while the rolling
    ``gemini-flash-latest`` alias keeps serving.  Once a model succeeds it is
    tried first for the rest of the process, so a dead one costs a single
    round-trip rather than one per request.
    """
    configured = [
        os.getenv("AI_MODEL", GEMINI_MODEL),
        os.getenv("GEMINI_MODEL", GEMINI_MODEL),
        "gemini-flash-latest",
        "gemini-3.6-flash",
        "gemini-3-flash-preview",
    ]
    ordered: list[str] = []
    if _preferred_model:
        ordered.append(_preferred_model)
    for model in configured:
        if model and model not in ordered:
            ordered.append(model)
    return ordered


async def call_gemini(prompt: str, max_tokens: int = DEFAULT_MAX_TOKENS, temperature: float = 0.1) -> dict:
    """Call Gemini, trying each configured model until one returns readable JSON."""
    for model in gemini_models():
        url = f"{GEMINI_URL}/models/{model}:generateContent?key={GEMINI_API_KEY}"
        payload = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"maxOutputTokens": max_tokens, "temperature": temperature},
        }
        try:
            async with httpx.AsyncClient(timeout=_GEMINI_TIMEOUT) as client:
                resp = await client.post(url, json=payload)
                resp.raise_for_status()
                body = resp.json()
            candidates = body.get("candidates", [])
            if not candidates:
                raise ValueError("Gemini returned no candidates")
            parts = candidates[0].get("content", {}).get("parts", [])
            raw = "".join(p.get("text", "") for p in parts).strip()
            if not raw:
                raise ValueError("Gemini returned empty text")
            parsed = try_parse_json(raw)
            if parsed is None:
                # Prose, or JSON cut off before any complete field: a provider
                # miss, not a result.  Let the next model try instead.
                _unparseable_replies.append(raw)
                raise ValueError("Gemini returned unreadable JSON")
            global _preferred_model
            if _preferred_model != model:
                logger.info("LLM: preferring Gemini model %s", model)
                _preferred_model = model
            return parsed
        except Exception as exc:
            logger.warning("Gemini model %s failed: %s", model, exc)

    raise RuntimeError("Gemini requests failed for all available models")


async def call_llm_json(prompt: str, max_tokens: int = DEFAULT_MAX_TOKENS, temperature: float = 0.1) -> dict:
    """Call Gemini and return parsed JSON.

    Raises ``LLMUnavailable`` when no key is configured, the provider is in its
    failure cooldown, or every request failed -- so callers can supply their own
    graceful fallback.
    """
    # Only this call's garbled replies may be surfaced as the degraded result.
    _unparseable_replies.clear()

    if not HAS_GEMINI:
        raise LLMUnavailable("No Gemini API key is configured (set AI_API_KEY or GEMINI_API_KEY).")

    if not gemini_available():
        raise LLMUnavailable("Gemini is in its failure cooldown after a recent error.")

    last_error: Optional[str] = None
    for attempt in range(_GEMINI_ATTEMPTS):
        try:
            result = await call_gemini(prompt, max_tokens, temperature)
            _mark_gemini_healthy()
            logger.info("LLM: Gemini call succeeded (attempt %d)", attempt + 1)
            return result
        except Exception as exc:
            last_error = type(exc).__name__
            if attempt < _GEMINI_ATTEMPTS - 1:
                logger.warning("LLM: Gemini attempt %d failed (%s); retrying", attempt + 1, last_error)
                await asyncio.sleep(attempt + 1)

    if _unparseable_replies:
        # Gemini answered, but not with something we could read.  Return the
        # degraded verdict so callers can render a message and a warning.
        logger.warning("LLM: Gemini returned unreadable JSON on every attempt")
        return parse_json(_unparseable_replies[-1])

    _mark_gemini_failed()
    logger.warning("LLM: Gemini failed (%s); pausing it for %.0fs", last_error, _GEMINI_COOLDOWN_SECONDS)
    raise LLMUnavailable(f"Gemini request failed ({last_error}).")
