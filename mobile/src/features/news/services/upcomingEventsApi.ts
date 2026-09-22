import { aiClient } from '../../../services/api/apiClient';
import {
  DirectionBasis,
  EconomicEvent,
  EventDirection,
  EventImpactLevel,
  EventVolatility,
  UpcomingEvents,
} from '../../../domain/entities/EconomicEvent';

const IMPACT_LEVELS: EventImpactLevel[] = ['high', 'medium', 'low', 'holiday'];
const DIRECTIONS: EventDirection[] = ['bullish', 'bearish', 'neutral'];
const VOLATILITIES: EventVolatility[] = ['high', 'medium', 'low'];
const BASES: DirectionBasis[] = ['forecast', 'ai', 'none'];

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function pick<T extends string>(value: unknown, allowed: T[], fallback: T): T {
  const candidate = str(value).toLowerCase() as T;
  return allowed.includes(candidate) ? candidate : fallback;
}

function normaliseEvent(raw: unknown): EconomicEvent | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const item = raw as Record<string, unknown>;
  const id = str(item.id);
  const title = str(item.title);
  if (!id || !title) return null;

  return {
    id,
    title,
    currency: str(item.currency).toUpperCase(),
    scheduledAt: str(item.scheduled_at),
    impactLevel: pick(item.impact_level, IMPACT_LEVELS, 'low'),
    forecast: str(item.forecast),
    previous: str(item.previous),
    estimated: item.estimated === true,
    direction: pick(item.direction, DIRECTIONS, 'neutral'),
    directionBasis: pick(item.direction_basis, BASES, 'none'),
    directionConfidence: Math.max(0, Math.min(100, num(item.direction_confidence))),
    volatility: pick(item.volatility, VOLATILITIES, 'low'),
    reason: str(item.reason),
    playbook: str(item.playbook),
    aiRated: item.ai_rated === true,
  };
}

export interface UpcomingEventsParams {
  symbol?: string | null;
  displayName?: string;
  days?: number;
  minImpact?: string;
}

export async function getUpcomingEvents({
  symbol,
  displayName,
  days = 7,
  minImpact,
}: UpcomingEventsParams): Promise<UpcomingEvents> {
  const params: Record<string, string | number> = { days };
  if (symbol) params.symbol = symbol;
  if (displayName) params.display_name = displayName;
  if (minImpact) params.min_impact = minImpact;

  // The backend assesses impact with an AI model, which can take a while when a
  // provider is slow, so this call uses the long-timeout client.
  const res = await aiClient.get('/upcoming-events', { params });
  const payload = res.data;

  if (typeof payload !== 'object' || payload === null || !Array.isArray(payload.events)) {
    throw new Error('The economic-calendar API returned an invalid response.');
  }

  const events: EconomicEvent[] = (payload.events as unknown[])
    .map((item) => normaliseEvent(item))
    .filter((item): item is EconomicEvent => item !== null);

  const summary = (payload.summary ?? {}) as Record<string, unknown>;

  return {
    symbol: str(payload.symbol),
    instrument: str(payload.instrument),
    currencies: Array.isArray(payload.currencies)
      ? payload.currencies.filter((c: unknown): c is string => typeof c === 'string')
      : [],
    source: str(payload.source) || 'unavailable',
    generatedAt: typeof payload.generated_at === 'string' ? payload.generated_at : null,
    windowDays: num(payload.window_days) || days,
    minImpact: str(payload.min_impact) || 'medium',
    aiRated: payload.ai_rated === true,
    events,
    summary: {
      eventCount: num(summary.event_count) || events.length,
      highImpactCount: num(summary.high_impact_count) || events.filter((e) => e.impactLevel === 'high').length,
      nextEvent: normaliseEvent(summary.next_event),
      nextHighImpact: normaliseEvent(summary.next_high_impact),
      headline: str(summary.headline),
    },
    warnings: Array.isArray(payload.warnings)
      ? payload.warnings.filter((w: unknown): w is string => typeof w === 'string')
      : [],
  };
}
