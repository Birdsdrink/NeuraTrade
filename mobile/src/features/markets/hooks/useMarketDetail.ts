import { useQuery } from '@tanstack/react-query';
import { Candle } from '../../../domain/entities/Candle';
import { getHistoricalCandles } from '../services/remoteMarketApi';

export function useMarketDetail(symbol: string, timeframeSeconds: number, count = 200, refreshSeconds = 30) {
  return useQuery<Candle[]>({
    queryKey: ['market', symbol, timeframeSeconds, 'candles'],
    queryFn: async () => {
      const data = await getHistoricalCandles(symbol, timeframeSeconds, count);
      if (!Array.isArray(data)) {
        throw new Error('The market-data API returned an invalid candle response.');
      }

      return data
        .map((c: any) => {
          const timestamp = typeof c?.timestamp === 'number'
            ? c.timestamp
            : Date.parse(c?.timestamp);
          return {
            timestamp,
            open: Number(c?.open),
            high: Number(c?.high),
            low: Number(c?.low),
            close: Number(c?.close),
            volume: c?.volume == null ? undefined : Number(c.volume),
          };
        })
        .filter((candle) => (
          Number.isFinite(candle.timestamp)
          && Number.isFinite(candle.open)
          && Number.isFinite(candle.high)
          && Number.isFinite(candle.low)
          && Number.isFinite(candle.close)
        ))
        .sort((a, b) => a.timestamp - b.timestamp) as Candle[];
    },
    enabled: !!symbol,
    refetchInterval: refreshSeconds * 1000,
    refetchIntervalInBackground: true,
  });
}
