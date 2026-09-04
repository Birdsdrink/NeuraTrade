export const ROUTES = {
  MARKETS: 'Markets',
  MARKET_DETAIL: 'MarketDetail',
  AI_ANALYSIS: 'AIAnalysis',
  WATCHLIST: 'Watchlist',
  SETTINGS: 'Settings',
} as const;

export type RouteName = (typeof ROUTES)[keyof typeof ROUTES];
