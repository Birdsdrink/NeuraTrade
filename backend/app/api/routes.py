from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from typing import List, Optional
from pydantic import BaseModel
from ..application.market_data_service import MarketDataService
from ..domain.entities.candle import Candle as DomainCandle
from fastapi import Request
import asyncio
import logging
from ..infrastructure.deriv.deriv_market_data import get_fallback_symbols
from ..infrastructure.ai.vision_service import (
    analyse_chart_image,
    analyse_candles,
    analyse_chart_image_dashboard,
    analyse_candles_dashboard,
)
from ..infrastructure.ai.fundamental_service import analyse_fundamental

router = APIRouter()
logger = logging.getLogger(__name__)

# ── In-memory notifications store ─────────────────────────────────────────────
notifications_db: list[dict] = []
_next_notif_id = 1


def _markets_for_current_session(symbols):
    """Always return every tradeable instrument.

    Users want to see all forex, commodities, indices, and crypto regardless
    of whether the underlying exchange is currently open.  Exchange-open state
    is still surfaced in each symbol's `exchange_is_open` flag so the UI can
    display it, but we no longer hide instruments wholesale.
    """
    return symbols


def _get_service(request: Request) -> MarketDataService:
    """Resolve the shared MarketDataService initialized at startup."""
    return request.app.state.market_data_service


@router.get("/markets")
async def get_markets(request: Request):
    provider = request.app.state.market_data_provider
    try:
        # A disconnected upstream socket must not make the mobile market list
        # wait until the HTTP client gives up.
        symbols = await asyncio.wait_for(provider.get_symbols(), timeout=3)
        if symbols:
            markets = _markets_for_current_session(symbols)
            request.app.state.last_markets = markets
            return [market.dict() for market in markets]
    except (asyncio.TimeoutError, Exception) as error:
        logger.warning("Market provider unavailable; using cached/fallback markets: %s", error)

    cached_markets = getattr(request.app.state, "last_markets", None)
    markets = cached_markets or get_fallback_symbols()
    return [market.dict() for market in markets]


@router.get("/markets/{symbol}/candles")
async def get_candles(symbol: str, timeframe_seconds: int = 60, count: int = 100, service: MarketDataService = Depends(_get_service)):
    candles: List[DomainCandle] = await service.get_historical(symbol, timeframe_seconds, count)
    return [c.__dict__ for c in candles]


@router.get("/market/health")
async def market_health(request: Request):
    provider = getattr(request.app.state, "market_data_provider", None)
    if not provider:
        return {"status": "no_provider"}

    # Try a lightweight request to Deriv to confirm connectivity
    try:
        # call get_symbols but limit behavior: if it returns, connection is fine
        symbols = await provider.get_symbols()
        return {"status": "ok", "connected": True, "symbols_count": len(symbols)}
    except Exception:
        return {"status": "error", "connected": False}


@router.websocket("/ws/market/{symbol}")
async def market_ws(websocket: WebSocket, symbol: str):
    await websocket.accept()

    service: MarketDataService = websocket.app.state.market_data_service

    async def send_candle(c: DomainCandle):
        try:
            await websocket.send_json({
                "timestamp": c.timestamp.isoformat(),
                "open": c.open,
                "high": c.high,
                "low": c.low,
                "close": c.close,
                "volume": c.volume,
            })
        except Exception:
            # client gone, unsubscribe will be handled by outer except
            pass

    unsub = await service.subscribe_candles(symbol, 60, send_candle)

    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        await unsub()


@router.websocket("/ws/ticks/{symbol}")
async def tick_ws(websocket: WebSocket, symbol: str):
    """Stream live quotes so clients can animate the currently forming candle."""
    await websocket.accept()
    provider = websocket.app.state.market_data_provider

    async def send_tick(tick):
        await websocket.send_json({
            "symbol": tick.symbol,
            "timestamp": tick.epoch * 1000,
            "quote": tick.quote,
        })

    try:
        unsub = await provider.subscribe_ticks(symbol, send_tick)
    except Exception:
        await websocket.close(code=1011, reason="Market data is unavailable")
        return

    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        await unsub()


# ── Chart Analysis ─────────────────────────────────────────────────────────

class ChartAnalysisRequest(BaseModel):
    image_base64: Optional[str] = None
    mime_type: str = "image/png"
    symbol: Optional[str] = None
    timeframe_seconds: int = 3600
    candle_count: int = 100
    extra_prompt: str = ""


@router.post("/chart-analysis")
async def chart_analysis(
    body: ChartAnalysisRequest,
    request: Request,
):
    """Analyse a chart image or instrument candle data with AI vision."""
    if body.image_base64:
        result = await analyse_chart_image(
            body.image_base64,
            mime_type=body.mime_type,
            extra_prompt=body.extra_prompt,
        )
    elif body.symbol:
        service: MarketDataService = request.app.state.market_data_service
        candles = await service.get_historical(
            body.symbol, body.timeframe_seconds, body.candle_count
        )
        candle_dicts = [c.__dict__ for c in candles]
        tf_map = {60: "1m", 300: "5m", 900: "15m", 1800: "30m",
                  3600: "1H", 14400: "4H", 86400: "1D"}
        tf_label = tf_map.get(body.timeframe_seconds, f"{body.timeframe_seconds}s")
        result = await analyse_candles(body.symbol, tf_label, candle_dicts)
        if candle_dicts and all(c.get("volume") == -1 for c in candle_dicts):
            result.setdefault("warnings", []).append(
                "Offline demo data (Deriv feed unreachable). Levels are illustrative."
            )
    else:
        return {"error": "Provide either image_base64 or symbol."}
    return result


@router.post("/chart-analysis/dashboard")
async def chart_analysis_dashboard(
    body: ChartAnalysisRequest,
    request: Request,
):
    """Structured "AI Pro" dashboard analysis of a chart image or instrument.

    Returns the full dashboard payload consumed by the Technicals "Upload" tab:
    confidence gauge, insights, game plan, risk management, multi-timeframe,
    SMC levels, and the detailed breakdown accordions.
    Always returns a well-formed dashboard payload (never a bare 500) so the
    mobile UI can render a graceful degraded state with the failure reason.
    """
    tf_map = {60: "1m", 300: "5m", 900: "15m", 1800: "30m",
              3600: "1H", 14400: "4H", 86400: "1D"}
    try:
        if body.image_base64:
            return await analyse_chart_image_dashboard(
                body.image_base64,
                mime_type=body.mime_type,
                extra_prompt=body.extra_prompt,
            )
        if body.symbol:
            service: MarketDataService = request.app.state.market_data_service
            candles = await service.get_historical(
                body.symbol, body.timeframe_seconds, body.candle_count
            )
            candle_dicts = [c.__dict__ for c in candles]
            tf_label = tf_map.get(body.timeframe_seconds, f"{body.timeframe_seconds}s")
            payload = await analyse_candles_dashboard(body.symbol, tf_label, candle_dicts)
            return payload
        return {"error": "Provide either image_base64 or symbol."}
    except Exception as exc:
        logger.exception("Dashboard analysis failed")
        return _DASHBOARD_FALLBACK


_DASHBOARD_FALLBACK = {
    "score": 0,
    "status": "ANALYSIS UNAVAILABLE",
    "riskLevel": "Medium",
    "confLevel": "Low",
    "insights": {"trend": "Neutral", "momentum": "Neutral", "liqBias": "Neutral", "sentiment": "Cautious"},
    "gamePlan": "No trade. Try again shortly.",
    "riskManagement": {"rrRatio": "-", "stopLoss": "-", "positionSize": "Conservative"},
    "tradePlan": {
        "action": "WAIT",
        "whenToBuy": "-",
        "whenToSell": "-",
        "whenToExit": "-",
        "stopLoss": "-",
        "rrRatio": "-",
        "positionSize": "Conservative",
    },
    "multiTimeframe": {"weekly": "Neutral", "daily": "Neutral", "h4": "Consolidating", "h1": "Range"},
    "smc": {"fvg": "-", "bullishOb": "-", "bearishOb": "-", "buySideLiq": "-", "sellSideLiq": "-"},
    "breakdown": [
        {"title": "Trend Analysis", "content": "No clear signal."},
        {"title": "Support & Resistance Levels", "content": "No clear levels."},
        {"title": "Volume Analysis", "content": "No volume read."},
        {"title": "Candlestick Patterns", "content": "No clear pattern."},
        {"title": "Momentum Indicators", "content": "No momentum read."},
    ],
}


# ── Fundamental Analysis ────────────────────────────────────────────────────

class FundamentalAnalysisRequest(BaseModel):
    symbol: str
    display_name: str = ""


@router.post("/fundamental-analysis")
async def fundamental_analysis(body: FundamentalAnalysisRequest):
    """Fetch news for an instrument and produce an AI fundamental verdict."""
    result = await analyse_fundamental(body.symbol, body.display_name)
    return result


# ── Notifications ────────────────────────────────────────────────────────────

class NotificationCreate(BaseModel):
    title: str
    message: str
    type: str = "info"  # info, signal, alert, warning


def _add_notification(title: str, message: str, notif_type: str = "info") -> dict:
    global _next_notif_id
    notif = {
        "id": _next_notif_id,
        "title": title,
        "message": message,
        "type": notif_type,
        "read": False,
        "created_at": "just now",
    }
    _next_notif_id += 1
    notifications_db.insert(0, notif)
    return notif


@router.get("/notifications")
async def get_notifications():
    return notifications_db


@router.post("/notifications")
async def create_notification(body: NotificationCreate):
    notif = _add_notification(body.title, body.message, body.type)
    return notif


@router.delete("/notifications/{notif_id}")
async def delete_notification(notif_id: int):
    global notifications_db
    notifications_db = [n for n in notifications_db if n["id"] != notif_id]
    return {"deleted": True}


@router.delete("/notifications")
async def clear_notifications():
    global notifications_db
    notifications_db.clear()
    return {"deleted": True}

