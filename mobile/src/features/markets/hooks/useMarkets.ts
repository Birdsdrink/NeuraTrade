import { useQuery } from '@tanstack/react-query';
import { getMarkets } from '../services/remoteMarketApi';
import { Market } from '../../../domain/entities/Market';

export function useMarkets() {
  return useQuery<Market[]>({
    queryKey: ['markets', 'remote'],
    queryFn: getMarkets,
    refetchInterval: 60_000,
    refetchIntervalInBackground: true,
  });
}
