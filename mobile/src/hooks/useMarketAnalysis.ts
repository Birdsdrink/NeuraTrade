import { useQuery } from '@tanstack/react-query';
import { MarketAnalysis } from '../domain/entities/MarketAnalysis';

export function useMarketAnalysis(symbol: string) {
  return useQuery<MarketAnalysis>({
    queryKey: ['analysis', symbol],
    queryFn: async () => {
      // Return a simple mocked analysis
      return {
        trend: 'Bullish',
        trendStrength: 72,
        momentum: { state: 'Positive', strength: 58 },
        volatility: { state: 'Moderate', value: 1.2 },
        support: [],
        resistance: [],
        patterns: ['Double Bottom'],
      } as MarketAnalysis;
    },
    enabled: !!symbol,
  });
}
