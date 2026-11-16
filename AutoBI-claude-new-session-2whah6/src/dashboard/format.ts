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
 * Report look shared by the web dashboard and the Power BI export, so both show the same thing: font sizes in
 * points as Power BI takes them (the web uses `pt()` pixels), and the colours of the report furniture.
 */
export const REPORT = {
  pageTitle: 18,
  pageDescription: 10,
  section: 11,
  /** visual titles and subtitles */
  title: 11,
  titleColor: '#4f0096',
  subtitle: 9,
  /** values of the multi-value cards (Cases, Highest / Lowest) and the one-row matrix */
  value: 16,
  /** value of a single KPI card */
  kpiValue: 20,
  /** labels under card values, matrix column headers, axis labels, legend */
  label: 9,
  /** table text and header */
  table: 9,
  tableHeaderBack: '#6400bd',
  tableHeaderText: '#ffffff',
  /** slicer headers */
  slicerHeader: 10,
  slicerHeaderColor: '#6400bd',
  /** band behind the slicer rows */
  filterBand: '#f6efff',
  /** accent bar at the left of the multi-value cards */
  cardBar: '#7a00e6',
  /** corner radius of every visual box */
  radius: 10,
};
/** Report banner (brand-900 → brand-700 → brand-500), the white chip the logo sits on, and the page tab colours. */
export const BANNER = { height: 60, from: '#3b0070', via: '#6400bd', to: '#8a1ff0', tab: '#e3d1ff', tabActive: '#ffffff', chip: { x: 16, y: 10, width: 150, height: 40 } };

/** Points (Power BI font sizes) to CSS pixels. */
export const pt = (points: number) => `${Math.round(points * (4 / 3) * 10) / 10}px`;

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
