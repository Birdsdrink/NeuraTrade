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


app = FastAPI(title="Deriv AI Market Analysis Assistant - Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
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
