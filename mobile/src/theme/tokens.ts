import type { ViewStyle } from 'react-native';

/**
 * Envo Phone's design tokens: the website's ink-and-white look with Enfinito blue, in light and dark.
 * Screens never use raw colours; they read them from useTheme() so dark mode just works.
 */

export const palette = {
  ink950: '#0B0D12',
  ink900: '#17191F',
  ink800: '#23262E',
  ink700: '#33363F',
  grey50: '#FAFAFA',
  grey100: '#F4F4F5',
  grey200: '#E6E6E9',
  grey300: '#D5D5DA',
  grey400: '#A0A1A9',
  grey450: '#80828C',
  grey500: '#6F717B',
  grey550: '#62646E',
  grey600: '#51535C',
  brand50: '#EFF4FF',
  brand100: '#DCE7FE',
  brand400: '#618FFA',
  brand500: '#3B6DF6',
  brand600: '#1F57EB',
  brand700: '#1745D0',
  brand800: '#193BA8',
  brand900: '#1A3684',
  brand950: '#152351',
  green300: '#4ADE80',
  green400: '#22C55E',
  green500: '#16A34A',
  green700: '#15803D',
  red300: '#FCA5A5',
  red400: '#F87171',
  red500: '#EF4444',
  red600: '#DC2626',
  red700: '#B91C1C',
  amber400: '#FBBF24',
  amber500: '#F59E0B',
  amber700: '#B45309',
  white: '#FFFFFF',
} as const;

export interface ThemeColors {
  /** Screen background. */
  background: string;
  /** Cards, grouped lists and quick-action tiles on the background. */
  surface: string;
  /** Keys, the segment track, secondary buttons. */
  element: string;
  elementPressed: string;
  /** Inside inputs, choice tiles and code boxes: white with a border, never grey. */
  field: string;
  /** Hairlines. */
  border: string;
  /** Field borders, radio rings. */
  borderStrong: string;
  /** Progress tracks, switches when off, step connectors. */
  track: string;
  text: string;
  /** Every caption, hint and time people need to read. */
  textSecondary: string;
  /** Placeholders, chevrons and decoration only (too light for anything to read). */
  textTertiary: string;
  /** Primary buttons: ink in light mode, white in dark mode. */
  primary: string;
  primaryPressed: string;
  onPrimary: string;
  /** Buttons that can't be used now (and the blocked call button). */
  disabled: string;
  onDisabled: string;
  /** Blue text, icons, focus rings and the selected tab. */
  brand: string;
  /** Blue fills with white text on them (white on the lighter dark-mode blue is too faint). */
  brandFill: string;
  brandSoft: string;
  onBrand: string;
  /** The green call and answer buttons. */
  call: string;
  callPressed: string;
  /** Green text and icons: "Free", "Ready", call circles. */
  callText: string;
  callSoft: string;
  /** Hang up, missed calls, errors. */
  danger: string;
  dangerSoft: string;
  /** Amber dots and icons only; amber text uses warningText. */
  warning: string;
  warningText: string;
  warningSoft: string;
  tabBar: string;
}

export const lightColors: ThemeColors = {
  background: palette.white,
  surface: palette.grey100,
  element: palette.grey100,
  elementPressed: palette.grey200,
  field: palette.white,
  border: 'rgba(11,13,18,0.08)',
  borderStrong: palette.grey300,
  track: palette.grey200,
  text: palette.ink950,
  textSecondary: palette.grey550,
  textTertiary: palette.grey450,
  primary: palette.ink950,
  primaryPressed: '#262A33',
  onPrimary: palette.white,
  disabled: palette.grey200,
  onDisabled: palette.grey550,
  brand: palette.brand600,
  brandFill: palette.brand600,
  brandSoft: palette.brand50,
  onBrand: palette.white,
  call: palette.green500,
  callPressed: palette.green700,
  callText: palette.green700,
  callSoft: '#E8F7EE',
  danger: palette.red600,
  dangerSoft: '#FDECEC',
  warning: palette.amber500,
  warningText: palette.amber700,
  warningSoft: '#FEF5E6',
  tabBar: palette.white,
};

export const darkColors: ThemeColors = {
  background: palette.ink950,
  surface: palette.ink900,
  element: palette.ink800,
  elementPressed: palette.ink700,
  field: palette.ink900,
  border: 'rgba(255,255,255,0.10)',
  borderStrong: 'rgba(255,255,255,0.16)',
  track: palette.ink700,
  text: palette.white,
  textSecondary: palette.grey400,
  textTertiary: '#80838D',
  primary: palette.white,
  primaryPressed: palette.grey200,
  onPrimary: palette.ink950,
  disabled: palette.ink800,
  onDisabled: '#80838D',
  brand: palette.brand400,
  brandFill: palette.brand600,
  // The soft fills are opaque, so they look the same on any background.
  brandSoft: '#171F32',
  onBrand: palette.white,
  call: palette.green500,
  callPressed: palette.green700,
  callText: palette.green300,
  callSoft: '#0E271D',
  danger: palette.red400,
  dangerSoft: '#2C1B1F',
  warning: palette.amber500,
  warningText: palette.amber400,
  warningSoft: '#2C2111',
  tabBar: palette.ink950,
};

/** The page gutter is xl (24). */
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const;

/** xl is the number card's; sheet is the top of a bottom sheet. */
export const radius = { xs: 6, sm: 10, md: 14, lg: 20, xl: 24, sheet: 28, pill: 999 } as const;

/** Icon sizes. Every lucide icon is drawn at iconStroke, or 2 at icon.sm. */
export const icon = { sm: 16, md: 20, lg: 24, xl: 28 } as const;
export const iconStroke = 1.75;

/** Hairlines do the work elsewhere: only these two get a shadow, and only in light mode. */
export const shadow = {
  /** The selected segment of a SegmentedControl. */
  raised: { shadowColor: '#0B0D12', shadowOpacity: 0.08, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  /** The number card. */
  hero: { shadowColor: '#1A3684', shadowOpacity: 0.22, shadowRadius: 20, shadowOffset: { width: 0, height: 10 }, elevation: 6 },
} as const satisfies Record<string, ViewStyle>;

/** expo-linear-gradient props: spread them onto a LinearGradient. */
export const gradients = {
  /** The number card in light mode: navy into ink. */
  night: { colors: ['#1A3684', '#0B0D12'], start: { x: 0, y: 0 }, end: { x: 0.9, y: 1 } },
  /** The number card in dark mode, a step lighter so it doesn't melt into the page. */
  nightRaised: { colors: ['#1F3E94', '#17191F'], start: { x: 0, y: 0 }, end: { x: 0.9, y: 1 } },
  welcome: { colors: ['#1A3684', '#0B0D12', '#0B0D12'], locations: [0, 0.55, 1] },
  call: { colors: ['#0F1F49', '#0B0D12', '#06070A'], locations: [0, 0.55, 1] },
} as const;

/** Geist, loaded in the root layout; Funnel Display only for the "envo" wordmark and the Welcome headline. */
export const fonts = {
  regular: 'Geist_400Regular',
  medium: 'Geist_500Medium',
  semibold: 'Geist_600SemiBold',
  bold: 'Geist_700Bold',
  display: 'FunnelDisplay_600SemiBold',
} as const;

const tabular = ['tabular-nums'] as const;

export const type = {
  display: { fontFamily: fonts.semibold, fontSize: 34, lineHeight: 40, letterSpacing: -1.2 },
  title: { fontFamily: fonts.semibold, fontSize: 28, lineHeight: 34, letterSpacing: -0.8 },
  heading: { fontFamily: fonts.semibold, fontSize: 17, lineHeight: 22, letterSpacing: -0.2 },
  body: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 24 },
  bodyMedium: { fontFamily: fonts.medium, fontSize: 16, lineHeight: 24 },
  label: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 20 },
  caption: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  small: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 16 },
  // Numbers: figures of equal width, so they don't jump as they change.
  amount: { fontFamily: fonts.semibold, fontSize: 34, lineHeight: 40, letterSpacing: -1, fontVariant: tabular },
  phone: { fontFamily: fonts.semibold, fontSize: 28, lineHeight: 34, letterSpacing: 0.3, fontVariant: tabular },
  phoneLg: { fontFamily: fonts.medium, fontSize: 36, lineHeight: 44, letterSpacing: 0.5, fontVariant: tabular },
  figure: { fontFamily: fonts.semibold, fontSize: 17, lineHeight: 22, fontVariant: tabular },
} as const;

export type TypeVariant = keyof typeof type;
