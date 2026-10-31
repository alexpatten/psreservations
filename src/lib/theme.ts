import { useMemo } from 'react';

/**
 * Pickle Spots' light colors (pickleparks/app/src/lib/palette.json). Like the Pickle Spots website,
 * the app is always light, whatever the system setting.
 */
const colors = {
  background: '#EEF5E4',
  tint: '#0A8754',
  onTint: '#FFFFFF',
  tintSoft: '#DDF0E4',
  card: '#FFFFFF',
  cardBorder: '#D9E4DF',
  cardPressed: '#F4F8F6',
  label: '#000000',
  secondaryLabel: '#3C3C4399',
  tertiaryLabel: '#3C3C434D',
  separator: '#3C3C434A',
  fill: '#7676801F',
  destructive: '#FF3B30',
  warning: '#C27A00',
  warningFill: '#FFF4D6',
  tealFill: '#E1F1EE',
  tealText: '#1D6B5D',
  slateFill: '#ECF0F2',
  slateText: '#4A5763',
  violetFill: '#ECEAFB',
  violetText: '#5B4FC8',
  gridLine: '#E3EBE6',
  gridHalfLine: '#EEF3F0',
  closed: '#F1F3F2',
  now: '#FF3B30',
  star: '#FFCC00',
};

export type Colors = typeof colors;

/** The screen background: soft green fading into pale pickleball yellow (Pickle Spots' gradient, without court lines). */
export const backgroundGradient = 'linear-gradient(170deg, #D7EEDF 0%, #EEF5E4 45%, #FBF5DD 100%)';

export function useColors(): Colors {
  return colors;
}

/** Styles built from the colors, once per component. */
export function useStyles<T>(factory: (c: Colors) => T): T {
  const c = useColors();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => factory(c), [c]);
}

export const type = {
  largeTitle: { fontSize: 32, fontWeight: '700' },
  title1: { fontSize: 26, fontWeight: '700' },
  title2: { fontSize: 21, fontWeight: '700' },
  title3: { fontSize: 18, fontWeight: '600' },
  headline: { fontSize: 16, fontWeight: '600' },
  body: { fontSize: 16 },
  subheadline: { fontSize: 14 },
  footnote: { fontSize: 13 },
  caption: { fontSize: 12 },
} as const;

/** Readable text (black or white) on a reservation type's color. */
export function textOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? '#10241A' : '#FFFFFF';
}
