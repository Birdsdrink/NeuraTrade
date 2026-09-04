import React from 'react';
import QueryProvider from './QueryProvider';
import { SettingsProvider } from '../../hooks/useSettings';

// AppProviders composes future providers: Theme, Zustand, ReactQuery, etc.
export default function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <SettingsProvider>
      <QueryProvider>{children}</QueryProvider>
    </SettingsProvider>
  );
}
