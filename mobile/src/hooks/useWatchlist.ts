import { useState, useEffect } from 'react';
import { WATCHLIST } from '../features/markets/data/mockMarketData';
import { Market } from '../domain/entities/Market';

export function useWatchlist() {
  const [list, setList] = useState<Market[]>([]);

  useEffect(() => {
    // keep using mock data for now
    setList(WATCHLIST as Market[]);
  }, []);

  return {
    watchlist: list,
    add: (m: Market) => setList((s) => [...s, m]),
    remove: (symbol: string) => setList((s) => s.filter((i) => i.symbol !== symbol)),
  };
}
