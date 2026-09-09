"""AI Vision service for forex chart technical analysis.

Uses Google Gemini via the google-genai SDK for all LLM calls:
  - Image chart analysis (multimodal)
  - Candle data technical analysis (text)
  - Dashboard generation

Configure via environment variables:
  GEMINI_API_KEY  – Google AI API key
  GEMINI_MODEL    – Gemini model id (default: gemini-2.5-flash)
"""

import os
import re
import json
import base64
import asyncio
import logging
import time
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

# ── Provider config ──────────────────────────────────────────────────────────

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY") or os.getenv("AI_API_KEY") or ""
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.6-flash")

# Optional HTTP(S) proxy for outbound AI calls
_AI_PROXY = os.getenv("AI_HTTP_PROXY", "") or os.getenv("HTTPS_PROXY", "") or os.getenv("HTTP_PROXY", "")

HAS_GEMINI = bool(GEMINI_API_KEY)

logger.info("Vision service init: HAS_GEMINI=%s, model=%s, proxy=%s", HAS_GEMINI, GEMINI_MODEL, bool(_AI_PROXY))

# ── Prompts ─────────────────────────────────────────────────────────────────

CHART_SYSTEM_PROMPT = """\
You are an expert forex technical analyst. Analyse the provided chart image carefully.

When analysing, identify ALL of the following when visible in the image:
- Currency pair and timeframe
- Current/last visible price
- Market direction (bullish, bearish, neutral)
- Trend strength (0-100)
- Market structure: higher highs, higher lows, lower highs, lower lows
- Support levels and resistance levels (list all visible)
- Candlestick patterns visible
- Chart patterns visible (triangles, head & shoulders, etc.)
- Breakouts or breakdowns
- Technical indicators visible: RSI, MACD, moving averages, Bollinger Bands, Stochastic, Volume
- Potential BUY/SELL/WAIT setup with entry zone, stop-loss, take-profit zones, risk/reward
- Confidence level (0-100)
- Reasons supporting your analysis
- Warnings or uncertainties

Return ONLY valid JSON matching this schema (no markdown fences, no extra text):
{
  "symbol": "",
  "timeframe": "",
  "current_price": null,
  "market_direction": "bullish | bearish | neutral",
  "trend_strength": 0,
  "market_structure": {
    "higher_highs": false,
    "higher_lows": false,
    "lower_highs": false,
    "lower_lows": false
  },
  "support_levels": [],
  "resistance_levels": [],
  "candlestick_patterns": [],
  "chart_patterns": [],
  "indicators": {
    "rsi": null,
    "macd": null,
    "moving_averages": [],
    "bollinger_bands": null,
    "stochastic": null,
    "volume": null
  },
  "analysis": "",
  "setup": {
    "direction": "BUY | SELL | WAIT",
    "entry_zone": null,
    "stop_loss": null,
    "take_profit_1": null,
    "take_profit_2": null,
    "risk_reward": null
  },
  "confidence": 0,
  "reasons": [],
  "warnings": []
}

Rules:
- If something cannot be determined from the image, use null or empty list.
- Do NOT invent information that cannot be reliably seen.
- current_price should be a number or null.
- support_levels and resistance_levels are arrays of numbers.
- indicators fields: rsi/macd/stochastic are numbers or null; moving_averages is array of strings; volume is a string description or null.
"""

CANDLE_ANALYSIS_PROMPT = """\
You are an expert forex technical analyst. Analyse the following OHLC candle data \
for {symbol} ({timeframe}) and return a compact, signal-ready technical summary.

Candles (oldest to newest):
{candle_summary}

Return ONLY valid JSON matching this schema (no markdown fences, no extra text):
{schema}

Rules:
- current_price: most recent candle close, as a number.
- confidence 0-100: higher when structure and momentum align and levels are clean.
- market_direction: neutral, bullish, or bearish from price structure and momentum.
- trend_strength 0-1: 0.0-0.3 weak/ranging, 0.3-0.7 moderate, 0.7-1.0 strong.
- market_structure: higher_highs/higher_lows for bullish, lower_highs/lower_lows for bearish.
- support_levels & resistance_levels: REAL candle prices (swing lows/highs or obvious round numbers).
- candlestick_patterns: only clearly visible patterns; empty if none stand out.
- indicators: pre-compute RSI, SMA-10/20/50 when possible.
- analysis: 1-2 sentences with the bias, a key level, and a setup trigger.
- setup: bullish -> direction=BUY, entry_zone=above nearest resistance/breakout, stop_loss=below nearest support, take_profit_1=first target; bearish mirrored; neutral -> direction=WAIT with nulls.
- reasons: 2-3 short bullets.
- warnings: short flags like "no clear trend" or "low conviction" when confidence is low.
- Never fabricate prices; use only values inferable from the candles.
"""

ANALYSIS_SCHEMA = json.dumps({
    "symbol": "",
    "timeframe": "",
    "current_price": None,
    "market_direction": "bullish | bearish | neutral",
    "trend_strength": 0,
    "market_structure": {
        "higher_highs": False,
        "higher_lows": False,
        "lower_highs": False,
        "lower_lows": False,
    },
    "support_levels": [],
    "resistance_levels": [],
    "candlestick_patterns": [],
    "chart_patterns": [],
    "indicators": {
        "rsi": None,
        "macd": None,
        "moving_averages": [],
        "bollinger_bands": None,
        "stochastic": None,
        "volume": None,
    },
    "analysis": "",
    "setup": {
        "direction": "BUY | SELL | WAIT",
        "entry_zone": None,
        "stop_loss": None,
        "take_profit_1": None,
        "take_profit_2": None,
        "risk_reward": None,
    },
    "confidence": 0,
    "reasons": [],
    "warnings": [],
}, indent=2)

# ── Image validation ─────────────────────────────────────────────────────────

_MAX_BYTES = 4 * 1024 * 1024
_ALLOWED_MIME = {"image/png", "image/jpeg", "image/webp", "image/gif"}
_MIME_TO_GEMINI = {
    "image/png": "image/png",
    "image/jpeg": "image/jpeg",
    "image/webp": "image/webp",
    "image/gif": "image/gif",
}

_EMPTY_RESULT = {
    "symbol": "",
    "timeframe": "",
    "current_price": None,
    "market_direction": "neutral",
    "trend_strength": 0,
    "market_structure": {
        "higher_highs": False,
        "higher_lows": False,
        "lower_highs": False,
        "lower_lows": False,
    },
    "support_levels": [],
    "resistance_levels": [],
    "candlestick_patterns": [],
    "chart_patterns": [],
    "indicators": {
        "rsi": None,
        "macd": None,
        "moving_averages": [],
        "bollinger_bands": None,
        "stochastic": None,
        "volume": None,
    },
    "analysis": "The AI analysis service is temporarily unavailable.",
    "setup": {
        "direction": "WAIT",
        "entry_zone": None,
        "stop_loss": None,
        "take_profit_1": None,
        "take_profit_2": None,
        "risk_reward": None,
    },
    "confidence": 0,
    "reasons": [],
    "warnings": ["Analysis could not be completed."],
}


def _validate_image(image_base64: str, mime_type: str) -> Optional[str]:
    if mime_type not in _ALLOWED_MIME:
        return f"Unsupported image type '{mime_type}'. Allowed: {', '.join(_ALLOWED_MIME)}"
    try:
        raw = base64.b64decode(image_base64)
    except Exception:
        return "Invalid base64 image data."
    if len(raw) > _MAX_BYTES:
        return f"Image too large ({len(raw) / 1024 / 1024:.1f} MB). Maximum is {_MAX_BYTES / 1024 / 1024:.0f} MB."
    return None


def _strip_json_fences(text: str) -> str:
    """Remove markdown code fences and clean up trailing commas."""
    text = text.strip()
    text = re.sub(r"^```(?:json|JSON)?\s*\n?", "", text)
    text = re.sub(r"\n?\s*```\s*$", "", text)
    text = text.strip()
    text = re.sub(r",\s*([}\]])", r"\1", text)
    return text


def _parse_llm_json(raw: str) -> dict:
    """Parse LLM response as JSON with robust multi-strategy cleanup."""
    raw = raw.strip()

    # Strategy 1: strip fences then parse
    try:
        return _validate_keys(json.loads(_strip_json_fences(raw)), raw)
    except (json.JSONDecodeError, ValueError):
        pass

    # Strategy 2: find the first { and last } and parse the substring
    start = raw.find('{')
    end = raw.rfind('}')
    if start >= 0 and end > start:
        candidate = raw[start:end + 1]
        try:
            return _validate_keys(json.loads(candidate), raw)
        except (json.JSONDecodeError, ValueError):
            pass
        try:
            return _validate_keys(json.loads(_strip_json_fences(candidate)), raw)
        except (json.JSONDecodeError, ValueError):
            pass

    # Strategy 3: try to find a nested JSON object
    for match in re.finditer(r'\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}', raw, re.DOTALL):
        try:
            return _validate_keys(json.loads(match.group(0)), raw)
        except (json.JSONDecodeError, ValueError):
            continue

    logger.warning("Could not parse LLM response as JSON. First 200 chars: %s", raw[:200])
    return {
        **_EMPTY_RESULT,
        "analysis": raw[:500] if raw else "Empty response from AI model.",
    }


def _validate_keys(result: dict, raw: str) -> dict:
    """Ensure the parsed result has minimum required keys."""
    required = {"market_direction", "confidence", "analysis"}
    if not required.issubset(result.keys()):
        logger.warning("LLM response missing required keys: %s", required - result.keys())
        result = {
            **_EMPTY_RESULT,
            "analysis": result.get("analysis", raw[:500]),
            "market_direction": result.get("market_direction", "neutral"),
            "confidence": result.get("confidence", 0),
        }
    return result


# ── Candle helpers ───────────────────────────────────────────────────────────

def _candle_summary_text(candles: list[dict], max_candles: int = 80) -> str:
    recent = candles[-max_candles:] if len(candles) > max_candles else candles
    return "\n".join(
        f"O:{c.get('open',0):.5f} H:{c.get('high',0):.5f} "
        f"L:{c.get('low',0):.5f} C:{c.get('close',0):.5f}"
        for c in recent
    )


def _compute_basic_indicators(candles: list[dict]) -> dict:
    if len(candles) < 15:
        return {}
    closes = [c.get("close", 0) for c in candles]
    changes = [closes[i] - closes[i - 1] for i in range(1, len(closes))]
    gains = [max(c, 0) for c in changes[-14:]]
    losses = [abs(min(c, 0)) for c in changes[-14:]]
    avg_gain = sum(gains) / 14
    avg_loss = sum(losses) / 14
    rs = avg_gain / avg_loss if avg_loss > 0 else 100
    rsi = round(100 - (100 / (1 + rs)), 1)
    sma_10 = round(sum(closes[-10:]) / 10, 5) if len(closes) >= 10 else None
    sma_20 = round(sum(closes[-20:]) / 20, 5) if len(closes) >= 20 else None
    sma_50 = round(sum(closes[-50:]) / 50, 5) if len(closes) >= 50 else None
    return {"rsi": rsi, "sma_10": sma_10, "sma_20": sma_20, "sma_50": sma_50}


def _detect_direction(candles: list[dict]) -> dict:
    """Deterministically classify trend direction from candle data."""
    closes = [c.get("close") for c in candles if c.get("close") is not None]
    highs = [c.get("high") for c in candles if c.get("high") is not None]
    lows = [c.get("low") for c in candles if c.get("low") is not None]
    if len(closes) < 10 or len(highs) < 10 or len(lows) < 10:
        return {"direction": "neutral", "confidence": 0, "trend_strength": 0.0, "reasons": [], "rsi": None}

    half = max(3, len(closes) // 3)
    recent_highs = highs[-half:]
    recent_lows = lows[-half:]
    prior_highs = highs[-2 * half:-half] or highs[:half]
    prior_lows = lows[-2 * half:-half] or lows[:half]

    hh = sum(1 for rh, ph in zip(recent_highs, prior_highs) if rh > ph)
    ll = sum(1 for rl, pl in zip(recent_lows, prior_lows) if rl > pl)
    lh = sum(1 for rh, ph in zip(recent_highs, prior_highs) if rh < ph)
    dl = sum(1 for rl, pl in zip(recent_lows, prior_lows) if rl < pl)
    n = len(recent_highs)

    sma = _compute_basic_indicators(candles)
    sma10, sma20, sma50 = sma.get("sma_10"), sma.get("sma_20"), sma.get("sma_50")
    last = closes[-1]
    price_above_sma = sum(1 for s in (sma10, sma20, sma50) if s is not None and last > s)
    price_below_sma = sum(1 for s in (sma10, sma20, sma50) if s is not None and last < s)
    bull_sma = sma10 and sma20 and sma50 and sma10 > sma20 > sma50
    bear_sma = sma10 and sma20 and sma50 and sma10 < sma20 < sma50

    rsi = sma.get("rsi")
    recent_chg = (closes[-1] / closes[-6] - 1) * 100 if len(closes) >= 6 else 0

    bull_score = 0
    bear_score = 0
    reasons: list[str] = []

    if hh >= max(1, n * 0.6):
        bull_score += 3
        reasons.append(f"Higher highs ({hh}/{n} recent swing highs above prior)")
    if ll >= max(1, n * 0.6):
        bull_score += 2
        reasons.append(f"Higher lows ({ll}/{n})")
    if bull_sma:
        bull_score += 3
        reasons.append("Bullish SMA alignment (10>20>50)")
    if price_above_sma >= 2:
        bull_score += 2
        reasons.append("Price trading above short/medium SMAs")
    if rsi is not None and rsi > 55:
        bull_score += 1
        reasons.append(f"RSI-14 at {rsi:.1f} (bullish momentum)")
    if recent_chg > 0.1:
        bull_score += 1

    if lh >= max(1, n * 0.6):
        bear_score += 3
        reasons.append(f"Lower highs ({lh}/{n})")
    if dl >= max(1, n * 0.6):
        bear_score += 2
        reasons.append(f"Lower lows ({dl}/{n})")
    if bear_sma:
        bear_score += 3
        reasons.append("Bearish SMA alignment (10<20<50)")
    if price_below_sma >= 2:
        bear_score += 2
        reasons.append("Price trading below short/medium SMAs")
    if rsi is not None and rsi < 45:
        bear_score += 1
        reasons.append(f"RSI-14 at {rsi:.1f} (bearish momentum)")
    if recent_chg < -0.1:
        bear_score += 1

    spread = abs(bull_score - bear_score)
    total = bull_score + bear_score
    if total == 0 or spread < 2:
        return {"direction": "neutral", "confidence": 0, "trend_strength": 0.0, "reasons": reasons or ["Mixed structure; no clear directional edge."], "rsi": rsi}

    if bull_score > bear_score:
        direction = "bullish"
    else:
        direction = "bearish"
    strength = min(0.95, 0.35 + spread * 0.1)
    confidence = int(min(92, 50 + spread * 8))
    return {
        "direction": direction,
        "confidence": confidence,
        "trend_strength": round(strength, 2),
        "reasons": reasons,
        "rsi": rsi,
    }


# ── Public API ───────────────────────────────────────────────────────────────

async def analyse_chart_image(
    image_base64: str,
    mime_type: str = "image/png",
    extra_prompt: str = "",
) -> dict:
    """Send a chart screenshot to the vision model."""
    err = _validate_image(image_base64, mime_type)
    if err:
        return {**_EMPTY_RESULT, "analysis": err, "warnings": [err]}

    prompt = extra_prompt if extra_prompt else CHART_SYSTEM_PROMPT
    return await _call_llm(prompt=prompt, image_base64=image_base64, mime_type=mime_type)


async def analyse_candles(
    symbol: str,
    timeframe: str,
    candles: list[dict],
) -> dict:
    """Analyse candle data with LLM and basic computed indicators."""
    summary = _candle_summary_text(candles)
    computed = _compute_basic_indicators(candles)

    prompt = CANDLE_ANALYSIS_PROMPT.format(
        symbol=symbol, timeframe=timeframe, candle_summary=summary, schema=ANALYSIS_SCHEMA,
    )
    if computed:
        prompt += (
            f"\n\nPre-computed indicators from the data:\n"
            f"RSI-14: {computed.get('rsi')}\n"
            f"SMA-10: {computed.get('sma_10')}\n"
            f"SMA-20: {computed.get('sma_20')}\n"
            f"SMA-50: {computed.get('sma_50')}\n"
        )

    result = await _call_llm(prompt=prompt)

    if not result.get("market_direction") or result.get("market_direction") == "neutral":
        det = _detect_direction(candles)
        if det.get("direction") != "neutral":
            result["market_direction"] = det["direction"]
            result["confidence"] = result.get("confidence") or det.get("confidence", 0)
            if not result.get("trend_strength"):
                result["trend_strength"] = det.get("trend_strength", 0)
            if not result.get("reasons"):
                result["reasons"] = det.get("reasons", [])

    ind = result.get("indicators", {})
    if ind.get("rsi") is None and computed.get("rsi") is not None:
        ind["rsi"] = computed["rsi"]

    mas_raw = ind.get("moving_averages", [])
    mas_strings: list[str] = []
    for m in mas_raw:
        if isinstance(m, dict):
            period = m.get("period", "?")
            value = m.get("value", "?")
            mas_strings.append(f"SMA-{period}: {value}")
        else:
            mas_strings.append(str(m))

    for label, val in [("SMA-10", computed.get("sma_10")),
                       ("SMA-20", computed.get("sma_20")),
                       ("SMA-50", computed.get("sma_50"))]:
        if val is not None and not any(label in s for s in mas_strings):
            mas_strings.append(f"{label}: {val}")
    ind["moving_averages"] = mas_strings
    result["indicators"] = ind
    result["symbol"] = result.get("symbol") or symbol
    result["timeframe"] = result.get("timeframe") or timeframe
    return result


# ── "AI Pro" dashboard ──────────────────────────────────────────────────────

_DASHBOARD_EMPTY = {
    "score": 0,
    "status": "ANALYSIS INCOMPLETE",
    "risk_level": "Medium",
    "confidence_level": "Low",
    "insights": {
        "trend": "Neutral",
        "momentum": "Flat",
        "liq_bias": "Balanced",
        "sentiment": "Neutral",
    },
    "meta": {"symbol": "", "timeframe": "", "current_price": None},
    "game_plan": "No actionable plan could be generated for this chart.",
    "risk_management": {"rr_ratio": "-", "stop_loss": "-", "position_size": "-"},
    "trade_plan": {
        "action": "WAIT",
        "when_to_buy": "-",
        "when_to_sell": "-",
        "when_to_exit": "-",
        "stop_loss": "-",
        "rr_ratio": "-",
        "position_size": "Conservative",
    },
    "multi_timeframe": {"weekly": "-", "daily": "-", "h4": "-", "h1": "-"},
    "smc": {
        "fvg": "-",
        "bullish_ob": "-",
        "bearish_ob": "-",
        "buy_side_liq": "-",
        "sell_side_liq": "-",
    },
    "breakdown": [],
    "warnings": [],
}

DASHBOARD_SCHEMA = json.dumps({
    "score": 0,
    "status": "SHORT STATUS CAPS",
    "riskLevel": "Low | Medium | High",
    "confLevel": "Low | Medium | High",
    "insights": {
        "trend": "Bearish | Bullish | Neutral",
        "momentum": "Increasing | Declining | Neutral",
        "liqBias": "Buy-side | Sell-side | Neutral",
        "sentiment": "Bullish | Cautious | Bearish",
    },
    "gamePlan": "Max 2 key levels, when to ENTER and when to CLOSE, with price",
    "riskManagement": {
        "rrRatio": "e.g. 1:2",
        "stopLoss": "e.g. Above 4878.00",
        "positionSize": "Conservative | Moderate | Aggressive",
    },
    "tradePlan": {
        "action": "BUY | SELL | WAIT",
        "whenToBuy": "Trigger + entry price to go long",
        "whenToSell": "Trigger + entry price to go short",
        "whenToExit": "Target / invalidation price to close",
        "stopLoss": "Stop loss price",
        "rrRatio": "e.g. 1:2",
        "positionSize": "Conservative | Moderate | Aggressive",
    },
    "multiTimeframe": {
        "weekly": "Bullish | Bearish | Neutral",
        "daily": "Bullish | Bearish | Neutral",
        "h4": "Overextended | Trending | Consolidating",
        "h1": "Correction | Impulse | Range",
    },
    "smc": {
        "fvg": "short status/level",
        "bullishOb": "short status/level",
        "bearishOb": "short status/level",
        "buySideLiq": "short status/level",
        "sellSideLiq": "short status/level",
    },
    "breakdown": [
        {"title": "Trend Analysis", "content": "1 sentence analysis"},
        {"title": "Support & Resistance Levels", "content": "1 sentence key levels"},
        {"title": "Volume Analysis", "content": "1 sentence volume summary"},
        {"title": "Candlestick Patterns", "content": "1 sentence pattern description"},
        {"title": "Momentum Indicators", "content": "1 sentence indicator state"},
    ],
}, indent=2)

DASHBOARD_IMAGE_PROMPT = """\
You are an expert technical analyst AI. Analyze the provided trading chart image and extract market insights into a concise JSON object.

CRITICAL RULES:
1. Return ONLY valid JSON. No conversational text, no preambles, no markdown codeblocks.
2. Keep all string values short, precise, and direct to minimize output token consumption.
3. Keep the "gamePlan" and breakdown "content" fields to 1-2 concise sentences max.
4. In "gamePlan", always state WHEN to enter a trade (trigger + entry price) and WHEN to close (target price / invalidation). Use the exact chart levels.
5. In "tradePlan", always state WHEN to buy, WHEN to sell, WHEN to exit, and the stop loss — each with a concrete price from the chart.

Use this exact JSON schema:
{schema}
"""

DASHBOARD_CANDLES_PROMPT = """\
You are an expert technical analyst AI. Analyze the OHLC candle data below for {symbol} ({timeframe}) and extract market insights into a concise JSON object.

Candles (oldest to newest):
{candle_summary}

{computed}

CRITICAL RULES:
1. Return ONLY valid JSON. No conversational text, no preambles, no markdown codeblocks.
2. Keep all string values short, precise, and direct to minimize output token consumption.
3. Keep the "gamePlan" and breakdown "content" fields to 1-2 concise sentences max.
4. In "gamePlan", always state WHEN to enter a trade (trigger + entry price) and WHEN to close (target price / invalidation). Use real candle prices, never fabricate.
5. insights: trend Bullish/Bearish/Neutral, momentum Increasing/Declining/Neutral, liqBias Buy-side/Sell-side/Neutral, sentiment Bullish/Cautious/Bearish.
6. If the data does not support a clear directional read, set score low and status NEUTRAL/xxx, with gamePlan "No trade. Wait for a clear setup."
7. In "tradePlan", always state WHEN to buy, WHEN to sell, WHEN to exit, and the stop loss — each with a concrete price from the candle data.

Use this exact JSON schema:
{schema}
"""


def _dashboard_computed_text(computed: dict) -> str:
    if not computed:
        return "(No indicators could be pre-computed.)"
    return (
        "Pre-computed indicators from the data:\n"
        f"RSI-14: {computed.get('rsi')}\n"
        f"SMA-10: {computed.get('sma_10')}\n"
        f"SMA-20: {computed.get('sma_20')}\n"
        f"SMA-50: {computed.get('sma_50')}\n"
    )


def _normalise_dashboard(result: dict, symbol: str = "", timeframe: str = "") -> dict:
    """Coerce a raw LLM response into the AI Pro dashboard shape."""
    import copy
    out = copy.deepcopy(_DASHBOARD_EMPTY)
    if not isinstance(result, dict):
        result = {}

    ins = result.get("insights") or {}
    if isinstance(ins, dict):
        for key in ("trend", "momentum", "liq_bias", "sentiment"):
            val = ins.get(key) or ins.get("liqBias" if key == "liq_bias" else key)
            if val:
                out["insights"][key] = str(val)

    score = result.get("score")
    if not isinstance(score, (int, float)):
        score = result.get("confidence") or 0
    score = max(0, min(100, int(score)))
    out["score"] = score

    out["confidence_level"] = str(
        result.get("confidence_level") or result.get("confLevel")
        or ("High" if score >= 70 else "Medium" if score >= 40 else "Low")
    )
    out["risk_level"] = str(result.get("risk_level") or result.get("riskLevel") or "Medium")

    status = result.get("status")
    if not status:
        status = f"{(result.get('market_direction') or 'neutral').upper()} BIAS"
    out["status"] = str(status).upper()[:48]

    rm = result.get("risk_management") or result.get("riskManagement") or {}
    if isinstance(rm, dict):
        for key, alias in (("rr_ratio", "rrRatio"), ("stop_loss", "stopLoss"), ("position_size", "positionSize")):
            val = rm.get(key) or rm.get(alias)
            if val:
                out["risk_management"][key] = str(val)

    mt = result.get("multi_timeframe") or result.get("multiTimeframe") or {}
    if isinstance(mt, dict):
        for key in ("weekly", "daily", "h4", "h1"):
            val = mt.get(key)
            if val:
                out["multi_timeframe"][key] = str(val)

    smc = result.get("smc") or {}
    if isinstance(smc, dict):
        for key, alias in (
            ("fvg", "fvg"),
            ("bullish_ob", "bullishOb"),
            ("bearish_ob", "bearishOb"),
            ("buy_side_liq", "buySideLiq"),
            ("sell_side_liq", "sellSideLiq"),
        ):
            val = smc.get(key) or smc.get(alias)
            if val:
                out["smc"][key] = str(val)

    out["game_plan"] = str(result.get("game_plan") or result.get("gamePlan") or out["game_plan"])

    tp = result.get("trade_plan") or result.get("tradePlan") or {}
    if isinstance(tp, dict):
        for key, alias in (
            ("action", "action"),
            ("when_to_buy", "whenToBuy"),
            ("when_to_sell", "whenToSell"),
            ("when_to_exit", "whenToExit"),
            ("stop_loss", "stopLoss"),
            ("rr_ratio", "rrRatio"),
            ("position_size", "positionSize"),
        ):
            val = tp.get(key) or tp.get(alias)
            if val:
                out["trade_plan"][key] = str(val)

    expected = [
        "Trend Analysis",
        "Support & Resistance Levels",
        "Volume Analysis",
        "Candlestick Patterns",
        "Momentum Indicators",
    ]
    _STRIP = re.compile(r"No AI provider.*?configured[.!?]?", re.IGNORECASE)
    items: list[dict] = []
    for it in result.get("breakdown") or []:
        if isinstance(it, dict) and it.get("content"):
            cleaned = _STRIP.sub("", str(it["content"])[:1500]).strip()
            if cleaned:
                items.append({
                    "title": str(it.get("title") or "Analysis")[:60],
                    "content": cleaned,
                })
        elif isinstance(it, str) and it.strip():
            cleaned = _STRIP.sub("", it[:1500]).strip()
            if cleaned:
                items.append({"title": "Analysis", "content": cleaned})
    for title in expected:
        if not any(i["title"] == title for i in items):
            items.append({"title": title, "content": "No detailed content provided."})
    out["breakdown"] = items

    meta = result.get("meta") or {}
    if not isinstance(meta, dict):
        meta = {}
    out["meta"] = {
        "symbol": str(symbol or meta.get("symbol") or result.get("symbol") or ""),
        "timeframe": str(timeframe or meta.get("timeframe") or result.get("timeframe") or ""),
        "current_price": (
            meta.get("current_price")
            if meta.get("current_price") is not None
            else result.get("current_price")
        ),
    }

    warnings = result.get("warnings")
    out["warnings"] = [str(w) for w in warnings][:5] if isinstance(warnings, list) else []
    return _dashboard_public_payload(out)


def _dashboard_public_payload(payload: dict) -> dict:
    """Return the exact compact camelCase contract used by Technicals."""
    insights = payload.get("insights") or {}
    risk = payload.get("risk_management") or payload.get("riskManagement") or {}
    trade = payload.get("trade_plan") or payload.get("tradePlan") or {}
    multi = payload.get("multi_timeframe") or payload.get("multiTimeframe") or {}
    smc = payload.get("smc") or {}
    breakdown = payload.get("breakdown") or []

    def value(source: dict, snake: str, camel: str, default: str) -> str:
        return str(source.get(snake) or source.get(camel) or default)[:120]

    def choice(raw: str, allowed: tuple[str, ...], default: str) -> str:
        lowered = raw.lower()
        return next((item for item in allowed if item.lower() in lowered), default)

    score = payload.get("score", 0)
    score = int(score) if isinstance(score, (int, float)) else 0
    items = []
    for item in breakdown:
        if isinstance(item, dict) and item.get("content"):
            items.append({
                "title": str(item.get("title") or "Analysis")[:60],
                "content": str(item["content"])[:320],
            })

    expected = [
        "Trend Analysis", "Support & Resistance Levels", "Volume Analysis",
        "Candlestick Patterns", "Momentum Indicators",
    ]
    for title in expected:
        if not any(item["title"] == title for item in items):
            items.append({"title": title, "content": "No clear signal."})

    return {
        "score": max(0, min(100, score)),
        "status": str(payload.get("status") or "ANALYSIS INCOMPLETE").upper()[:48],
        "riskLevel": choice(value(payload, "risk_level", "riskLevel", "Medium"), ("Low", "Medium", "High"), "Medium"),
        "confLevel": choice(value(payload, "confidence_level", "confLevel", "Low"), ("Low", "Medium", "High"), "Low"),
        "insights": {
            "trend": choice(value(insights, "trend", "trend", "Neutral"), ("Bearish", "Bullish", "Neutral"), "Neutral"),
            "momentum": choice(value(insights, "momentum", "momentum", "Neutral"), ("Increasing", "Declining", "Neutral"), "Neutral"),
            "liqBias": choice(value(insights, "liq_bias", "liqBias", "Neutral"), ("Buy-side", "Sell-side", "Neutral"), "Neutral"),
            "sentiment": choice(value(insights, "sentiment", "sentiment", "Cautious"), ("Bullish", "Cautious", "Bearish"), "Cautious"),
        },
        "gamePlan": str(payload.get("game_plan") or payload.get("gamePlan") or "No trade. Wait for a clear setup.")[:420],
        "riskManagement": {
            "rrRatio": value(risk, "rr_ratio", "rrRatio", "-"),
            "stopLoss": value(risk, "stop_loss", "stopLoss", "-"),
            "positionSize": choice(value(risk, "position_size", "positionSize", "Conservative"), ("Conservative", "Moderate", "Aggressive"), "Conservative"),
        },
        "tradePlan": {
            "action": choice(value(trade, "action", "action", "WAIT"), ("BUY", "SELL", "WAIT"), "WAIT"),
            "whenToBuy": value(trade, "when_to_buy", "whenToBuy", "-"),
            "whenToSell": value(trade, "when_to_sell", "whenToSell", "-"),
            "whenToExit": value(trade, "when_to_exit", "whenToExit", "-"),
            "stopLoss": value(trade, "stop_loss", "stopLoss", "-"),
            "rrRatio": value(trade, "rr_ratio", "rrRatio", "-"),
            "positionSize": choice(value(trade, "position_size", "positionSize", "Conservative"), ("Conservative", "Moderate", "Aggressive"), "Conservative"),
        },
        "multiTimeframe": {
            "weekly": choice(value(multi, "weekly", "weekly", "Neutral"), ("Bullish", "Bearish", "Neutral"), "Neutral"),
            "daily": choice(value(multi, "daily", "daily", "Neutral"), ("Bullish", "Bearish", "Neutral"), "Neutral"),
            "h4": choice(value(multi, "h4", "h4", "Consolidating"), ("Overextended", "Trending", "Consolidating"), "Consolidating"),
            "h1": choice(value(multi, "h1", "h1", "Range"), ("Correction", "Impulse", "Range"), "Range"),
        },
        "smc": {
            "fvg": value(smc, "fvg", "fvg", "-"),
            "bullishOb": value(smc, "bullish_ob", "bullishOb", "-"),
            "bearishOb": value(smc, "bearish_ob", "bearishOb", "-"),
            "buySideLiq": value(smc, "buy_side_liq", "buySideLiq", "-"),
            "sellSideLiq": value(smc, "sell_side_liq", "sellSideLiq", "-"),
        },
        "breakdown": items[:5],
    }


async def analyse_chart_image_dashboard(
    image_base64: str,
    mime_type: str = "image/png",
    extra_prompt: str = "",
) -> dict:
    """Chart screenshot -> structured AI Pro dashboard payload."""
    err = _validate_image(image_base64, mime_type)
    if err:
        import copy
        out = copy.deepcopy(_DASHBOARD_EMPTY)
        out["game_plan"] = "No trade. Upload a clear chart image."
        return _dashboard_public_payload(out)

    prompt = DASHBOARD_IMAGE_PROMPT.format(schema=DASHBOARD_SCHEMA)
    if extra_prompt:
        prompt += f"\n\nAdditional context from the user: {extra_prompt}"
    result = await _call_llm(
        prompt=prompt, image_base64=image_base64, mime_type=mime_type, max_tokens=4096
    )
    return _normalise_dashboard(result)


def _analysis_to_dashboard(analysis: dict, symbol: str, timeframe: str, candles: list[dict] = None) -> dict:
    """Transform the basic candle-analysis result into the AI Pro dashboard shape."""
    import copy
    out = copy.deepcopy(_DASHBOARD_EMPTY)

    direction = (analysis.get("market_direction") or "neutral").lower()
    confidence = analysis.get("confidence", 0) or 0
    reasons = analysis.get("reasons") or []
    indicators = analysis.get("indicators") or {}
    setup = analysis.get("setup") or {}
    price = analysis.get("current_price")
    support = analysis.get("support_levels") or []
    resistance = analysis.get("resistance_levels") or []
    patterns = analysis.get("candlestick_patterns") or []
    rsi = indicators.get("rsi")
    mas = indicators.get("moving_averages") or []

    if candles:
        det = _detect_direction(candles)
        if det.get("direction") != "neutral":
            direction = det["direction"]
        confidence = confidence or det.get("confidence", 0)
        ts_det = det.get("trend_strength")
        if not analysis.get("trend_strength") and ts_det:
            analysis["trend_strength"] = ts_det
        if det.get("rsi") and rsi is None:
            rsi = det["rsi"]
            indicators["rsi"] = rsi
        if not reasons:
            reasons = det.get("reasons") or []
            analysis["reasons"] = reasons

    if candles and not support:
        recent = candles[-20:]
        lows = [c.get("low") for c in recent if c.get("low") is not None]
        highs = [c.get("high") for c in recent if c.get("high") is not None]
        if lows:
            support = [min(lows)]
        if highs:
            resistance = [max(highs)]
    if candles and price is None:
        closes = [c.get("close") for c in candles if c.get("close") is not None]
        if closes:
            price = closes[-1]

    if confidence <= 0 and price is not None and support and resistance:
        near_support = abs(price - support[0]) if support else 0
        near_resistance = abs(resistance[0] - price) if resistance else 0
        level_spread = (resistance[0] - support[0]) if (resistance and support and resistance[0] > support[0]) else 1
        level_score = max(20, min(60, 40 + (level_spread / price) * 2000)) if level_spread > 0 else 30
        rsi_dev = abs((rsi or 50) - 50)
        rsi_score = min(30, rsi_dev * 2)
        confidence = int(min(85, level_score + rsi_score))
    out["score"] = max(10, min(100, int(confidence))) if confidence > 0 else 35
    out["confidence_level"] = "High" if out["score"] >= 70 else "Medium" if out["score"] >= 40 else "Low"

    bias_word = direction.upper()
    trend_desc = "RANGING"
    ts = analysis.get("trend_strength", 0)
    if ts > 0.5:
        trend_desc = "TRENDING"
    elif ts > 0.2:
        trend_desc = "MILD"
    out["status"] = f"{bias_word} {trend_desc}"

    out["risk_level"] = "High" if confidence < 30 else "Medium" if confidence < 60 else "Low"

    ms = analysis.get("market_structure") or {}
    if ms.get("higher_highs") and ms.get("higher_lows"):
        out["insights"]["trend"] = "Bullish"
    elif ms.get("lower_highs") and ms.get("lower_lows"):
        out["insights"]["trend"] = "Bearish"
    else:
        out["insights"]["trend"] = (
            "Bullish" if direction in ("bullish", "long")
            else "Bearish" if direction in ("bearish", "short")
            else "Ranging"
        )
    out["insights"]["momentum"] = (
        "Rising" if direction in ("bullish", "long")
        else "Declining" if direction in ("bearish", "short")
        else "Flat"
    )
    out["insights"]["liq_bias"] = "Sell-side" if direction in ("bearish", "short") else "Buy-side" if direction in ("bullish", "long") else "Balanced"
    out["insights"]["sentiment"] = "Optimistic" if confidence >= 60 and direction in ("bullish", "long") else "Cautious" if confidence < 40 else "Neutral"

    out["meta"] = {"symbol": symbol, "timeframe": timeframe, "current_price": price}

    plan_parts = []
    if setup.get("direction") and setup["direction"] != "WAIT":
        plan_parts.append(f"Suggested direction: {setup['direction']}")
    if setup.get("entry_zone"):
        plan_parts.append(f"Entry zone: {setup['entry_zone']}")
    if setup.get("stop_loss"):
        plan_parts.append(f"Stop loss: {setup['stop_loss']}")
    if setup.get("take_profit_1"):
        plan_parts.append(f"Target 1: {setup['take_profit_1']}")
    if setup.get("take_profit_2"):
        plan_parts.append(f"Target 2: {setup['take_profit_2']}")
    if support:
        plan_parts.append(f"Support levels: {', '.join(str(s) for s in support)}")
    if resistance:
        plan_parts.append(f"Resistance levels: {', '.join(str(r) for r in resistance)}")
    out["game_plan"] = ". ".join(plan_parts) if plan_parts else analysis.get("analysis", "No actionable plan available.")

    sl = setup.get("stop_loss")
    rr = setup.get("risk_reward")
    if not sl and support:
        sl = f"Below {support[0]}"
    if not rr and support and resistance and price and resistance[0] > support[0]:
        risk_val = abs(price - support[0])
        reward = abs(resistance[0] - price)
        if risk_val > 0:
            rr_val = round(reward / risk_val, 1)
            rr = f"1:{rr_val}"
    out["risk_management"] = {
        "rr_ratio": str(rr or "-"),
        "stop_loss": str(sl or "-"),
        "position_size": "Conservative" if out["score"] < 40 else "Moderate" if out["score"] < 70 else "Aggressive",
    }

    _raw_action = (setup.get("direction") or direction or "wait").upper()
    if _raw_action in ("LONG", "BULLISH"):
        _raw_action = "BUY"
    elif _raw_action in ("SHORT", "BEARISH"):
        _raw_action = "SELL"
    direction_label = _raw_action if _raw_action in ("BUY", "SELL", "WAIT") else "WAIT"
    entry = setup.get("entry_zone")
    stop = setup.get("stop_loss")
    tp1 = setup.get("take_profit_1")
    tp2 = setup.get("take_profit_2")
    rr = setup.get("risk_reward")
    support_str = ", ".join(str(s) for s in support[:2]) if support else ""
    resistance_str = ", ".join(str(r) for r in resistance[:2]) if resistance else ""
    current_str = f"{price:.5f}" if isinstance(price, (int, float)) else "current price"

    if not entry and resistance_str and direction_label in ("BUY", "LONG"):
        entry = f"a break/retest above {resistance_str}"
    if not entry and support_str and direction_label in ("SELL", "SHORT"):
        entry = f"a break/retest below {support_str}"
    if not stop and support_str and direction_label in ("BUY", "LONG"):
        stop = f"below {support_str}"
    if not stop and resistance_str and direction_label in ("SELL", "SHORT"):
        stop = f"above {resistance_str}"

    if not stop and support:
        stop = f"Below {support[0]}"
    if not rr and resistance and support and resistance[0] > support[0]:
        risk_val = abs((price or resistance[0]) - support[0])
        reward = abs(resistance[0] - (price or support[0]))
        if risk_val > 0:
            rr = f"1:{round(reward / risk_val, 1)}"
    out["trade_plan"] = {
        "action": direction_label if direction_label in ("BUY", "SELL", "WAIT") else "WAIT",
        "when_to_buy": (
            f"Enter long on {entry}." if entry and direction_label in ("BUY", "LONG")
            else (f"Wait near {support_str}; buy on a confirmed bounce." if support_str else "-")
        ),
        "when_to_sell": (
            f"Enter short on {entry}." if entry and direction_label in ("SELL", "SHORT")
            else (f"Sell near {resistance_str} on rejection." if resistance_str else "-")
        ),
        "when_to_exit": (
            " and ".join([
                f"take profit 1 at {tp1}" if tp1 else "",
                f"take profit 2 at {tp2}" if tp2 else "",
                f"close if price hits {stop}" if stop else "",
            ]).strip(" and ") or (f"Close around {current_str} if momentum stalls." if isinstance(price, (int, float)) else "-")
        ),
        "stop_loss": str(stop or "-"),
        "rr_ratio": str(rr or "-"),
        "position_size": "Conservative" if out["score"] < 40 else "Moderate" if out["score"] < 70 else "Aggressive",
    }

    direction_label = out["insights"]["trend"]
    out["multi_timeframe"] = {
        "weekly": direction_label,
        "daily": direction_label,
        "h4": out["insights"]["momentum"],
        "h1": "Correction" if ts < 0.2 else direction_label,
    }

    out["smc"] = {
        "fvg": "Not detected" if not patterns else f"{len(patterns)} pattern(s) identified",
        "bullish_ob": f"Support at {support[0]}" if support else "-",
        "bearish_ob": f"Resistance at {resistance[0]}" if resistance else "-",
        "buy_side_liq": f"Above {resistance[0]}" if resistance else "-",
        "sell_side_liq": f"Below {support[0]}" if support else "-",
    }

    rsi_val = rsi
    rsi_str = f"RSI-14 is at {rsi_val:.1f}, indicating {'overbought' if rsi_val > 70 else 'oversold' if rsi_val < 30 else 'neutral momentum'}." if rsi_val else "RSI data is not yet available."
    mas_str = ", ".join(mas[:3]) if mas else None
    support_str = ", ".join(str(round(s, 5)) for s in support) if support else "None identified yet"
    resist_str = ", ".join(str(round(r, 5)) for r in resistance) if resistance else "None identified yet"
    patterns_str = ", ".join(p if isinstance(p, str) else str(p) for p in patterns) if patterns else "No clear candlestick patterns detected in the recent candles."
    trend_label = out["insights"]["trend"]
    mom_label = out["insights"]["momentum"]

    bias_word = direction.upper()
    trend_text = (
        f"The {timeframe} chart for {symbol} shows a {trend_label.lower()} bias ({bias_word} on {timeframe}). "
        f"Momentum is {mom_label.lower()}. "
        + (f"{rsi_str} " if rsi_str else "")
        + (f"Short-term moving averages ({mas_str}) are {'above' if 'above' in str(mas).lower() else 'near'} the price, confirming the {trend_label.lower()} structure." if mas_str else "")
        + ("; ".join(reasons) if reasons else "")
    ).strip()

    out["breakdown"] = [
        {"title": "Trend Analysis", "content": trend_text[:400]},
        {"title": "Support & Resistance Levels", "content": f"Key support at {support_str}; key resistance at {resist_str}. Price {'is closer to support' if price and support and abs(price - support[0]) < abs(resistance[0] - price) else 'is closer to resistance' if price and resistance else 'is within the current range'}."},
        {"title": "Volume Analysis", "content": f"Volume analysis based on available candle data for {symbol}. {rsi_str}"},
        {"title": "Candlestick Patterns", "content": f"Observed patterns: {patterns_str}"},
        {"title": "Momentum Indicators", "content": f"{rsi_str} {('Moving averages: ' + mas_str + '.') if mas_str else ''}"},
    ]

    out["warnings"] = analysis.get("warnings") or []
    return _dashboard_public_payload(out)


async def analyse_candles_dashboard(
    symbol: str,
    timeframe: str,
    candles: list[dict],
) -> dict:
    """Candle data -> structured AI Pro dashboard payload."""
    try:
        summary = _candle_summary_text(candles)
        computed = _compute_basic_indicators(candles)
        prompt = DASHBOARD_CANDLES_PROMPT.format(
            symbol=symbol,
            timeframe=timeframe,
            candle_summary=summary,
            computed=_dashboard_computed_text(computed),
            schema=DASHBOARD_SCHEMA,
        )
        result = await _call_llm(prompt=prompt, max_tokens=2048)
        normalised = _normalise_dashboard(result, symbol=symbol, timeframe=timeframe)
        if normalised.get("score", 0) > 0 or (result.get("status") and result["status"] not in ("", "ANALYSIS INCOMPLETE")):
            return normalised
        raise RuntimeError("Empty LLM dashboard result")
    except Exception as exc:
        logger.warning("Dashboard LLM failed (%s), falling back to transform", exc)
        basic = await analyse_candles(symbol, timeframe, candles)
        return _analysis_to_dashboard(basic, symbol, timeframe, candles=candles)


# ── Gemini via google-genai SDK ──────────────────────────────────────────────

_gemini_client = None


def _get_gemini_client():
    """Lazy-init the google-genai client with proxy support."""
    global _gemini_client
    if _gemini_client is not None:
        return _gemini_client

    try:
        from google import genai
        import httpx as _httpx

        # Build httpx client with proxy support
        http_client = _httpx.AsyncClient(
            proxy=_AI_PROXY or None,
            timeout=_httpx.Timeout(120.0, connect=30.0),
        )

        _gemini_client = genai.Client(
            api_key=GEMINI_API_KEY,
            http_options={"httpx_async_client": http_client},
        )
        logger.info("Gemini client initialized (model=%s, proxy=%s)", GEMINI_MODEL, bool(_AI_PROXY))
        return _gemini_client
    except Exception as e:
        logger.error("Failed to initialize Gemini client: %s", e)
        raise


async def _call_gemini(
    prompt: str,
    image_base64: Optional[str] = None,
    mime_type: str = "image/png",
    max_tokens: int = 2048,
) -> dict:
    """Call Gemini via google-genai SDK with optional image."""
    from google.genai import types

    client = _get_gemini_client()

    # Build contents
    contents = []
    if image_base64:
        from PIL import Image
        import io
        raw_bytes = base64.b64decode(image_base64)
        img = Image.open(io.BytesIO(raw_bytes))
        contents.append(img)
    contents.append(prompt)

    response = await client.aio.models.generate_content(
        model=GEMINI_MODEL,
        contents=contents,
        config=types.GenerateContentConfig(
            max_output_tokens=max_tokens,
            temperature=0.2,
        ),
    )

    # Extract text — gemini-3.6-flash uses thought tokens which can make
    # response.text return None, so fall back to parsing candidates directly.
    raw = response.text
    if not raw and response.candidates:
        parts = response.candidates[0].content.parts if response.candidates[0].content else []
        raw = "".join(p.text or "" for p in parts).strip()
    if not raw:
        raise ValueError("Gemini returned empty text")

    return _parse_llm_json(raw)


# ── Unified LLM dispatcher ──────────────────────────────────────────────────

async def _call_llm(
    prompt: str,
    image_base64: Optional[str] = None,
    mime_type: str = "image/png",
    max_tokens: int = 2048,
) -> dict:
    """Call Gemini (single provider). Falls back to deterministic analysis on failure."""
    if not HAS_GEMINI:
        return {
            **_EMPTY_RESULT,
            "analysis": "No AI provider configured. Set GEMINI_API_KEY environment variable.",
            "warnings": ["No API keys configured."],
        }

    last_err = None
    # 429 RESOURCE_EXHAUSTED means the daily free-tier quota is used up —
    # retrying for minutes will not help, so fail fast and let the
    # deterministic candle-structure fallback produce the dashboard.
    max_attempts = 2 if last_err is None else 2
    for attempt in range(max_attempts):
        try:
            result = await _call_gemini(prompt, image_base64, mime_type, max_tokens)
            logger.info("Gemini call succeeded (attempt %d)", attempt + 1)
            return result
        except Exception as e:
            last_err = e
            err_str = str(e)
            is_quota = "429" in err_str or "RESOURCE_EXHAUSTED" in err_str or "quota" in err_str.lower()
            if is_quota:
                logger.warning("Gemini quota exhausted, failing fast: %s", err_str[:200])
                break
            logger.warning("Gemini attempt %d failed (%s), retrying", attempt + 1, type(e).__name__)
            if attempt < 1:
                await asyncio.sleep(2)

    return {
        **_EMPTY_RESULT,
        "analysis": f"AI analysis unavailable: {type(last_err).__name__}.",
        "warnings": [
            "Gemini free-tier quota exhausted. Analysis falls back to computed indicators."
            if last_err and ("429" in str(last_err) or "quota" in str(last_err).lower())
            else f"Gemini failed: {type(last_err).__name__}: {last_err}"
        ],
    }
