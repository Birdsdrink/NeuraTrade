import { getPreviewMarkets } from '../../src/features/markets/services/marketApi';

test('getPreviewMarkets returns preview data', async () => {
  const data = await getPreviewMarkets();
  expect(Array.isArray(data)).toBe(true);
  expect(data.length).toBeGreaterThan(0);
});
