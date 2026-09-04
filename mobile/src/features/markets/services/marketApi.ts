import { PREVIEW } from '../data/mockMarketData';
import { Market } from '../../../domain/entities/Market';

export async function getPreviewMarkets(): Promise<Market[]> {
  // simulate async
  return new Promise((res) => setTimeout(() => res(PREVIEW as Market[]), 50));
}
