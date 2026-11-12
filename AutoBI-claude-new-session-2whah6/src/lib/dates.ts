import type { PeriodPreset, TimeGrain } from '@/types';

const DAY = 86_400_000;

export type DateFormat = 'ISO' | 'ISO datetime' | 'MM/DD/YYYY' | 'DD/MM/YYYY' | 'DD-MM-YYYY' | 'YYYY/MM/DD' | 'Mon DD, YYYY';

const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

/** Parse a date-like value into a UTC epoch (ms) at midnight; returns null when not a date. */
export function parseDate(v: unknown): { t: number; format: DateFormat } | null {
  if (v == null || v === '') return null;
  if (typeof v !== 'string') return null;
  const s = v.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return mk(+m[1], +m[2] - 1, +m[3], 'ISO');
  m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(s);
  if (m) return mk(+m[1], +m[2] - 1, +m[3], 'ISO datetime');
  m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(s);
  if (m) return mk(+m[1], +m[2] - 1, +m[3], 'YYYY/MM/DD');
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) {
    const a = +m[1];
    const b = +m[2];
    if (a > 12) return mk(+m[3], b - 1, a, 'DD/MM/YYYY');
    return mk(+m[3], a - 1, b, 'MM/DD/YYYY');
  }
  m = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(s);
  if (m) return mk(+m[3], +m[2] - 1, +m[1], 'DD-MM-YYYY');
  m = /^([A-Za-z]{3})[a-z]* (\d{1,2}),? (\d{4})$/.exec(s);
  if (m && MONTHS[m[1].toLowerCase()] != null) return mk(+m[3], MONTHS[m[1].toLowerCase()], +m[2], 'Mon DD, YYYY');
  return null;
}

function mk(y: number, mo: number, d: number, format: DateFormat) {
  if (mo < 0 || mo > 11 || d < 1 || d > 31 || y < 1900 || y > 2100) return null;
  const t = Date.UTC(y, mo, d);
  if (new Date(t).getUTCDate() !== d) return null;
  return { t, format };
}

export const toIsoDate = (t: number) => new Date(t).toISOString().slice(0, 10);

export function bucketOf(t: number, grain: TimeGrain): string {
  const d = new Date(t);
  const y = d.getUTCFullYear();
  if (grain === 'month') return `${y}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  if (grain === 'quarter') return `${y}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
  // week starting Monday
  const dow = (d.getUTCDay() + 6) % 7;
  return toIsoDate(t - dow * DAY);
}

export function bucketLabel(b: string, grain: TimeGrain) {
  if (grain === 'quarter') return b.replace('-', ' ');
  if (grain === 'month') {
    const [y, m] = b.split('-');
    return new Date(Date.UTC(+y, +m - 1, 1)).toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' });
  }
  return 'Wk ' + new Date(b + 'T00:00:00Z').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' });
}

export interface Period {
  start: number; // inclusive
  end: number; // inclusive
}

export const PERIOD_LABELS: Record<PeriodPreset, string> = {
  all: 'All time',
  last4w: 'Last 4 weeks',
  r13w: 'Rolling 13 weeks (R13W)',
  last6m: 'Last 6 months',
  ytd: 'Year to date',
  last12m: 'Last 12 months',
  custom: 'Custom range',
};

/** Resolve a preset against the anchor (latest date available in the data). */
export function resolvePeriod(preset: PeriodPreset, anchor: number, min: number, custom?: { start?: string; end?: string }): Period | null {
  const end = anchor;
  switch (preset) {
    case 'all':
      return null;
    case 'last4w':
      return { start: end - 27 * DAY, end };
    case 'r13w':
      return { start: end - (13 * 7 - 1) * DAY, end };
    case 'last6m': {
      const d = new Date(end);
      return { start: Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 6, d.getUTCDate()) + DAY, end };
    }
    case 'last12m': {
      const d = new Date(end);
      return { start: Date.UTC(d.getUTCFullYear() - 1, d.getUTCMonth(), d.getUTCDate()) + DAY, end };
    }
    case 'ytd':
      return { start: Date.UTC(new Date(end).getUTCFullYear(), 0, 1), end };
    case 'custom': {
      const s = custom?.start ? parseDate(custom.start)?.t : min;
      const e = custom?.end ? parseDate(custom.end)?.t : end;
      return { start: s ?? min, end: e ?? end };
    }
  }
}

/** Immediately preceding period of equal length (used for current vs previous comparisons). */
export function previousPeriod(p: Period): Period {
  const len = p.end - p.start + DAY;
  return { start: p.start - len, end: p.end - len };
}

export const periodDays = (p: Period) => Math.round((p.end - p.start) / DAY) + 1;

export const fmtPeriod = (p: Period | null) => (p ? `${toIsoDate(p.start)} → ${toIsoDate(p.end)}` : 'All available dates');

/** All buckets between two bucket keys (inclusive), used to zero-fill gaps in trend charts. */
export function bucketRange(first: string, last: string, grain: TimeGrain): string[] {
  const out: string[] = [];
  if (grain === 'week') {
    for (let t = Date.parse(first + 'T00:00:00Z'); t <= Date.parse(last + 'T00:00:00Z') && out.length < 1000; t += 7 * DAY) out.push(toIsoDate(t));
    return out;
  }
  const parse = (b: string) => (grain === 'month' ? { y: +b.slice(0, 4), i: +b.slice(5, 7) - 1 } : { y: +b.slice(0, 4), i: +b.slice(6) - 1 });
  const a = parse(first);
  const z = parse(last);
  const per = grain === 'month' ? 12 : 4;
  for (let n = a.y * per + a.i; n <= z.y * per + z.i && out.length < 1000; n++) {
    const y = Math.floor(n / per);
    const i = n % per;
    out.push(grain === 'month' ? `${y}-${String(i + 1).padStart(2, '0')}` : `${y}-Q${i + 1}`);
  }
  return out;
}
