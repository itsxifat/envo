/**
 * Envo Phone's design tokens: the website's ink-and-white look with Enfinito blue, in light and dark.
 * Screens never use raw colours; they read them from useTheme() so dark mode just works.
 */

export const palette = {
  ink950: '#0B0D12',
  ink900: '#15171D',
  ink800: '#23262E',
  ink700: '#33363F',
  grey50: '#FAFAFA',
  grey100: '#F4F4F5',
  grey200: '#E6E6E9',
  grey300: '#D5D5DA',
  grey400: '#A0A1A9',
  grey500: '#6F717B',
  grey600: '#51535C',
  brand50: '#EFF4FF',
  brand100: '#DCE7FE',
  brand400: '#618FFA',
  brand500: '#3B6DF6',
  brand600: '#1F57EB',
  brand700: '#1745D0',
  green500: '#16A34A',
  green400: '#22C55E',
  red500: '#EF4444',
  red400: '#F87171',
  amber500: '#F59E0B',
  white: '#FFFFFF',
} as const;

export interface ThemeColors {
  /** Screen background. */
  background: string;
  /** Cards and grouped lists on the background. */
  surface: string;
  /** Inputs, keys, chips: one step up from the surface. */
  element: string;
  elementPressed: string;
  border: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  /** Primary buttons: ink in light mode, white in dark mode. */
  primary: string;
  onPrimary: string;
  brand: string;
  brandSoft: string;
  onBrand: string;
  /** The green call button and "free call" marks. */
  call: string;
  callSoft: string;
  /** Hang up, missed calls, errors. */
  danger: string;
  dangerSoft: string;
  warning: string;
  warningSoft: string;
  tabBar: string;
}

export const lightColors: ThemeColors = {
  background: palette.white,
  surface: palette.grey100,
  element: palette.grey100,
  elementPressed: palette.grey200,
  border: 'rgba(11,13,18,0.08)',
  text: palette.ink950,
  textSecondary: palette.grey500,
  textTertiary: palette.grey400,
  primary: palette.ink950,
  onPrimary: palette.white,
  brand: palette.brand600,
  brandSoft: palette.brand50,
  onBrand: palette.white,
  call: palette.green500,
  callSoft: '#E8F7EE',
  danger: palette.red500,
  dangerSoft: '#FDECEC',
  warning: palette.amber500,
  warningSoft: '#FEF5E6',
  tabBar: 'rgba(255,255,255,0.96)',
};

export const darkColors: ThemeColors = {
  background: palette.ink950,
  surface: palette.ink900,
  element: palette.ink800,
  elementPressed: palette.ink700,
  border: 'rgba(255,255,255,0.08)',
  text: palette.white,
  textSecondary: palette.grey400,
  textTertiary: palette.grey500,
  primary: palette.white,
  onPrimary: palette.ink950,
  brand: palette.brand400,
  brandSoft: 'rgba(97,143,250,0.14)',
  onBrand: palette.white,
  call: palette.green400,
  callSoft: 'rgba(34,197,94,0.14)',
  danger: palette.red400,
  dangerSoft: 'rgba(248,113,113,0.14)',
  warning: palette.amber500,
  warningSoft: 'rgba(245,158,11,0.14)',
  tabBar: 'rgba(11,13,18,0.96)',
};

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const;

export const radius = { sm: 10, md: 14, lg: 20, xl: 28, pill: 999 } as const;

/** Geist, loaded in the root layout. */
export const fonts = {
  regular: 'Geist_400Regular',
  medium: 'Geist_500Medium',
  semibold: 'Geist_600SemiBold',
  bold: 'Geist_700Bold',
} as const;

export const type = {
  display: { fontFamily: fonts.bold, fontSize: 34, lineHeight: 40, letterSpacing: -1 },
  title: { fontFamily: fonts.bold, fontSize: 26, lineHeight: 32, letterSpacing: -0.6 },
  heading: { fontFamily: fonts.semibold, fontSize: 18, lineHeight: 24, letterSpacing: -0.3 },
  body: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 23 },
  bodyMedium: { fontFamily: fonts.medium, fontSize: 16, lineHeight: 23 },
  label: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 19 },
  caption: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  small: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 16 },
} as const;

export type TypeVariant = keyof typeof type;
