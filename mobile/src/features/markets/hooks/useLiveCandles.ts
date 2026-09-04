import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Candle } from '../../../domain/entities/Candle';

/**
 * Hook that combines historical candles with a live tick WebSocket stream
 * to produce real-time candle data — just like MetaTrader.
 *
 * Behaviour:
 *  - The latest candle is continuously updated with each tick (close / high / low).
 *  - When the current candle's timestamp crosses a new timeframe boundary a fresh
 *    candle is created, exactly as a broker would emit a new bar.
 *  - Historical candles are preserved unchanged; only the tail is live.
 */

function getTickWsUrl(symbol: string): string {
  const apiUrl =
    (process.env.EXPO_PUBLIC_API_BASE_URL as string) || 'http://localhost:8000/api';
  return `${apiUrl.replace(/^http/, 'ws').replace(/\/$/, '')}/ws/ticks/${encodeURIComponent(symbol)}`;
}

/**
 * Return the floor timestamp (in ms) of the candle bucket for `ts`
 * given a timeframe in seconds.
 */
function candleBucket(ts: number, timeframeSeconds: number): number {
  const bucketMs = timeframeSeconds * 1000;
  return Math.floor(ts / bucketMs) * bucketMs;
}

export function useLiveCandles(
  symbol: string,
  timeframeSeconds: number,
  historicalCandles: Candle[],
) {
  const [candles, setCandles] = useState<Candle[]>([]);
  const liveRef = useRef<Candle[]>([]);
  const histLenRef = useRef(0);

  // Stabilize historical candles reference — only reset when data actually changes
  const histJson = useMemo(() => JSON.stringify(historicalCandles), [historicalCandles]);
  const histJsonRef = useRef(histJson);

  useEffect(() => {
    if (histJsonRef.current === histJson) return;
    histJsonRef.current = histJson;
    const base = historicalCandles.slice(-200);
    liveRef.current = [...base];
    histLenRef.current = base.length;
    setCandles([...base]);
  }, [histJson]);

  // WebSocket tick stream
  useEffect(() => {
    if (!symbol || !timeframeSeconds) return;

    let stopped = false;
    let socket: WebSocket | undefined;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      if (stopped) return;
      const url = getTickWsUrl(symbol);
      socket = new WebSocket(url);

      socket.onopen = () => { /* connected */ };

      socket.onmessage = (event) => {
        try {
          const tick = JSON.parse(event.data as string);
          const price: number | undefined = tick.quote ?? tick.price;
          const tickTime: number = tick.timestamp ?? (typeof tick.epoch === 'number' ? tick.epoch * 1000 : Date.now());
          if (typeof price !== 'number' || price <= 0) return;

          const current = liveRef.current;
          if (current.length === 0) return;

          const last = current[current.length - 1];
          const tickBucket = candleBucket(tickTime, timeframeSeconds);
          const lastBucket = candleBucket(last.timestamp, timeframeSeconds);

          let updated: Candle[];

          if (tickBucket > lastBucket) {
            // New candle boundary — start a fresh candle
            const newCandle: Candle = {
              timestamp: tickBucket,
              open: price,
              high: price,
              low: price,
              close: price,
              volume: 0,
            };
            updated = [...current, newCandle];
            // Keep max 200 candles
            if (updated.length > 200) updated = updated.slice(-200);
          } else {
            // Update the current (forming) candle
            const updatedLast: Candle = {
              ...last,
              close: price,
              high: Math.max(last.high, price),
              low: Math.min(last.low, price),
              volume: (last.volume ?? 0) + 1,
            };
            updated = [...current.slice(0, -1), updatedLast];
          }

          liveRef.current = updated;
          setCandles(updated);
        } catch {
          /* ignore malformed messages */
        }
      };

      socket.onclose = () => {
        if (!stopped) reconnectTimer = setTimeout(connect, 2000);
      };

      socket.onerror = () => socket?.close();
    };

    connect();

    return () => {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [symbol, timeframeSeconds]);

  return { candles };
}
