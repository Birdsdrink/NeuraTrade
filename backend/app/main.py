from dotenv import load_dotenv
load_dotenv()  # must come before any module that reads os.environ

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import asyncio
import os
import logging

from .api.routes import router as api_router
from .infrastructure.deriv.deriv_market_data_provider import DerivMarketDataProvider
from .application.market_data_service import MarketDataService

logger = logging.getLogger(__name__)


def _get_allowed_origins() -> list[str]:
    configured = os.getenv("CORS_ALLOWED_ORIGINS", "")
    origins = [origin.strip() for origin in configured.split(",") if origin.strip()]
    defaults = [
        "http://localhost:8081",
        "http://127.0.0.1:8081",
        "http://0.0.0.0:8081",
        "http://192.168.43.79:8081",
        "http://192.168.43.79:8000",
        "http://10.0.2.2:8081",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "https://neuratrade-98zwnim5w-datalinks-projects.vercel.app",
        "https://backend-bice-ten-37.vercel.app",
    ]
    return list(dict.fromkeys(origins + defaults))


app = FastAPI(title="Deriv AI Market Analysis Assistant - Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=_get_allowed_origins(),
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1|0\.0\.0\.0|10\.0\.2\.2|192\.168\.\d+\.\d+|.*vercel\.app)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup_event():
    # read DERIV_WS_URL from env or fallback
    ws_url = os.getenv("DERIV_WS_URL")
    if ws_url:
        provider = DerivMarketDataProvider(ws_url)
    else:
        provider = DerivMarketDataProvider()

    app.state.market_data_provider = provider
    app.state.market_data_service = MarketDataService(provider)

    # Do not keep the HTTP server unavailable while the upstream market-data
    # provider reconnects. The client retries in the background and requests
    # can use it as soon as the connection is established.
    async def connect_provider():
        try:
            await provider.client.connect()
        except Exception:
            logger.exception("Failed to connect Deriv client in the background")

    app.state.market_data_connect_task = asyncio.create_task(connect_provider())


@app.on_event("shutdown")
async def shutdown_event():
    provider = getattr(app.state, "market_data_provider", None)
    if provider:
        await provider.client.disconnect()
    connect_task = getattr(app.state, "market_data_connect_task", None)
    if connect_task:
        connect_task.cancel()


@app.get("/health")
async def health():
    return {"status": "ok"}


# include API router
app.include_router(api_router, prefix="/api")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
