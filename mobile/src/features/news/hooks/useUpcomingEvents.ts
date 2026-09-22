import { useQuery } from '@tanstack/react-query';
import { UpcomingEvents } from '../../../domain/entities/EconomicEvent';
import { getUpcomingEvents } from '../services/upcomingEventsApi';

/**
 * Scheduled economic releases and their expected price impact.
 *
 * Keyed by instrument so switching instruments refetches, and kept fresh for
 * five minutes because the upstream calendar only changes a few times a day and
 * the AI impact assessment is the expensive part of the request.
 */
export function useUpcomingEvents(symbol?: string | null, displayName?: string, days = 7) {
  return useQuery<UpcomingEvents>({
    queryKey: ['upcoming-events', symbol ?? 'ALL', days],
    queryFn: () => getUpcomingEvents({ symbol, displayName, days }),
    staleTime: 5 * 60_000,
    retry: 1,
  });
}
