import React from 'react';
import { renderHook } from '@testing-library/react-hooks';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useMarkets } from '../../src/features/markets/hooks/useMarkets';

const queryClient = new QueryClient();

test('useMarkets returns data', async () => {
  const wrapper = ({ children }: any) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  const { result, waitFor } = renderHook(() => useMarkets(), { wrapper });

  await waitFor(() => (result.current as any).isSuccess);
  expect((result.current as any).data).toBeDefined();
});
