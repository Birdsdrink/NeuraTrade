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
    // The local FastAPI backend serves WebSockets, so never give up: retry with a
    // capped backoff when the backend restarts or the phone drops off the LAN.
    // Silently stopping after a few attempts is what leaves the price frozen.
    let retryDelay = 1000;
    const connect = () => {
      socket = new WebSocket(getTickUrl(symbol));
      socket.onopen = () => { retryDelay = 1000; setIsLive(true); };
      socket.onmessage = (event) => {
        try {
          const tick = JSON.parse(event.data as string);
          if (typeof tick.quote === 'number') setLivePrice(tick.quote);
        } catch { /* Ignore malformed provider messages. */ }
      };
      socket.onclose = () => {
        setIsLive(false);
        if (stopped) return;
        reconnectTimer = setTimeout(connect, retryDelay);
        retryDelay = Math.min(15000, retryDelay * 2);
      };
      socket.onerror = () => socket?.close();
    };
    setLivePrice(null);
    connect();
    return () => { stopped = true; if (reconnectTimer) clearTimeout(reconnectTimer); socket?.close(); };
  }, [symbol]);

  return { livePrice, isLive };
}
