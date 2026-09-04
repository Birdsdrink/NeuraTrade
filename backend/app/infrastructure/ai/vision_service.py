"""AI Vision service for forex chart technical analysis.

Supports three providers with automatic fallback:
  1. Qwen2.5-VL-7B-Instruct via HuggingFace Inference API (primary)
  2. Qwen2.5-VL-72B-Instruct via OpenRouter (secondary — very cheap)
  3. Google Gemini via Google AI Studio (tertiary)

Configure via environment variables:
  # Primary: Qwen via HuggingFace
  HF_API_TOKEN  – HuggingFace API token (free at huggingface.co/settings/tokens)
  QWEN_MODEL    – Model id (default: Qwen/Qwen2.5-VL-7B-Instruct)

  # Secondary: Qwen via OpenRouter
  OPENROUTER_API_KEY – OpenRouter API key (free at openrouter.ai/keys)
  OPENROUTER_MODEL   – Model id (default: qwen/qwen2.5-vl-72b-instruct)

  # Tertiary: Google Gemini
  AI_API_KEY    – Google AI Studio API key
  AI_MODEL      – Gemini model id (default: gemini-3.6-flash)
"""

import os
import re
import json
import base64
import asyncio
import logging
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

# ── Provider config ──────────────────────────────────────────────────────────

# HuggingFace / Qwen
HF_API_TOKEN = (
    os.getenv("HF_API_TOKEN")
    or os.getenv("HF_TOKEN")
    or os.getenv("HUGGING_FACE_HUB_TOKEN")
    or ""
)
QWEN_MODEL = os.getenv("QWEN_MODEL", "Qwen/Qwen2.5-VL-7B-Instruct")
HF_INFERENCE_URL = f"https://api-inference.huggingface.co/models/{QWEN_MODEL}"

# OpenRouter / Qwen
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
OPENROUTER_MODEL = os.getenv("OPENROUTER_MODEL", "qwen/qwen2.5-vl-72b-instruct")
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

# Google Gemini
GEMINI_API_KEY = os.getenv("AI_API_KEY", "")
GEMINI_MODEL = os.getenv("AI_MODEL", "gemini-3.6-flash")
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta"

HAS_HF = bool(HF_API_TOKEN)
HAS_OPENROUTER = bool(OPENROUTER_API_KEY)
HAS_GEMINI = bool(GEMINI_API_KEY)

# Connectivity cache per provider (None=unknown, True=works, False=blocked)
_prov_status: dict[str, Optional[bool]] = {"hf": None, "or": None, "gemini": None}

logger.info(
    "Vision service init: HAS_HF=%s, HAS_OPENROUTER=%s, HAS_GEMINI=%s",
    HAS_HF, HAS_OPENROUTER, HAS_GEMINI,
)

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
for {symbol} ({timeframe}) and provide a comprehensive technical analysis.

Candles (oldest to newest):
{candle_summary}

Identify:
- Market direction and trend strength
- Support and resistance levels
- Candlestick and chart patterns
- Indicators (RSI, MACD, moving averages) calculable from the data
- A potential BUY/SELL/WAIT setup with entry, stop-loss, take-profit, risk/reward
- Confidence and reasoning

Return ONLY valid JSON matching this schema:
{schema}

Rules:
- Calculate RSI and simple moving averages from the candle data where possible.
- If something cannot be determined, use null or empty list.
- Do NOT invent information.
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

    ind = result.get("indicators", {})
    if ind.get("rsi") is None and computed.get("rsi") is not None:
        ind["rsi"] = computed["rsi"]

    # Normalize moving averages to string format
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


# ── Unified LLM dispatcher ──────────────────────────────────────────────────

async def _call_llm(
    prompt: str,
    image_base64: Optional[str] = None,
    mime_type: str = "image/png",
) -> dict:
    """Try providers in order: Qwen HF → OpenRouter → Gemini.
    Caches connectivity to avoid repeated slow timeouts."""
    providers = [
        ("hf", HAS_HF, lambda: _call_qwen(prompt, image_base64, mime_type)),
        ("or", HAS_OPENROUTER, lambda: _call_openrouter(prompt, image_base64, mime_type)),
        ("gemini", HAS_GEMINI, lambda: _call_gemini(prompt, image_base64, mime_type)),
    ]

    available = [(k, fn) for k, has, fn in providers if has and _prov_status.get(k) is not False]
    if not available:
        return _no_provider_result()

    last_err = None
    for key, fn in available:
        try:
            result = await fn()
            _prov_status[key] = True
            logger.info("Provider %s call succeeded", key)
            return result
        except httpx.ConnectError as e:
            logger.warning("Provider %s blocked by proxy: %s", key, e)
            _prov_status[key] = False
            last_err = e
        except httpx.HTTPStatusError as e:
            status = e.response.status_code
            if status in (503, 429):
                logger.warning("Provider %s returned %d (transient), trying next", key, status)
            else:
                logger.warning("Provider %s returned %d", key, status)
                _prov_status[key] = False
            last_err = e
        except Exception as e:
            logger.warning("Provider %s failed: %s: %s", key, type(e).__name__, e)
            last_err = e

    return {
        **_EMPTY_RESULT,
        "analysis": "All AI providers failed. Please try again later.",
        "warnings": [f"Last error: {last_err}" if last_err else "All providers unavailable."],
    }


def _no_provider_result() -> dict:
    missing = []
    if not HAS_HF:
        missing.append("HF_API_TOKEN (Qwen via HuggingFace)")
    if not HAS_OPENROUTER:
        missing.append("OPENROUTER_API_KEY (Qwen via OpenRouter)")
    if not HAS_GEMINI:
        missing.append("AI_API_KEY (Gemini via Google)")
    return {
        **_EMPTY_RESULT,
        "analysis": f"No AI provider configured. Set one of: {', '.join(missing)}",
        "warnings": ["No API keys configured."],
    }


# ── Qwen via HuggingFace ────────────────────────────────────────────────────

async def _call_qwen(
    prompt: str,
    image_base64: Optional[str] = None,
    mime_type: str = "image/png",
) -> dict:
    messages = [{"role": "user", "content": []}]
    if image_base64:
        messages[0]["content"].append({
            "type": "image_url",
            "image_url": {"url": f"data:{mime_type};base64,{image_base64}"},
        })
    messages[0]["content"].append({"type": "text", "text": prompt})

    payload = {"model": QWEN_MODEL, "messages": messages, "max_tokens": 2048, "temperature": 0.2}
    headers = {"Authorization": f"Bearer {HF_API_TOKEN}", "Content-Type": "application/json"}

    # Short timeout — if blocked by proxy we want to fail fast
    async with httpx.AsyncClient(timeout=15, trust_env=False) as client:
        resp = await client.post(HF_INFERENCE_URL, json=payload, headers=headers)
        resp.raise_for_status()
        body = resp.json()

    raw = body["choices"][0]["message"]["content"].strip()
    return _parse_llm_json(raw)


# ── Qwen via OpenRouter (OpenAI-compatible) ──────────────────────────────────

async def _call_openrouter(
    prompt: str,
    image_base64: Optional[str] = None,
    mime_type: str = "image/png",
) -> dict:
    """Call Qwen VL model via OpenRouter's OpenAI-compatible API."""
    content: list = []
    if image_base64:
        content.append({
            "type": "image_url",
            "image_url": {"url": f"data:{mime_type};base64,{image_base64}"},
        })
    content.append({"type": "text", "text": prompt})

    payload = {
        "model": OPENROUTER_MODEL,
        "messages": [{"role": "user", "content": content}],
        "max_tokens": 2048,
        "temperature": 0.2,
    }
    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://ai-trading-assistant.local",
        "X-Title": "AI Trading Assistant",
    }

    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(OPENROUTER_URL, json=payload, headers=headers)
        resp.raise_for_status()
        body = resp.json()

    raw = body["choices"][0]["message"]["content"].strip()
    return _parse_llm_json(raw)


# ── Gemini via Google AI Studio (native generateContent API) ─────────────────

async def _call_gemini(
    prompt: str,
    image_base64: Optional[str] = None,
    mime_type: str = "image/png",
) -> dict:
    """Call Gemini via the native generateContent API with inline image data."""
    url = f"{GEMINI_URL}/models/{GEMINI_MODEL}:generateContent?key={GEMINI_API_KEY}"

    parts = []
    if image_base64:
        gemini_mime = _MIME_TO_GEMINI.get(mime_type, "image/png")
        parts.append({
            "inline_data": {
                "mime_type": gemini_mime,
                "data": image_base64,
            }
        })
    parts.append({"text": prompt})

    payload = {
        "contents": [{"parts": parts}],
        "generationConfig": {
            "maxOutputTokens": 2048,
            "temperature": 0.2,
        },
    }

    async with httpx.AsyncClient(timeout=90) as client:
        resp = await client.post(url, json=payload)
        resp.raise_for_status()
        body = resp.json()

    # Extract text from Gemini response
    candidates = body.get("candidates", [])
    if not candidates:
        raise ValueError("Gemini returned no candidates")

    content = candidates[0].get("content", {})
    parts_out = content.get("parts", [])
    raw = "".join(p.get("text", "") for p in parts_out).strip()

    if not raw:
        raise ValueError("Gemini returned empty text")

    return _parse_llm_json(raw)
