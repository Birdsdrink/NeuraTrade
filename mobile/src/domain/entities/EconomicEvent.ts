export type EventImpactLevel = 'high' | 'medium' | 'low' | 'holiday';
export type EventDirection = 'bullish' | 'bearish' | 'neutral';
export type EventVolatility = 'high' | 'medium' | 'low';

/**
 * Where a direction came from:
 * - `forecast` — computed from the indicator's sign convention and the
 *   consensus forecast versus the previous reading (deterministic).
 * - `ai` — the model decided it, because the rule table had no numeric read
 *   (speeches, holidays, unchanged forecasts).
 * - `none` — no view available yet.
 */
export type DirectionBasis = 'forecast' | 'ai' | 'none';

export interface EconomicEvent {
  id: string;
  title: string;
  currency: string;
  /** ISO-8601 UTC timestamp of the scheduled release. */
  scheduledAt: string;
  impactLevel: EventImpactLevel;
  forecast: string;
  previous: string;
  /** True when the date comes from the recurring-release fallback, not the feed. */
  estimated: boolean;
  direction: EventDirection;
  directionBasis: DirectionBasis;
  directionConfidence: number;
  volatility: EventVolatility;
  reason: string;
  playbook: string;
  aiRated: boolean;
}

export interface EconomicEventSummary {
  eventCount: number;
  highImpactCount: number;
  nextEvent: EconomicEvent | null;
  nextHighImpact: EconomicEvent | null;
  headline: string;
}

export interface UpcomingEvents {
  symbol: string;
  instrument: string;
  currencies: string[];
  /** `live` = real calendar feed, `estimated` = recurring fallback. */
  source: string;
  generatedAt?: string | null;
  windowDays: number;
  minImpact: string;
  aiRated: boolean;
  events: EconomicEvent[];
  summary: EconomicEventSummary;
  warnings: string[];
}
