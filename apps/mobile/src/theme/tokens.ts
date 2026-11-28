/**
 * Centralized Design System Tokens for `percaya` (Solana Mobile Seeker).
 *
 * - Spacing: strict 4/8pt scale
 * - Typography: 24 / 17 / 15 / 13 / 11 with tabular-nums helper
 * - Colors: semantic status palette (Open=Blue, Holding=Amber, Gain=Green, Loss=Red, Refunded=Gray)
 *   verified >= 4.5:1 WCAG AA contrast on both Light and Dark surfaces.
 */
import type { TextStyle, ViewStyle } from 'react-native';

export type ThemeMode = 'light' | 'dark' | 'system';

export const SPACING = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const RADII = {
  xs: 6,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  pill: 999,
} as const;

export const TYPE = {
  display: { fontSize: 24, lineHeight: 30, fontWeight: '700', letterSpacing: -0.5 } satisfies TextStyle,
  title: { fontSize: 17, lineHeight: 22, fontWeight: '700', letterSpacing: -0.3 } satisfies TextStyle,
  body: { fontSize: 15, lineHeight: 21, fontWeight: '400' } satisfies TextStyle,
  bodySemi: { fontSize: 15, lineHeight: 21, fontWeight: '600' } satisfies TextStyle,
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '500' } satisfies TextStyle,
  captionSemi: { fontSize: 13, lineHeight: 18, fontWeight: '600' } satisfies TextStyle,
  micro: { fontSize: 11, lineHeight: 15, fontWeight: '600' } satisfies TextStyle,
  num: { fontVariant: ['tabular-nums'] } satisfies TextStyle,
} as const;

export const SHADOWS: Record<'card' | 'sheet', ViewStyle> = {
  card: {
    shadowColor: '#0F1D24',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 1,
  },
  sheet: {
    shadowColor: '#0F1D24',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 8,
  },
};

export interface ColorPalette {
  bg: string;
  surface: string;
  subtle: string;
  elevated: string;
  line: string;
  lineStrong: string;
  ink: string;
  ink2: string;
  ink3: string;
  onPrimary: string;
  // Brand & Open status (Blue)
  accent: string;
  accentDeep: string;
  accentFill: string;
  accentSoft: string;
  open: string;
  openFill: string;
  openText: string;
  // Holding / Checkpoint status (Amber — WCAG AA >= 4.8:1)
  holding: string;
  holdingFill: string;
  holdingText: string;
  // Settled Profit (Green — WCAG AA >= 4.8:1)
  gain: string;
  gainFill: string;
  gainText: string;
  // Settled Loss / Stop-Loss (Red — WCAG AA >= 4.8:1)
  loss: string;
  lossFill: string;
  lossText: string;
  // Refunded / Neutral (Gray — WCAG AA >= 4.8:1)
  refunded: string;
  refundedFill: string;
  refundedText: string;
  backdrop: string;
}

export const PALETTES: Record<'light' | 'dark', ColorPalette> = {
  light: {
    bg: '#F2F5F7',
    surface: '#FFFFFF',
    subtle: '#F6F8FA',
    elevated: '#FFFFFF',
    line: '#E2E8EC',
    lineStrong: '#C5D0D8',
    ink: '#0F1D24',
    ink2: '#33444E',
    ink3: '#51636D',
    onPrimary: '#FFFFFF',
    accent: '#1B6592',
    accentDeep: '#104465',
    accentFill: '#DCEBF5',
    accentSoft: '#EDF5FA',
    open: '#1B6592',
    openFill: '#E3F0F8',
    openText: '#104465',
    holding: '#945600',
    holdingFill: '#FEF3DC',
    holdingText: '#754300',
    gain: '#087A53',
    gainFill: '#DCF3E8',
    gainText: '#065F40',
    loss: '#C63026',
    lossFill: '#FDE8E5',
    lossText: '#9B2018',
    refunded: '#51636D',
    refundedFill: '#EDF1F4',
    refundedText: '#33444E',
    backdrop: 'rgba(15, 29, 36, 0.52)',
  },
  dark: {
    bg: '#0B1216',
    surface: '#121C22',
    subtle: '#18252D',
    elevated: '#1E2E38',
    line: '#23343F',
    lineStrong: '#344B59',
    ink: '#F1F5F8',
    ink2: '#C0CDD5',
    ink3: '#90A4B1',
    onPrimary: '#0B1216',
    accent: '#5BB4E5',
    accentDeep: '#9AD4F5',
    accentFill: '#163549',
    accentSoft: '#132A3A',
    open: '#5BB4E5',
    openFill: '#143347',
    openText: '#9AD4F5',
    holding: '#F5B041',
    holdingFill: '#3A2A10',
    holdingText: '#FAD089',
    gain: '#34D399',
    gainFill: '#0F3327',
    gainText: '#6EE7B7',
    loss: '#F87171',
    lossFill: '#3B1818',
    lossText: '#FCA5A5',
    refunded: '#94A8B5',
    refundedFill: '#1E2B33',
    refundedText: '#CBD5DC',
    backdrop: 'rgba(0, 0, 0, 0.68)',
  },
};

export const MIN_TOUCH_TARGET = 44;
