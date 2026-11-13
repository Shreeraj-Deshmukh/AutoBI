import type { MeasureDef } from '@/types';
import { fmtCompact, fmtNumber } from '@/lib/util';

/**
 * Client theme (Sanofi: purple with black / grey) for dashboards and the Power BI export.
 * The Tailwind side lives in `.theme-client` (src/index.css); keep the two in step.
 */
export const CLIENT_THEME = {
  name: 'Sanofi',
  primary: '#7a00e6',
  /** light tint of the primary: secondary bars, inactive drill levels */
  soft: '#d9b9ff',
  ink: '#171717',
  inkSecondary: '#525252',
  muted: '#737373',
  border: '#e5e5e5',
  page: '#f5f5f5',
  /** de-selected marks when cross-filtering */
  deselected: '#d4d4d4',
};

/**
 * Categorical series colours, assigned in this order (never cycled by rank). Purple leads; the rest are
 * chosen to stay apart for colour-blind readers and to keep 3:1 contrast on white (checked with the
 * dataviz palette validator: CVD ΔE ≥ 8 between neighbours). Grey is not a series colour; it is for "other" / de-selected.
 */
export const PALETTE = ['#7a00e6', '#b07800', '#00a3a1', '#d6336c', '#2f6fd6', '#5c9e2e', '#b35cf0', '#e0702a'];
/** Light tints of the first PALETTE colours, for wireframe placeholders. */
export const PALETTE_TINTS = ['#d9b9ff', '#ecd9a6', '#a6e0df', '#f3b6cb', '#b5cdf3'];

export function fmtMeasure(v: number | null | undefined, m?: MeasureDef, compact = false) {
  if (v == null || Number.isNaN(v)) return '—';
  if (m?.format === 'percent') return `${v.toFixed(1)}%`;
  if (m?.format === 'decimal') return fmtNumber(v, 2);
  if (m?.format === 'currency') return `$${compact ? fmtCompact(v) : fmtNumber(v, 0)}`;
  return compact ? fmtCompact(v) : fmtNumber(v);
}
