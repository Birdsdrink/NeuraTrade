export interface Market {
  symbol: string;
  backendSymbol?: string;
  displayName?: string;
  market?: string;
  isOpen?: boolean;
  isFallback?: boolean;
  price?: string;
  change?: string;
  status?: 'Bullish' | 'Bearish' | string;
}
