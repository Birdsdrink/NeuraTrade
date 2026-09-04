const WATCHLIST = [
  { symbol: 'EUR/USD', backendSymbol: 'frxEURUSD', price: '1.17482', change: '+0.18%', status: 'Bullish' },
  { symbol: 'GBP/USD', backendSymbol: 'frxGBPUSD', price: '1.35120', change: '+0.12%', status: 'Bullish' },
  { symbol: 'USD/JPY', backendSymbol: 'frxUSDJPY', price: '148.20', change: '-0.24%', status: 'Bearish' },
  { symbol: 'AUD/USD', backendSymbol: 'frxAUDUSD', price: '0.6512', change: '+0.45%', status: 'Bullish' }
];

const PREVIEW = [
  { symbol: 'EUR/USD', price: '1.17482', change: '+0.18%', bullish: true },
  { symbol: 'GBP/USD', price: '1.35120', change: '+0.12%', bullish: true },
  { symbol: 'USD/JPY', price: '148.20', change: '-0.24%', bullish: false }
];

export { WATCHLIST, PREVIEW };
