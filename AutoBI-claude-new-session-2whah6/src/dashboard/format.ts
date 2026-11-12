import type { MeasureDef } from '@/types';
import { fmtCompact, fmtNumber } from '@/lib/util';

export const PALETTE = ['#2550eb', '#0ea5e9', '#14b8a6', '#f59e0b', '#8b5cf6', '#ef4444', '#64748b', '#ec4899', '#84cc16', '#0f1f42'];

export function fmtMeasure(v: number | null | undefined, m?: MeasureDef, compact = false) {
  if (v == null || Number.isNaN(v)) return '—';
  if (m?.format === 'percent') return `${v.toFixed(1)}%`;
  if (m?.format === 'decimal') return fmtNumber(v, 2);
  if (m?.format === 'currency') return `$${compact ? fmtCompact(v) : fmtNumber(v, 0)}`;
  return compact ? fmtCompact(v) : fmtNumber(v);
}
