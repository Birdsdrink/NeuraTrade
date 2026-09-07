import { useEffect, useState } from 'react';

function getTickUrl(symbol: string) {
  const apiUrl = (process.env.EXPO_PUBLIC_API_BASE_URL as string) || 'http://localhost:8000/api';
  return `${apiUrl.replace(/^http/, 'ws').replace(/\/$/, '')}/ws/ticks/${encodeURIComponent(symbol)}`;
}

export function useLiveTick(symbol: string) {
  const [livePrice, setLivePrice] = useState<number | null>(null);
  const [isLive, setIsLive] = useState(false);

  useEffect(() => {
    if (!symbol) return;
    let stopped = false;
    let socket: WebSocket | undefined;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    // On hosts without WebSocket support (e.g. serverless backends) give up after a few
    // failed opens and rely on REST polling instead — but keep reconnecting forever once
    // a connection has ever succeeded (transient drops on a real WS backend).
    let attempts = 0;
    let hasConnectedOnce = false;
    const MAX_ATTEMPTS = 3;
    const connect = () => {
      attempts += 1;
      socket = new WebSocket(getTickUrl(symbol));
      socket.onopen = () => { hasConnectedOnce = true; setIsLive(true); };
      socket.onmessage = (event) => {
        try {
          const tick = JSON.parse(event.data as string);
          if (typeof tick.quote === 'number') setLivePrice(tick.quote);
        } catch { /* Ignore malformed provider messages. */ }
      };
      socket.onclose = () => {
        setIsLive(false);
        if (!stopped && (hasConnectedOnce || attempts < MAX_ATTEMPTS)) {
          reconnectTimer = setTimeout(connect, 3000);
        }
      };
      socket.onerror = () => socket?.close();
    };
    setLivePrice(null);
    connect();
    return () => { stopped = true; if (reconnectTimer) clearTimeout(reconnectTimer); socket?.close(); };
  }, [symbol]);

  return { livePrice, isLive };
}
