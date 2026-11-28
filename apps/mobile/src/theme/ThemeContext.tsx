import React, { createContext, useContext, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import { PALETTES, type ColorPalette, type ThemeMode } from './tokens';

interface ThemeContextValue {
  mode: ThemeMode;
  setMode: (next: ThemeMode) => void;
  isDark: boolean;
  colors: ColorPalette;
}

const ThemeContext = createContext<ThemeContextValue>({
  mode: 'light',
  setMode: () => {},
  isDark: false,
  colors: PALETTES.light,
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  // Default to calm daylight Light Mode per brand direction; user can switch Light / Dark / System in Profile.
  const [mode, setMode] = useState<ThemeMode>('light');

  const isDark = mode === 'dark' || (mode === 'system' && systemScheme === 'dark');
  const value = useMemo<ThemeContextValue>(
    () => ({
      mode,
      setMode,
      isDark,
      colors: isDark ? PALETTES.dark : PALETTES.light,
    }),
    [mode, isDark],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
