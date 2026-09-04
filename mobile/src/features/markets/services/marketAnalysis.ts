import { Candle } from '../../../domain/entities/Candle';

export type MarketAnalysis = { direction: 'Bullish' | 'Bearish'; confidence: number; rsi: number; volatility: 'Low' | 'Moderate' | 'High'; support: number; resistance: number; currentPrice: number; summary: string };

function average(values: number[]) { return values.reduce((total, value) => total + value, 0) / values.length; }

function calculateRsi(closes: number[], period = 14) {
  const recent = closes.slice(-period - 1);
  const changes = recent.slice(1).map((close, index) => close - recent[index]);
  const averageGain = average(changes.map((change) => Math.max(change, 0)));
  const averageLoss = average(changes.map((change) => Math.abs(Math.min(change, 0))));
  if (averageLoss === 0) return 100;
  return 100 - (100 / (1 + (averageGain / averageLoss)));
}

export function analyseMarket(candles: Candle[]): MarketAnalysis | null {
  if (candles.length < 21) return null;
  const closes = candles.map((candle) => candle.close);
  const current = closes[closes.length - 1];
  const emaFast = average(closes.slice(-10));
  const emaSlow = average(closes.slice(-20));
  const rsi = calculateRsi(closes);
  const upwardSignals = Number(current > emaFast) + Number(emaFast > emaSlow) + Number(rsi >= 50);
  const direction = upwardSignals >= 2 ? 'Bullish' : 'Bearish';
  const movement = closes.slice(-10).map((close, index, values) => index === 0 ? 0 : Math.abs((close - values[index - 1]) / values[index - 1]));
  const averageMovement = average(movement.slice(1));
  const volatility = averageMovement > 0.004 ? 'High' : averageMovement > 0.0015 ? 'Moderate' : 'Low';
  const confidence = Math.min(92, 55 + upwardSignals * 10 + Math.round(Math.abs(rsi - 50) / 5));
  const recentCandles = candles.slice(-40);
  const support = Math.min(...recentCandles.map((candle) => candle.low));
  const resistance = Math.max(...recentCandles.map((candle) => candle.high));
  return { direction, confidence, rsi, volatility, support, resistance, currentPrice: current, summary: `${direction} bias: price is ${current >= emaFast ? 'above' : 'below'} the 10-candle average, the short trend is ${emaFast >= emaSlow ? 'above' : 'below'} the 20-candle average, and momentum is ${rsi >= 50 ? 'positive' : 'negative'} (RSI ${rsi.toFixed(1)}).` };
}
