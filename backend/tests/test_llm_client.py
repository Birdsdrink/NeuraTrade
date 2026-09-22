import asyncio
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import app.infrastructure.ai.llm_client as llm
from app.infrastructure.ai.llm_client import (
    LLMUnavailable,
    close_truncated_json,
    parse_json,
    try_parse_json,
)


# ── Truncation repair ────────────────────────────────────────────────────────

def test_recovers_complete_fields_from_a_truncated_reply():
    # The real failure: Gemini spent its output budget on thinking and the JSON
    # was cut off mid-string, which used to lose the entire analysis.
    truncated = (
        '{\n  "instrument": "USD/JPY",\n  "sentiment": "neutral",\n  "confidence": 65,\n'
        '  "key_themes": [\n    "Stabilization after sell-off",\n    "Resistance at 158"\n  ],\n'
        '  "analysis": "Price is approaching a significant'
    )

    parsed = try_parse_json(truncated)

    assert parsed is not None
    assert parsed["instrument"] == "USD/JPY"
    assert parsed["sentiment"] == "neutral"
    assert parsed["confidence"] == 65
    assert parsed["key_themes"] == ["Stabilization after sell-off", "Resistance at 158"]
    # The half-written string cannot be recovered, so that key is dropped rather
    # than stored as a broken value.
    assert "analysis" not in parsed


def test_repairs_truncation_inside_an_array_of_objects():
    truncated = (
        '{"instrument": "EUR/USD", "news_impact": ['
        '{"headline": "a", "impact": "bullish", "relevance": 8}, '
        '{"headline": "b", "imp'
    )

    parsed = try_parse_json(truncated)

    assert parsed is not None
    assert parsed["instrument"] == "EUR/USD"
    # The first entry survives intact.  The half-written second entry may also be
    # kept as a partial object, which is harmless: the UI defaults its missing
    # fields.  What matters is that the analysis is not lost.
    assert parsed["news_impact"][0] == {"headline": "a", "impact": "bullish", "relevance": 8}


def test_truncated_fenced_reply_is_repaired():
    truncated = '```json\n{"instrument": "GBP/USD", "confidence": 70, "bias": "Firm'

    parsed = try_parse_json(truncated)

    assert parsed is not None
    assert parsed["instrument"] == "GBP/USD"
    assert parsed["confidence"] == 70


def test_close_truncated_json_ignores_non_json_text():
    assert close_truncated_json("no braces here at all") is None
    assert close_truncated_json("") is None
    # A truncated string with no completed element has nothing safe to keep.
    assert close_truncated_json('{"a": "unterminated') is None


def test_close_truncated_json_leaves_complete_json_alone():
    # Nothing to close: the input is already balanced.
    assert close_truncated_json('{"a": 1}') is None


# ── Degraded verdict ─────────────────────────────────────────────────────────

def test_unreadable_reply_never_leaks_raw_json_to_the_ui():
    # Prose, not JSON: nothing can be salvaged.
    result = parse_json("I am unable to analyse the news right now.")

    assert result["recommendation"] == "WAIT"
    assert "{" not in result["analysis"]
    assert result["warnings"] == [
        "Gemini replied in a format the app could not read, so no structured analysis is available."
    ]
    # It should read as prose a user can act on.
    assert "Refresh" in result["analysis"]


def test_partial_json_is_preferred_over_the_degraded_verdict():
    # A usable fragment beats throwing the whole analysis away.
    result = parse_json('{"instrument": "USD/JPY", "confidence": 65, "analysis": "cut')

    assert result["instrument"] == "USD/JPY"
    assert result["confidence"] == 65
    assert "warnings" not in result


def test_unparseable_truncation_still_degrades_cleanly():
    # Cut before even one complete field: nothing to salvage.
    result = parse_json('{"analysis": "cut off right at the start')

    assert result["recommendation"] == "WAIT"
    assert "cut off right at the start" not in result["analysis"]


# ── Provider scope and cooldown ──────────────────────────────────────────────

def test_client_uses_gemini_only():
    """The News page runs on Gemini; no other vendor may creep back in."""
    source = Path(llm.__file__).read_text(encoding="utf-8").lower()
    for banned in ("openrouter", "openai", "qwen", "anthropic", "groq"):
        assert banned not in source, f"{banned} should no longer be referenced"


def test_cooldown_expires_instead_of_disabling_gemini_for_the_process():
    original = llm.HAS_GEMINI
    llm.HAS_GEMINI = True
    try:
        llm._mark_gemini_failed()
        assert llm.gemini_available() is False

        # A rate limit must not disable AI until the next restart.
        llm._gemini_failed_until = time.monotonic() - 1.0
        assert llm.gemini_available() is True

        llm._mark_gemini_healthy()
        assert llm.gemini_available() is True
        assert llm.provider_status()["cooldown_remaining"] == 0.0
    finally:
        llm.HAS_GEMINI = original
        llm._mark_gemini_healthy()


def test_missing_key_raises_unavailable_before_any_request():
    original = llm.HAS_GEMINI
    llm.HAS_GEMINI = False
    try:
        try:
            asyncio.run(llm.call_llm_json("hello"))
        except LLMUnavailable as exc:
            assert "Gemini" in str(exc)
        else:
            raise AssertionError("expected LLMUnavailable when no key is configured")
    finally:
        llm.HAS_GEMINI = original


def test_gemini_models_are_deduplicated_and_all_gemini():
    for model in llm.gemini_models():
        assert model.startswith("gemini-"), model
    models = llm.gemini_models()
    assert len(models) == len(set(models)), models
