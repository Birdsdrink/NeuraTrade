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

function getTickWsUrl(symbol: string, timeframeSeconds: number): string {
  const apiUrl =
    (process.env.EXPO_PUBLIC_API_BASE_URL as string) || 'http://localhost:8000/api';
  const base = `${apiUrl.replace(/^http/, 'ws').replace(/\/$/, '')}/ws/ticks/${encodeURIComponent(symbol)}`;
  return `${base}?timeframe_seconds=${timeframeSeconds}`;
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

  // Stabilize historical candles reference — only replace the live base when
  // historical data actually changes.  Keep the ref undefined initially so a
  // warm React Query cache is copied on the component's first render too.
  const histJson = useMemo(() => JSON.stringify(historicalCandles), [historicalCandles]);
  const histJsonRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (histJsonRef.current === histJson) return;
    histJsonRef.current = histJson;
    const base = historicalCandles
      .filter((candle) => (
        Number.isFinite(candle.timestamp)
        && Number.isFinite(candle.open)
        && Number.isFinite(candle.high)
        && Number.isFinite(candle.low)
        && Number.isFinite(candle.close)
      ))
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(-200);
    // Do not let a periodic REST refresh replace a currently forming candle
    // with an older snapshot of the same timeframe bucket.
    const liveLast = liveRef.current[liveRef.current.length - 1];
    const historyLast = base[base.length - 1];
    const liveBucket = liveLast ? candleBucket(liveLast.timestamp, timeframeSeconds) : null;
    const historyBucket = historyLast ? candleBucket(historyLast.timestamp, timeframeSeconds) : null;
    // Keep the forming candle across REST refreshes: when the live candle's
    // bucket matches the last historical bucket, replace that tail candle;
    // when it is NEWER (REST history ends at the last completed period but
    // the tick stream is already forming the next one), append it instead of
    // discarding it and rebuilding on every refresh.
    let merged;
    if (liveLast && liveBucket !== null && historyBucket !== null && liveBucket === historyBucket) {
      merged = [...base.slice(0, -1), liveLast];
    } else if (liveLast && liveBucket !== null && historyBucket !== null && liveBucket > historyBucket) {
      merged = [...base, liveLast];
    } else {
      merged = base;
    }
    liveRef.current = [...merged];
    histLenRef.current = merged.length;
    setCandles([...merged]);
  }, [histJson, timeframeSeconds]);

  // WebSocket tick stream
  useEffect(() => {
    if (!symbol || !timeframeSeconds) return;

    let stopped = false;
    let socket: WebSocket | undefined;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    // On hosts without WebSocket support (e.g. serverless backends) give up after a few
    // failed opens and rely on the parent's REST refresh — but keep reconnecting forever
    // once a connection has ever succeeded (transient drops on a real WS backend).
    let attempts = 0;
    let hasConnectedOnce = false;
    const MAX_ATTEMPTS = 3;

    const connect = () => {
      if (stopped) return;
      attempts += 1;
      const url = getTickWsUrl(symbol, timeframeSeconds);
      socket = new WebSocket(url);

      socket.onopen = () => { hasConnectedOnce = true; /* connected */ };

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
          } else if (tickBucket === lastBucket) {
            // Update the current (forming) candle
            const updatedLast: Candle = {
              ...last,
              close: price,
              high: Math.max(last.high, price),
              low: Math.min(last.low, price),
              volume: (last.volume ?? 0) + 1,
            };
            updated = [...current.slice(0, -1), updatedLast];
          } else {
            // Late ticks belong to a closed candle and must not mutate the
            // current bar.
            return;
          }

          liveRef.current = updated;
          setCandles(updated);
        } catch {
          /* ignore malformed messages */
        }
      };

      socket.onclose = () => {
        if (!stopped && (hasConnectedOnce || attempts < MAX_ATTEMPTS)) {
          reconnectTimer = setTimeout(connect, 2000);
        }
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
