import apiClient from '../../../services/api/apiClient';
import { Market } from '../../../domain/entities/Market';

export async function getMarkets(): Promise<Market[]> {
  const res = await apiClient.get('/markets');
  if (!Array.isArray(res.data)) {
    throw new Error('The market-data API returned an invalid response.');
  }

  return res.data
    .filter((item: unknown): item is Record<string, unknown> => (
      typeof item === 'object' && item !== null && typeof (item as Record<string, unknown>).symbol === 'string'
    ))
    .map((item) => ({
      symbol: item.symbol as string,
      displayName: typeof item.display_name === 'string' ? item.display_name : undefined,
      market: typeof item.market_display_name === 'string'
        ? item.market_display_name
        : typeof item.market === 'string' ? item.market : undefined,
      isOpen: typeof item.exchange_is_open === 'boolean' ? item.exchange_is_open : undefined,
      isFallback: item.is_fallback === true,
      status: typeof item.exchange_is_open === 'boolean'
        ? item.exchange_is_open ? (item.is_fallback === true ? 'Available' : 'Open') : 'Closed'
        : undefined,
    }));
}

export async function getHistoricalCandles(symbol: string, timeframe_seconds = 60, count = 200) {
  const res = await apiClient.get(`/markets/${encodeURIComponent(symbol)}/candles`, { params: { timeframe_seconds, count } });
  return res.data;
}
