# AI Trading Assistant

The application is separated into two independent projects:

- `backend/` — FastAPI service, Deriv market-data provider, and API routes.
- `mobile/` — Expo/React Native app for markets, candlestick charts, and AI analysis.

## Run the FastAPI backend

```powershell
cd backend
..\.venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

The API is available at `http://localhost:8000`, with markets at `/api/markets`.

## Run the Expo mobile app

```powershell
cd mobile
npm start
```

For a physical phone, set `EXPO_PUBLIC_API_BASE_URL` in `mobile/.env` to the computer's LAN address, for example `http://192.168.43.79:8000/api`.

The backend and mobile app can now be started, updated, and deployed independently.
