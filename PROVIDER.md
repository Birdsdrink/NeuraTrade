# Provider: Binance

This implementation uses the official Binance REST and WebSocket documented APIs.

Sources:

- Exchange Information (symbols): https://api.binance.com/api/v3/exchangeInfo
- Klines (candles): https://api.binance.com/api/v3/klines
- Trades / historical trade data: https://api.binance.com/api/v3/trades
- WebSocket Streams documentation: https://binance-docs.github.io/apidocs/spot/en/#websocket-market-streams

Authentication:

- Public market data endpoints do not require API keys.
- Private/account endpoints (not used here) require API key/secret.

Rate Limits:

- Respect Binance documented rate limits. This implementation uses small `limit` values and does not perform aggressive polling.

WebSocket:

- Uses the `trade` stream for real-time ticks (e.g., `<symbol>@trade`).
- Streams are provided as JSON messages per documented schema.

Notes and decisions:

- Chose Binance because it offers public, well-documented REST and WebSocket market data APIs suitable for demo and production use.
- All provider responses are normalized into domain models under `src/domain/entities`.
- Historical persistence is implemented via SQLAlchemy async repository; default config uses SQLite, but `DATABASE_URL` can point to Postgres.
