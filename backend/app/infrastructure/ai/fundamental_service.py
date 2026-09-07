"""Fundamental analysis service.

Fetches financial news for a given instrument via Google News RSS feeds,
then sends the headlines + summary to the AI model (same providers as vision_service)
to produce a structured buy/sell/wait fundamental verdict.
"""

import os
import re
import json
import logging
import asyncio
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from typing import Optional
from xml.etree import ElementTree

import httpx

logger = logging.getLogger(__name__)

# ── Provider config (shared with vision_service) ─────────────────────────────

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
OPENROUTER_MODEL = os.getenv("OPENROUTER_MODEL", "qwen/qwen2.5-vl-72b-instruct")
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

GEMINI_API_KEY = os.getenv("AI_API_KEY", "")
GEMINI_MODEL = os.getenv("AI_MODEL", "gemini-3.6-flash")
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta"

HAS_OPENROUTER = bool(OPENROUTER_API_KEY)
HAS_GEMINI = bool(GEMINI_API_KEY)

# Provider connectivity cache
_or_ok: Optional[bool] = None
_gemini_ok: Optional[bool] = None

logger.info("Fundamental service init: HAS_OPENROUTER=%s, HAS_GEMINI=%s", HAS_OPENROUTER, HAS_GEMINI)

# ── Symbol → search terms mapping ────────────────────────────────────────────

_PAIR_NAMES = {
    "frxEURUSD": ("EUR USD", "Euro US Dollar"),
    "frxGBPUSD": ("GBP USD", "British Pound US Dollar"),
    "frxUSDJPY": ("USD JPY", "US Dollar Japanese Yen"),
    "frxAUDUSD": ("AUD USD", "Australian Dollar US Dollar"),
    "frxUSDCAD": ("USD CAD", "US Dollar Canadian Dollar"),
    "frxUSDCHF": ("USD CHF", "US Dollar Swiss Franc"),
    "frxNZDUSD": ("NZD USD", "New Zealand Dollar US Dollar"),
    "frxEURGBP": ("EUR GBP", "Euro British Pound"),
    "frxEURJPY": ("EUR JPY", "Euro Japanese Yen"),
    "frxGBPJPY": ("GBP JPY", "British Pound Japanese Yen"),
    "frxAUDJPY": ("AUD JPY", "Australian Dollar Japanese Yen"),
    "cryBTCUSD": ("Bitcoin BTC", "Bitcoin"),
    "cryETHUSD": ("Ethereum ETH", "Ethereum"),
    "cryLTCUSD": ("Litecoin LTC", "Litecoin"),
    "cryXRPUSD": ("XRP Ripple", "XRP"),
    "cryBCHUSD": ("Bitcoin Cash BCH", "Bitcoin Cash"),
}

# Commodity / index search terms
_COMMODITY_NAMES = {
    "Gold": ("Gold price", "XAU USD"),
    "Silver": ("Silver price", "XAG USD"),
    "Wall Street 30": ("Dow Jones index", "Wall Street"),
    "US 500": ("S&P 500", "US stock market"),
    "US Tech 100": ("Nasdaq 100", "Nasdaq"),
    "US Small Cap 2000": ("Russell 2000", "small cap stocks"),
    "Germany 40": ("DAX 40", "German stock index"),
    "Japan 225": ("Nikkei 225", "Japanese stock index"),
    "UK 100": ("FTSE 100", "London stock index"),
    "US Dollar Index": ("US Dollar Index DXY", "DXY"),
}

# ── News fetching ────────────────────────────────────────────────────────────

_NEWS_FEED_URL = "https://news.google.com/rss/search?q={query}&hl=en-US&gl=US&ceid=US:en"
_MAX_NEWS = 8
# Only news published within this window counts as "today's news"; the
# sentiment verdict is based on these articles only.
_NEWS_AGE_HOURS = 24


def _parse_rss_date(pub_date: str) -> Optional[datetime]:
    """Parse an RFC-2822 RSS pubDate into a timezone-aware datetime."""
    if not pub_date:
        return None
    try:
        dt = parsedate_to_datetime(pub_date)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


def _build_search_queries(symbol: str, display_name: str) -> list[str]:
    """Build search queries for Google News based on the symbol."""
    queries = []
    if symbol in _PAIR_NAMES:
        terms = _PAIR_NAMES[symbol]
        queries = [f"{terms[0]} forex", f"{terms[1]} news"]
    elif display_name in _COMMODITY_NAMES:
        terms = _COMMODITY_NAMES[display_name]
        queries = [f"{terms[0]} market news", terms[1]]
    else:
        # Generic: use the display name or symbol
        clean = display_name or symbol
        clean = re.sub(r"^(frx|cry)", "", clean)
        queries = [f"{clean} market news", f"{clean} trading"]

    return queries[:2]  # Max 2 queries


async def fetch_news(symbol: str, display_name: str = "") -> list[dict]:
    """Fetch recent financial news headlines from Google News RSS."""
    queries = _build_search_queries(symbol, display_name)
    articles = []
    seen_titles = set()

    async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
        for query in queries:
            try:
                url = _NEWS_FEED_URL.format(query=query.replace(" ", "+"))
                resp = await client.get(url)
                if resp.status_code != 200:
                    logger.warning("News RSS returned %d for query: %s", resp.status_code, query)
                    continue

                root = ElementTree.fromstring(resp.text)
                for item in root.findall(".//item")[:_MAX_NEWS]:
                    title = (item.findtext("title") or "").strip()
                    source = (item.findtext("source") or "").strip()
                    pub_date = (item.findtext("pubDate") or "").strip()
                    link = (item.findtext("link") or "").strip()
                    description = (item.findtext("description") or "").strip()

                    # Clean HTML from description
                    description = re.sub(r"<[^>]+>", "", description).strip()

                    if title and title not in seen_titles:
                        seen_titles.add(title)
                        articles.append({
                            "title": title,
                            "source": source,
                            "date": pub_date,
                            "published_at": _parse_rss_date(pub_date),
                            "summary": description[:300] if description else "",
                            "url": link,
                        })
            except Exception as e:
                logger.warning("Failed to fetch news for query '%s': %s", query, e)

    # Keep only news from the current day / last 24 hours so the sentiment
    # verdict reflects today's headlines, not stale articles.
    cutoff = datetime.now(timezone.utc) - timedelta(hours=_NEWS_AGE_HOURS)
    recent = [a for a in articles if a.get("published_at") is not None and a["published_at"] >= cutoff]
    if recent:
        articles = recent
    # Drop the internal datetime field before returning
    for a in articles:
        a.pop("published_at", None)

    return articles[:_MAX_NEWS]


# ── Analysis prompt ──────────────────────────────────────────────────────────

FUNDAMENTAL_PROMPT = """\
You are an expert fundamental analyst for forex, commodities, indices, and crypto markets.

Today's date is {today}.

Given the following news headlines and summaries for {instrument} published within the \
last 24 hours, provide a comprehensive fundamental analysis based on TODAY's news.

Today's News:
{news_text}

Analyze:
1. Overall market sentiment from today's news
2. Key economic themes affecting this instrument
3. Central bank policy implications (if applicable)
4. Geopolitical factors
5. Market-moving events
6. Overall fundamental bias (bullish, bearish, neutral)
7. A clear BUY, SELL, or WAIT recommendation with confidence level

Return ONLY valid JSON matching this schema:
{{
  "instrument": "{instrument}",
  "sentiment": "bullish | bearish | neutral",
  "sentiment_score": 0,
  "confidence": 0,
  "recommendation": "BUY | SELL | WAIT",
  "bias": "",
  "key_themes": [],
  "news_impact": [
    {{
      "headline": "",
      "impact": "bullish | bearish | neutral",
      "relevance": 0
    }}
  ],
  "economic_factors": [],
  "central_bank_outlook": "",
  "geopolitical_risk": "",
  "analysis": "",
  "reasons": [],
  "warnings": [],
  "news_count": 0
}}

Rules:
- sentiment_score: -100 (extreme bearish) to +100 (extreme bullish)
- confidence: 0 to 100
- relevance: 0 to 10
- Base the verdict ONLY on the news listed above (published within the last 24 hours)
- If there are few or no relevant news articles, say so and lower confidence
- Do NOT invent news events that weren't provided
- Be concise but thorough in analysis
"""

ANALYSIS_SCHEMA = json.dumps({
    "instrument": "",
    "sentiment": "bullish | bearish | neutral",
    "sentiment_score": 0,
    "confidence": 0,
    "recommendation": "BUY | SELL | WAIT",
    "bias": "",
    "key_themes": [],
    "news_impact": [],
    "economic_factors": [],
    "central_bank_outlook": "",
    "geopolitical_risk": "",
    "analysis": "",
    "reasons": [],
    "warnings": [],
    "news_count": 0,
}, indent=2)


# ── AI call ──────────────────────────────────────────────────────────────────

async def _call_ai(prompt: str) -> dict:
    """Call AI via OpenRouter first, fall back to Gemini."""
    global _or_ok, _gemini_ok

    if HAS_OPENROUTER and _or_ok is not False:
        try:
            result = await _call_openrouter(prompt)
            _or_ok = True
            logger.info("Fundamental: OpenRouter call succeeded")
            return result
        except Exception as e:
            logger.warning("Fundamental: OpenRouter failed (%s), trying Gemini", type(e).__name__)
            _or_ok = False

    if HAS_GEMINI and _gemini_ok is not False:
        for attempt in range(3):
            try:
                result = await _call_gemini(prompt)
                _gemini_ok = True
                logger.info("Fundamental: Gemini call succeeded (attempt %d)", attempt + 1)
                return result
            except Exception as e:
                if attempt < 2:
                    await asyncio.sleep(2 ** (attempt + 1))
                else:
                    logger.exception("Fundamental: Gemini failed after retries")
                    _gemini_ok = False

    return {
        "instrument": "",
        "sentiment": "neutral",
        "sentiment_score": 0,
        "confidence": 0,
        "recommendation": "WAIT",
        "bias": "No AI provider available",
        "key_themes": [],
        "news_impact": [],
        "economic_factors": [],
        "central_bank_outlook": "",
        "geopolitical_risk": "",
        "analysis": "No AI provider configured. Set OPENROUTER_API_KEY or AI_API_KEY.",
        "reasons": [],
        "warnings": ["No API keys configured."],
        "news_count": 0,
    }


async def _call_openrouter(prompt: str) -> dict:
    payload = {
        "model": OPENROUTER_MODEL,
        "messages": [{"role": "user", "content": prompt}],
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
    return _parse_json(raw)


async def _call_gemini(prompt: str) -> dict:
    url = f"{GEMINI_URL}/models/{GEMINI_MODEL}:generateContent?key={GEMINI_API_KEY}"
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"maxOutputTokens": 2048, "temperature": 0.2},
    }
    async with httpx.AsyncClient(timeout=90) as client:
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
    return _parse_json(raw)


def _parse_json(raw: str) -> dict:
    """Robust JSON parsing for LLM output."""
    raw = raw.strip()
    # Strip markdown fences
    cleaned = re.sub(r"^```(?:json|JSON)?\s*\n?", "", raw)
    cleaned = re.sub(r"\n?\s*```\s*$", "", cleaned)
    cleaned = cleaned.strip()
    cleaned = re.sub(r",\s*([}\]])", r"\1", cleaned)

    try:
        return json.loads(cleaned)
    except (json.JSONDecodeError, ValueError):
        pass

    # Try extracting JSON object
    start = raw.find('{')
    end = raw.rfind('}')
    if start >= 0 and end > start:
        candidate = raw[start:end + 1]
        try:
            return json.loads(candidate)
        except (json.JSONDecodeError, ValueError):
            pass

    logger.warning("Could not parse fundamental analysis JSON. First 200: %s", raw[:200])
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
        "analysis": raw[:500] if raw else "Empty response.",
        "reasons": [],
        "warnings": ["Could not parse AI response."],
        "news_count": 0,
    }


# ── Public API ───────────────────────────────────────────────────────────────

async def analyse_fundamental(
    symbol: str,
    display_name: str = "",
) -> dict:
    """Fetch news for an instrument and produce a fundamental analysis."""
    # 1. Fetch news
    articles = await fetch_news(symbol, display_name)

    if not articles:
        return {
            "instrument": display_name or symbol,
            "sentiment": "neutral",
            "sentiment_score": 0,
            "confidence": 0,
            "recommendation": "WAIT",
            "bias": "Insufficient news data",
            "key_themes": [],
            "news_impact": [],
            "economic_factors": [],
            "central_bank_outlook": "",
            "geopolitical_risk": "",
            "analysis": f"No recent news found for {display_name or symbol}. Try again later or select a more popular instrument.",
            "reasons": [],
            "warnings": ["No news articles available for this instrument."],
            "news_count": 0,
        }

    # 2. Build news text for the prompt
    news_lines = []
    for i, a in enumerate(articles, 1):
        line = f"{i}. [{a['source']}] {a['title']}"
        if a.get("date"):
            line += f" ({a['date']})"
        if a["summary"]:
            line += f"\n   Summary: {a['summary']}"
        news_lines.append(line)
    news_text = "\n\n".join(news_lines)

    # 3. Send to AI
    instrument_name = display_name or re.sub(r"^(frx|cry)", "", symbol)
    prompt = FUNDAMENTAL_PROMPT.format(
        instrument=instrument_name,
        news_text=news_text,
        schema=ANALYSIS_SCHEMA,
        today=datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
    )

    result = await _call_ai(prompt)

    # 4. Ensure required fields
    result["instrument"] = result.get("instrument") or instrument_name
    result["news_count"] = len(articles)
    if "news_impact" not in result:
        result["news_impact"] = []
    if not isinstance(result.get("news_impact"), list):
        result["news_impact"] = []
    if not isinstance(result.get("key_themes"), list):
        result["key_themes"] = []
    if not isinstance(result.get("reasons"), list):
        result["reasons"] = []
    if not isinstance(result.get("warnings"), list):
        result["warnings"] = []

    return result
