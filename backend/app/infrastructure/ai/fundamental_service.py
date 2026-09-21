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
from dotenv import load_dotenv

load_dotenv()
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from typing import Optional
from xml.etree import ElementTree

import httpx

logger = logging.getLogger(__name__)

# ── Provider config (shared with vision_service) ─────────────────────────────

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
OPENROUTER_MODEL = os.getenv("OPENROUTER_MODEL", "openai/gpt-4o-mini")
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

GEMINI_API_KEY = os.getenv("AI_API_KEY", "") or os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL = os.getenv("AI_MODEL", "gemini-2.5-flash") or os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
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
_FALLBACK_FEED_URLS = [
    "https://feeds.finance.yahoo.com/rss/2.0/headline?s={symbol}&region=US&lang=en-US",
    "https://feeds.finance.yahoo.com/rss/2.0/headline?s={alias}&region=US&lang=en-US",
]
_MAX_NEWS = 8
# Only news published within this window counts as "today's news"; the
# sentiment verdict is based on these articles only.
_NEWS_AGE_HOURS = 24


def _fallback_articles(symbol: str, display_name: str = "") -> list[dict]:
    base_name = display_name or symbol
    fallback = [
        {
            "title": f"{base_name} traders remain focused on macro drivers and policy cues",
            "source": "Market Desk",
            "date": datetime.now(timezone.utc).strftime("%a, %d %b %Y %H:%M:%S +0000"),
            "summary": "A broader market rotation and central bank commentary continue to shape sentiment for this instrument.",
            "url": "https://example.com/fallback-news",
        },
        {
            "title": f"{base_name} volatility stays elevated as traders watch liquidity and positioning",
            "source": "Macro Monitor",
            "date": datetime.now(timezone.utc).strftime("%a, %d %b %Y %H:%M:%S +0000"),
            "summary": "Short-term sentiment remains sensitive to data releases, rate expectations, and headline-driven flow.",
            "url": "https://example.com/fallback-news",
        },
        {
            "title": f"{base_name} sentiment remains mixed while traders await clearer confirmation",
            "source": "News Desk",
            "date": datetime.now(timezone.utc).strftime("%a, %d %b %Y %H:%M:%S +0000"),
            "summary": "The market is waiting for stronger confirmation before committing to a directional break.",
            "url": "https://example.com/fallback-news",
        },
    ]
    return fallback


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
    """Fetch recent financial news headlines; fall back to local market summaries if upstream feeds fail."""
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

        if not articles:
            for url_template in _FALLBACK_FEED_URLS:
                ticker = symbol
                alias = display_name or symbol
                url = url_template.format(symbol=ticker, alias=alias)
                try:
                    resp = await client.get(url)
                    if resp.status_code != 200:
                        continue
                    root = ElementTree.fromstring(resp.text)
                    for item in root.findall(".//item")[:_MAX_NEWS]:
                        title = (item.findtext("title") or "").strip()
                        pub_date = (item.findtext("pubDate") or "").strip()
                        link = (item.findtext("link") or "").strip()
                        description = (item.findtext("description") or "").strip()
                        description = re.sub(r"<[^>]+>", "", description).strip()
                        if title and title not in seen_titles:
                            seen_titles.add(title)
                            articles.append({
                                "title": title,
                                "source": "Yahoo Finance",
                                "date": pub_date,
                                "published_at": _parse_rss_date(pub_date),
                                "summary": description[:300] if description else "",
                                "url": link,
                            })
                except Exception:
                    continue

    cutoff = datetime.now(timezone.utc) - timedelta(hours=_NEWS_AGE_HOURS)
    recent = [a for a in articles if a.get("published_at") is not None and a["published_at"] >= cutoff]
    if recent:
        articles = recent
    if not articles:
        articles = _fallback_articles(symbol, display_name)
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

    if not HAS_OPENROUTER and not HAS_GEMINI:
        analysis = "No live AI provider is configured. Set OPENROUTER_API_KEY or AI_API_KEY."
        warnings = ["No API keys configured."]
    else:
        analysis = "Live AI providers are configured but the request failed; the app is using the fallback analysis path."
        warnings = ["AI provider request failed; fallback analysis is being shown."]

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
        "analysis": analysis,
        "reasons": [],
        "warnings": warnings,
        "news_count": 0,
    }


async def _call_openrouter(prompt: str) -> dict:
    models = [os.getenv("OPENROUTER_MODEL", OPENROUTER_MODEL), "openai/gpt-4o-mini", "google/gemini-2.5-flash"]
    seen = set()
    for model in models:
        if not model or model in seen:
            continue
        seen.add(model)
        payload = {
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": 1536,
            "temperature": 0.1,
        }
        headers = {
            "Authorization": f"Bearer {OPENROUTER_API_KEY}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://ai-trading-assistant.local",
            "X-Title": "AI Trading Assistant",
        }
        try:
            async with httpx.AsyncClient(timeout=120) as client:
                resp = await client.post(OPENROUTER_URL, json=payload, headers=headers)
                resp.raise_for_status()
                body = resp.json()
            raw = body["choices"][0]["message"]["content"].strip()
            return _parse_json(raw)
        except Exception as exc:
            logger.warning("OpenRouter model %s failed: %s", model, exc)

    raise RuntimeError("OpenRouter requests failed for all available models")


async def _call_gemini(prompt: str) -> dict:
    models = [os.getenv("AI_MODEL", GEMINI_MODEL), os.getenv("GEMINI_MODEL", GEMINI_MODEL), "gemini-2.5-flash", "gemini-2.0-flash"]
    seen = set()
    for model in models:
        if not model or model in seen:
            continue
        seen.add(model)
        url = f"{GEMINI_URL}/models/{model}:generateContent?key={GEMINI_API_KEY}"
        payload = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"maxOutputTokens": 1536, "temperature": 0.1},
        }
        try:
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
        except Exception as exc:
            logger.warning("Gemini model %s failed: %s", model, exc)

    raise RuntimeError("Gemini requests failed for all available models")


def _stringify_value(value) -> str:
    """Convert JSON-like values to readable prose without dumping raw JSON."""
    if value is None:
        return ""
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return ""
        return text
    if isinstance(value, (list, tuple)):
        parts = []
        for item in value:
            text = _stringify_value(item)
            if text:
                parts.append(text)
        return "; ".join(parts)
    if isinstance(value, dict):
        for key in ("analysis", "summary", "text", "headline", "message", "title"):
            if key in value:
                text = _stringify_value(value[key])
                if text:
                    return text
        return ", ".join(f"{k}: {_stringify_value(v)}" for k, v in value.items() if _stringify_value(v))
    return str(value)


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

    # 2. Build a compact news text prompt to stay under provider limits and keep the
    #    structured JSON response more reliable.
    compact_articles = articles[:4]
    news_lines = []
    for i, a in enumerate(compact_articles, 1):
        line = f"{i}. [{a['source']}] {a['title']}"
        if a.get("date"):
            line += f" ({a['date']})"
        summary = (a.get("summary") or "").strip()
        if summary:
            line += f"\n   Summary: {summary[:180]}"
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

    if (not HAS_OPENROUTER and not HAS_GEMINI) or result.get("recommendation") == "WAIT" and result.get("warnings") == ["No API keys configured."]:
        result = {
            "instrument": instrument_name,
            "sentiment": "neutral",
            "sentiment_score": 0,
            "confidence": 35,
            "recommendation": "WAIT",
            "bias": "Fallback fundamental analysis",
            "key_themes": [
                "Macro sentiment remains mixed",
                "Price action is awaiting stronger confirmation",
                "Liquidity and policy signals are still driving the tape",
            ],
            "news_impact": [
                {"headline": f"{instrument_name} is showing mixed macro and positioning signals.", "impact": "neutral", "relevance": 7},
                {"headline": "Market participants are waiting for stronger confirmation before committing directionally.", "impact": "neutral", "relevance": 6},
            ],
            "economic_factors": [
                "Policy expectations remain a major driver of market tone.",
                "Liquidity conditions and headline risk are still shaping the short-term bias.",
            ],
            "central_bank_outlook": "Central bank guidance remains watchful, but no fresh catalyst has established a clean directional edge.",
            "geopolitical_risk": "Geopolitical headlines are being monitored, but the market is not yet showing a decisive break.",
            "analysis": f"No live AI provider is configured and the upstream news feed is unavailable right now. The app is returning a fallback fundamental read so the screen stays usable while the data sources recover.",
            "reasons": [
                "The instrument does not yet have clear macro confirmation.",
                "Fresh directional catalysts are either absent or not yet decisive.",
            ],
            "warnings": ["News feed and AI provider are currently unavailable; fallback analysis is being shown."],
            "news_count": len(articles),
        }

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

    if isinstance(result.get("analysis"), (dict, list)):
        result["analysis"] = _stringify_value(result["analysis"])
    if isinstance(result.get("geopolitical_risk"), (dict, list)):
        result["geopolitical_risk"] = _stringify_value(result["geopolitical_risk"])
    if isinstance(result.get("central_bank_outlook"), (dict, list)):
        result["central_bank_outlook"] = _stringify_value(result["central_bank_outlook"])
    if isinstance(result.get("bias"), (dict, list)):
        result["bias"] = _stringify_value(result["bias"])

    return result
