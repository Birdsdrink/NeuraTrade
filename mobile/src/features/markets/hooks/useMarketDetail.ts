import { useQuery } from '@tanstack/react-query';
import { Candle } from '../../../domain/entities/Candle';
import { getHistoricalCandles } from '../services/remoteMarketApi';

export function useMarketDetail(symbol: string, timeframeSeconds: number, count = 200, refreshSeconds = 30) {
  return useQuery<Candle[]>({
    queryKey: ['market', symbol, timeframeSeconds, 'candles'],
    queryFn: async () => {
      const data = await getHistoricalCandles(symbol, timeframeSeconds, count);
      return data.map((c: any) => ({
        timestamp: Date.parse(c.timestamp) || c.timestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
      })) as Candle[];
    },
    enabled: !!symbol,
    refetchInterval: refreshSeconds * 1000,
    refetchIntervalInBackground: true,
  });
}
