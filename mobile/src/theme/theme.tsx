import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';

import { darkColors, lightColors, type ThemeColors } from './tokens';

export interface Theme {
  dark: boolean;
  colors: ThemeColors;
}

const ThemeContext = createContext<Theme>({ dark: false, colors: lightColors });

/** Light or dark, following the phone's setting. */
export function AppThemeProvider({ children }: { children: ReactNode }) {
  const scheme = useColorScheme();
  const value = useMemo<Theme>(() => ({ dark: scheme === 'dark', colors: scheme === 'dark' ? darkColors : lightColors }), [scheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

const DARK: Theme = { dark: true, colors: darkColors };

/** Always dark inside, whatever the phone's setting (the welcome screen). */
export function AlwaysDark({ children }: { children: ReactNode }) {
  return <ThemeContext.Provider value={DARK}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
