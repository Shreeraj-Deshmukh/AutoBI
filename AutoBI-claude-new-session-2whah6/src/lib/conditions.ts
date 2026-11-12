import type { Cell, MeasureCondition, MeasureDef } from '@/types';

/** All conditions of a measure (the primary one plus any additional AND conditions). */
export const conditionsOf = (m: MeasureDef): MeasureCondition[] => [...(m.condition ? [m.condition] : []), ...(m.conditions ?? [])];

/** Evaluate one condition against a cell value. */
export function test(c: MeasureCondition, v: Cell | undefined): boolean {
  if (c.op === 'notnull') return v != null && v !== '';
  if (c.op === 'eq' || c.op === 'neq') {
    const has = c.values.map(String).includes(String(v ?? ''));
    return c.op === 'eq' ? has : !has;
  }
  const n = typeof v === 'number' ? v : Number(v);
  const t = Number(c.values[0]);
  if (v == null || v === '' || Number.isNaN(n) || Number.isNaN(t)) return false;
  return c.op === 'gt' ? n > t : c.op === 'gte' ? n >= t : c.op === 'lt' ? n < t : n <= t;
}

const OPS: Record<MeasureCondition['op'], string> = { eq: '=', neq: '≠', gt: '>', gte: '≥', lt: '<', lte: '≤', notnull: 'IS NOT BLANK' };
export const describe = (c: MeasureCondition) => (c.op === 'notnull' ? `${c.field} IS NOT BLANK` : `${c.field} ${OPS[c.op]} ${c.op === 'eq' || c.op === 'neq' ? c.values.map((v) => `'${v}'`).join(' OR ') : c.values[0]}`);
