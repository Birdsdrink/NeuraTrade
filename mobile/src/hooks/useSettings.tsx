import { useState, useCallback, createContext, useContext, ReactNode } from 'react';

export type Settings = {
  defaultTimeframe: string;
  defaultCandleCount: number;
  refreshInterval: number;
  autoAnalysis: boolean;
};

const DEFAULTS: Settings = {
  defaultTimeframe: '1H',
  defaultCandleCount: 100,
  refreshInterval: 30,
  autoAnalysis: true,
};

type SettingsContextType = {
  settings: Settings;
  update: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
};

const SettingsContext = createContext<SettingsContextType>({
  settings: DEFAULTS,
  update: () => {},
});

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);

  const update = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }, []);

  return (
    <SettingsContext.Provider value={{ settings, update }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  return useContext(SettingsContext);
}
