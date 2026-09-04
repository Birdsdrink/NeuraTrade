import create from 'zustand';

type MarketState = {
  selectedSymbol?: string;
  setSelectedSymbol: (s?: string) => void;
};

export const useMarketStore = create<MarketState>((set) => ({
  selectedSymbol: undefined,
  setSelectedSymbol: (s) => set({ selectedSymbol: s }),
}));
