import apiClient from './api/apiClient';

const lastNewsSignalBySymbol: Record<string, string> = {};
const lastLiveSignalBySymbol: Record<string, string> = {};
const lastSentSignalBySymbol: Record<string, 'BUY' | 'SELL'> = {};

export function normalizeSignalDirection(value?: string | null): 'BUY' | 'SELL' | 'WAIT' | null {
  const raw = (value ?? '').toUpperCase().trim();
  if (!raw) return null;

  if (raw.includes('BUY') || raw === 'BULLISH' || raw === 'LONG') return 'BUY';
  if (raw.includes('SELL') || raw === 'BEARISH' || raw === 'SHORT') return 'SELL';
  if (raw.includes('WAIT') || raw === 'NEUTRAL' || raw === 'HOLD') return 'WAIT';

  return null;
}

export function updateNewsSignal(symbol: string, recommendation?: string | null) {
  const normalized = normalizeSignalDirection(recommendation);
  if (!symbol || !normalized) return;
  lastNewsSignalBySymbol[symbol] = normalized;
}

export function updateLiveSignal(symbol: string, direction?: string | null) {
  const normalized = normalizeSignalDirection(direction);
  if (!symbol || !normalized) return;
  lastLiveSignalBySymbol[symbol] = normalized;
}

export function getLatestNewsSignal(symbol: string) {
  return lastNewsSignalBySymbol[symbol] ?? null;
}

export function getLatestLiveSignal(symbol: string) {
  return lastLiveSignalBySymbol[symbol] ?? null;
}

export async function maybeSendAlignedSignalNotification({
  symbol,
  displayName,
  newsRecommendation,
  liveSignal,
}: {
  symbol?: string | null;
  displayName?: string | null;
  newsRecommendation?: string | null;
  liveSignal?: string | null;
}) {
  if (!symbol) return false;

  const resolvedNewsSide = normalizeSignalDirection(newsRecommendation ?? lastNewsSignalBySymbol[symbol]);
  const resolvedLiveSide = normalizeSignalDirection(liveSignal ?? lastLiveSignalBySymbol[symbol]);

  if (!resolvedNewsSide || !resolvedLiveSide) return false;
  if (resolvedNewsSide !== resolvedLiveSide) return false;
  if (!['BUY', 'SELL'].includes(resolvedNewsSide)) return false;

  const alignedSide: 'BUY' | 'SELL' = resolvedNewsSide as 'BUY' | 'SELL';
  const lastSent = lastSentSignalBySymbol[symbol];
  if (lastSent === alignedSide) return false;

  try {
    await apiClient.post('/notifications', {
      title: `${alignedSide} signal`,
      message: `${displayName ?? symbol} is aligned on ${alignedSide} from both the news and the live market signal.`,
      type: 'signal',
    });
    lastSentSignalBySymbol[symbol] = alignedSide;
    return true;
  } catch (error) {
    return false;
  }
}
