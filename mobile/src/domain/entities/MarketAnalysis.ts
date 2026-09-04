import { Candle } from './Candle';

export interface MarketAnalysis {
  trend: 'Bullish' | 'Bearish' | 'Neutral';
  trendStrength: number; // 0-100
  momentum: { state: string; strength: number };
  volatility: { state: string; value: number };
  support: Candle[];
  resistance: Candle[];
  patterns: string[];
}
