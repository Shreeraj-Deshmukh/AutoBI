import type { Cell, DashComponent, DatasetProfile, FieldRef, MeasureCondition, MeasureDef, PeriodPreset, Relationship, Row, TimeGrain } from '@/types';
import { bucketOf, parseDate, previousPeriod, resolvePeriod, type Period } from './dates';
import { conditionsOf, test as testCond } from './conditions';
import { rowsVersion } from './rowStore';

/**
 * Celestra semantic query engine.
 * Consumes the reporting foundation (measures + relationships) and evaluates
 * KPIs, grouped aggregates and time series directly over the ingested rows.
 * Dimension filters on related tables are resolved via many-to-one joins.
 */

export const ref = (datasetId: string, col: string): FieldRef => `${datasetId}::${col}`;
export const splitRef = (r: FieldRef) => {
  const i = r.lastIndexOf('::');
  return { datasetId: r.slice(0, i), column: r.slice(i + 2) };
};

export const UNMATCHED = '(Unmatched)';
export const BLANK = '(Blank)';

export interface FilterState {
  period: PeriodPreset;
  custom?: { start?: string; end?: string };
  selections: Record<FieldRef, string[]>;
}

export interface WideRow {
  v: Record<FieldRef, Cell>;
  t: number | null;
}

export interface EngineInput {
  profiles: DatasetProfile[];
  relationships: Relationship[];
  measures: MeasureDef[];
  rowsOf: (id: string) => Row[];
}

/** One level of a chart axis: a field, or the period of the measure's own date. */
export type AxisLevel = { field: FieldRef } | { grain: TimeGrain };
/** One axis position of `Engine.matrix`: the key per axis level, and the value per series (key `VALUE` without a series). */
export interface MatrixRow {
  keys: string[];
  values: Record<string, number>;
  total: number;
}
export const VALUE = '__value';
const KEY_SEP = '\u0001';

/** Bar / stacked chart with a two-level axis (Territory › Product, Month › Product) and/or, for bars, one bar per series value. */
export const isMatrix = (c: DashComponent) => (c.type === 'bar' || c.type === 'stacked') && (!!c.subDimension || (!!c.timeGrain && !c.dimension) || (c.type === 'bar' && !!c.series));
/** Axis levels of a matrix chart, outermost first. */
export const axisOf = (c: DashComponent): AxisLevel[] => [...(c.timeGrain && !c.dimension ? [{ grain: c.timeGrain }] : c.dimension ? [{ field: c.dimension }] : []), ...(c.subDimension ? [{ field: c.subDimension }] : [])];

const wideCache = new Map<string, WideRow[]>();

export class Engine {
  readonly profiles: DatasetProfile[];
  readonly rels: Relationship[];
  readonly measures: Map<string, MeasureDef>;
  readonly rowsOf: (id: string) => Row[];
  readonly anchor: number;
  readonly minDate: number;

  constructor(input: EngineInput) {
    this.profiles = input.profiles;
    this.rels = input.relationships.filter((r) => r.status !== 'rejected');
    this.measures = new Map(input.measures.map((m) => [m.id, m]));
    this.rowsOf = input.rowsOf;
    let max = -Infinity;
    let min = Infinity;
    for (const p of this.profiles) {
      if (p.kind !== 'activity' || !p.dateField) continue;
      const c = p.columns.find((x) => x.name === p.dateField);
      if (c?.dateMax) max = Math.max(max, parseDate(c.dateMax)!.t);
      if (c?.dateMin) min = Math.min(min, parseDate(c.dateMin)!.t);
    }
    this.anchor = Number.isFinite(max) ? max : Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());
    this.minDate = Number.isFinite(min) ? min : this.anchor;
  }

  profile(id: string) {
    return this.profiles.find((p) => p.datasetId === id);
  }

  /** Many-to-one join path from a fact dataset to a target dataset (BFS, max 3 hops). */
  path(from: string, to: string): Relationship[] | null {
    if (from === to) return [];
    const queue: { ds: string; path: Relationship[] }[] = [{ ds: from, path: [] }];
    const seen = new Set([from]);
    while (queue.length) {
      const { ds, path } = queue.shift()!;
      if (path.length >= 3) continue;
      for (const r of this.rels.filter((x) => x.fromDataset === ds)) {
        if (seen.has(r.toDataset)) continue;
        const np = [...path, r];
        if (r.toDataset === to) return np;
        seen.add(r.toDataset);
        queue.push({ ds: r.toDataset, path: np });
      }
    }
    return null;
  }

  reachable(factId: string, field: FieldRef) {
    return this.path(factId, splitRef(field).datasetId) != null;
  }

  measureDatasets(mid: string): string[] {
    const m = this.measures.get(mid);
    if (!m) return [];
    if (m.kind === 'ratio') return [...new Set([...this.measureDatasets(m.numeratorId!), ...this.measureDatasets(m.denominatorId!)])];
    return m.datasetId ? [m.datasetId] : [];
  }

  /** Whether a filter on `field` affects measure `mid`. */
  applies(mid: string, field: FieldRef) {
    const ds = this.measureDatasets(mid);
    return ds.length > 0 && ds.every((d) => this.reachable(d, field));
  }

  /** Denormalised rows for a dataset with all reachable related attributes attached. */
  wide(datasetId: string): WideRow[] {
    const rows = this.rowsOf(datasetId);
    const relSig = this.rels.map((r) => `${r.fromDataset}.${r.fromField}>${r.toDataset}.${r.toField}`).join('|');
    // any dataset reachable through a join can change the wide rows, so key on the global data version
    const key = `${datasetId}|${rows.length}|${relSig}|${rowsVersion()}`;
    const hit = wideCache.get(key);
    if (hit) return hit;
    const p = this.profile(datasetId);
    const dateField = p?.dateField;
    // collect reachable datasets & join paths
    const targets = this.profiles.filter((x) => x.datasetId !== datasetId).map((x) => ({ id: x.datasetId, path: this.path(datasetId, x.datasetId) })).filter((x) => x.path);
    const index = new Map<string, Map<string, Row>>();
    const idx = (ds: string, field: string) => {
      const k = `${ds}.${field}`;
      if (!index.has(k)) {
        const m = new Map<string, Row>();
        for (const r of this.rowsOf(ds)) if (r[field] != null && !m.has(String(r[field]))) m.set(String(r[field]), r);
        index.set(k, m);
      }
      return index.get(k)!;
    };
    const out: WideRow[] = rows.map((r) => {
      const v: Record<FieldRef, Cell> = {};
      for (const [c, val] of Object.entries(r)) v[ref(datasetId, c)] = val;
      for (const t of targets) {
        let cur: Row | undefined = r;
        for (const rel of t.path!) {
          const key: Cell | undefined = cur?.[rel.fromField];
          cur = key == null ? undefined : idx(rel.toDataset, rel.toField).get(String(key));
          if (!cur) break;
        }
        const tp = this.profile(t.id)!;
        for (const c of tp.columns) v[ref(t.id, c.name)] = cur ? (cur[c.name] ?? null) : UNMATCHED;
      }
      const dt = dateField ? parseDate(r[dateField] as string) : null;
      return { v, t: dt ? dt.t : null };
    });
    wideCache.set(key, out);
    return out;
  }

  resolve(f: FilterState): { current: Period | null; previous: Period | null } {
    const current = resolvePeriod(f.period, this.anchor, this.minDate, f.custom);
    return { current, previous: current ? previousPeriod(current) : null };
  }

  /** Rows of a dataset after applying period + selections (selections that cannot reach this dataset are ignored). */
  filtered(datasetId: string, f: FilterState, period: Period | null, opts: { ignore?: FieldRef } = {}): WideRow[] {
    const p = this.profile(datasetId);
    const sels = Object.entries(f.selections).filter(([field, vals]) => vals.length && field !== opts.ignore && this.reachable(datasetId, field));
    const usePeriod = period && p?.dateField;
    return this.wide(datasetId).filter((w) => {
      if (usePeriod && (w.t == null || w.t < period!.start || w.t > period!.end)) return false;
      for (const [field, vals] of sels) if (!vals.includes(display(w.v[field]))) return false;
      return true;
    });
  }

  private aggregate(m: MeasureDef, rows: WideRow[]): number {
    const ds = m.datasetId!;
    const conds = conditionsOf(m);
    const rs = conds.length ? rows.filter((w) => conds.every((c) => testCond(c, w.v[ref(ds, c.field)]))) : rows;
    const fr = m.field ? ref(ds, m.field) : null;
    switch (m.kind) {
      case 'count':
        return fr ? rs.filter((w) => w.v[fr] != null && w.v[fr] !== '').length : rs.length;
      case 'countDistinct':
        return new Set(rs.map((w) => w.v[fr!]).filter((x) => x != null && x !== UNMATCHED)).size;
      case 'sum':
        return rs.reduce((s, w) => s + (typeof w.v[fr!] === 'number' ? (w.v[fr!] as number) : 0), 0);
      case 'avg': {
        const ns = rs.map((w) => w.v[fr!]).filter((x): x is number => typeof x === 'number');
        return ns.length ? ns.reduce((s, x) => s + x, 0) / ns.length : 0;
      }
      case 'median':
        return median(rs.map((w) => w.v[fr!]).filter((x): x is number => typeof x === 'number'));
      default:
        return 0;
    }
  }

  /** The source records behind a measure (its rows after filters and the measure's own conditions), plus optional extra conditions. */
  records(mid: string, f: FilterState, extra: MeasureCondition[] = []): WideRow[] {
    const m = this.measures.get(mid);
    if (!m?.datasetId || !this.profile(m.datasetId)) return [];
    const ds = m.datasetId;
    const { current } = this.resolve(f);
    const conds = [...conditionsOf(m), ...extra];
    const key = m.field ? ref(ds, m.field) : null;
    return this.filtered(ds, f, current).filter((w) => (!key || (w.v[key] != null && w.v[key] !== '')) && conds.every((c) => testCond(c, w.v[ref(ds, c.field)])));
  }

  value(mid: string, f: FilterState, period: Period | null): number | null {
    const m = this.measures.get(mid);
    if (!m) return null;
    if (m.kind === 'ratio') {
      const n = this.value(m.numeratorId!, f, period);
      const d = this.value(m.denominatorId!, f, period);
      if (n == null || d == null || d === 0) return null;
      return (n / d) * (m.format === 'percent' ? 100 : 1);
    }
    if (!m.datasetId || !this.profile(m.datasetId)) return null;
    return this.aggregate(m, this.filtered(m.datasetId, f, period));
  }

  /** KPI with current and previous period values. */
  kpi(mid: string, f: FilterState) {
    const { current, previous } = this.resolve(f);
    const cur = this.value(mid, f, current);
    const prev = previous ? this.value(mid, f, previous) : null;
    const m = this.measures.get(mid);
    const delta = cur != null && prev != null && prev !== 0 ? (m?.format === 'percent' ? cur - prev : ((cur - prev) / Math.abs(prev)) * 100) : null;
    return { current: cur, previous: prev, delta, period: current, previousPeriod: previous };
  }

  private groupRaw(m: MeasureDef, dim: FieldRef, f: FilterState, period: Period | null): Map<string, number> {
    const out = new Map<string, number>();
    if (m.kind === 'ratio') {
      const n = this.groupRaw(this.measures.get(m.numeratorId!)!, dim, f, period);
      const d = this.groupRaw(this.measures.get(m.denominatorId!)!, dim, f, period);
      for (const [k, dv] of d) if (dv) out.set(k, ((n.get(k) ?? 0) / dv) * (m.format === 'percent' ? 100 : 1));
      return out;
    }
    if (!m.datasetId || !this.reachable(m.datasetId, dim)) return out;
    const buckets = new Map<string, WideRow[]>();
    for (const w of this.filtered(m.datasetId, f, period)) {
      const k = display(w.v[dim]);
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k)!.push(w);
    }
    for (const [k, rows] of buckets) out.set(k, this.aggregate(m, rows));
    return out;
  }

  group(mid: string, dim: FieldRef, f: FilterState, opts: { topN?: number; threshold?: { op: 'gt' | 'gte'; value: number } } = {}) {
    const m = this.measures.get(mid);
    if (!m) return [];
    const { current } = this.resolve(f);
    const th = opts.threshold;
    // a "(Blank)" category with nothing in it is only rows the measure's conditions excluded (e.g. closed cases have no aging bucket)
    const arr = [...this.groupRaw(m, dim, f, current).entries()].map(([key, value]) => ({ key, value })).filter((g) => !(g.key === BLANK && !g.value) && (!th || (th.op === 'gt' ? g.value > th.value : g.value >= th.value)));
    const ordered = isOrdinal(arr.map((a) => a.key)) ? arr.sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true })) : arr.sort((a, b) => b.value - a.value);
    return opts.topN ? ordered.slice(0, opts.topN) : ordered;
  }

  /** Two-level grouping for stacked charts. */
  group2(mid: string, dim: FieldRef, series: FieldRef, f: FilterState) {
    const m = this.measures.get(mid);
    if (!m || m.kind === 'ratio' || !m.datasetId) return { rows: [] as Record<string, number | string>[], keys: [] as string[] };
    const { current } = this.resolve(f);
    const rows = this.filtered(m.datasetId, f, current);
    const nested = new Map<string, Map<string, WideRow[]>>();
    const keys = new Set<string>();
    for (const w of rows) {
      const a = display(w.v[dim]);
      const b = display(w.v[series]);
      keys.add(b);
      if (!nested.has(a)) nested.set(a, new Map());
      const inner = nested.get(a)!;
      if (!inner.has(b)) inner.set(b, []);
      inner.get(b)!.push(w);
    }
    const out = [...nested.entries()].map(([a, inner]) => {
      const o: Record<string, number | string> = { key: a };
      let total = 0;
      for (const [b, rs] of inner) {
        const v = this.aggregate(m, rs);
        o[b] = v;
        total += v;
      }
      o.__total = total;
      return o;
    });
    out.sort((x, y) => (isOrdinal([String(x.key), String(y.key)]) ? String(x.key).localeCompare(String(y.key), undefined, { numeric: true }) : (y.__total as number) - (x.__total as number)));
    return { rows: out, keys: [...keys].sort() };
  }

  /** Value of a measure for every combination of the given levels (field values or periods of the measure's date). */
  private multiRaw(m: MeasureDef, levels: AxisLevel[], f: FilterState, period: Period | null): Map<string, number> {
    const out = new Map<string, number>();
    if (m.kind === 'ratio') {
      const n = this.multiRaw(this.measures.get(m.numeratorId!)!, levels, f, period);
      const d = this.multiRaw(this.measures.get(m.denominatorId!)!, levels, f, period);
      for (const [k, dv] of d) if (dv) out.set(k, ((n.get(k) ?? 0) / dv) * (m.format === 'percent' ? 100 : 1));
      return out;
    }
    if (!m.datasetId || levels.some((l) => 'field' in l && !this.reachable(m.datasetId!, l.field))) return out;
    const buckets = new Map<string, WideRow[]>();
    for (const w of this.filtered(m.datasetId, f, period)) {
      const parts = levels.map((l) => ('grain' in l ? (w.t == null ? null : bucketOf(w.t, l.grain)) : display(w.v[l.field])));
      if (parts.some((p) => p == null)) continue;
      const k = parts.join(KEY_SEP);
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k)!.push(w);
    }
    for (const [k, rows] of buckets) out.set(k, this.aggregate(m, rows));
    return out;
  }

  /**
   * Multi-level grouping for charts with a two-level axis and/or a series, e.g. closure rate by month › product, one bar per territory.
   * Rows are ordered level by level (periods and ordinal values ascending, other values alphabetically).
   */
  matrix(mid: string, axis: AxisLevel[], series: FieldRef | undefined, f: FilterState) {
    const m = this.measures.get(mid);
    if (!m) return { rows: [] as MatrixRow[], series: [] as string[] };
    const { current } = this.resolve(f);
    const raw = this.multiRaw(m, series ? [...axis, { field: series }] : axis, f, current);
    const rows = new Map<string, MatrixRow>();
    const seriesKeys = new Map<string, number>();
    for (const [k, v] of raw) {
      const parts = k.split(KEY_SEP);
      const keys = parts.slice(0, axis.length);
      if (keys.includes(UNMATCHED)) continue;
      const s = series ? parts[axis.length] : VALUE;
      if (s === UNMATCHED || (s === BLANK && !v)) continue;
      const id = keys.join(KEY_SEP);
      if (!rows.has(id)) rows.set(id, { keys, values: {}, total: 0 });
      const row = rows.get(id)!;
      row.values[s] = v;
      row.total += v;
      seriesKeys.set(s, (seriesKeys.get(s) ?? 0) + v);
    }
    const order = axis.map((_, i) => {
      const vals = [...new Set([...rows.values()].map((r) => r.keys[i]))];
      const sorted = isOrdinal(vals) || 'grain' in axis[i] ? vals.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })) : vals.sort((a, b) => a.localeCompare(b));
      return new Map(sorted.map((v, j) => [v, j]));
    });
    const out = [...rows.values()].sort((a, b) => {
      for (let i = 0; i < axis.length; i++) {
        const d = order[i].get(a.keys[i])! - order[i].get(b.keys[i])!;
        if (d) return d;
      }
      return 0;
    });
    const sk = [...seriesKeys.keys()];
    return { rows: out, series: isOrdinal(sk) ? sk.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })) : sk.sort((a, b) => a.localeCompare(b)) };
  }

  series(mid: string, grain: TimeGrain, f: FilterState) {
    const m = this.measures.get(mid);
    if (!m) return [];
    const { current } = this.resolve(f);
    return [...this.seriesRaw(m, grain, f, current).entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([bucket, value]) => ({ bucket, value }));
  }

  private seriesRaw(m: MeasureDef, grain: TimeGrain, f: FilterState, period: Period | null): Map<string, number> {
    const out = new Map<string, number>();
    if (m.kind === 'ratio') {
      const n = this.seriesRaw(this.measures.get(m.numeratorId!)!, grain, f, period);
      const d = this.seriesRaw(this.measures.get(m.denominatorId!)!, grain, f, period);
      for (const [k, dv] of d) if (dv) out.set(k, ((n.get(k) ?? 0) / dv) * (m.format === 'percent' ? 100 : 1));
      return out;
    }
    if (!m.datasetId) return out;
    const buckets = new Map<string, WideRow[]>();
    for (const w of this.filtered(m.datasetId, f, period)) {
      if (w.t == null) continue;
      const b = bucketOf(w.t, grain);
      if (!buckets.has(b)) buckets.set(b, []);
      buckets.get(b)!.push(w);
    }
    for (const [k, rows] of buckets) out.set(k, this.aggregate(m, rows));
    return out;
  }

  /** Table: one row per value of `dim`, with attribute columns and measure columns. */
  table(dim: FieldRef, measureIds: string[], attrs: FieldRef[], f: FilterState) {
    const { datasetId } = splitRef(dim);
    const { current } = this.resolve(f);
    // attributes come from the dimension's own dataset row
    const baseRows = this.filtered(datasetId, { ...f, period: 'all' }, null);
    const attrMap = new Map<string, Record<string, Cell>>();
    for (const w of baseRows) {
      const k = display(w.v[dim]);
      if (!attrMap.has(k)) attrMap.set(k, Object.fromEntries(attrs.map((a) => [a, w.v[a] ?? null])));
    }
    const groups = measureIds.map((mid) => ({ mid, g: this.measures.get(mid) ? this.groupRaw(this.measures.get(mid)!, dim, f, current) : new Map<string, number>() }));
    const keys = new Set<string>([...attrMap.keys()]);
    // keep rows that only exist on the activity side (e.g. unmatched keys) so totals reconcile
    for (const { g } of groups) for (const k of g.keys()) keys.add(k);
    const out = [...keys].map((k) => {
      const row: Record<string, Cell> = { __key: k, ...(attrMap.get(k) ?? {}) };
      for (const { mid, g } of groups) row[mid] = g.get(k) ?? 0;
      return row;
    });
    return out;
  }

  /** Distinct values for a filter field (sorted). */
  distinct(field: FieldRef): string[] {
    const { datasetId, column } = splitRef(field);
    const s = new Set<string>();
    for (const r of this.rowsOf(datasetId)) s.add(display(r[column] ?? null));
    return [...s].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }
}

export function display(v: Cell | undefined): string {
  if (v === UNMATCHED) return UNMATCHED;
  if (v == null || v === '') return BLANK;
  return String(v);
}

export function median(ns: number[]): number {
  if (!ns.length) return 0;
  const s = [...ns].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function isOrdinal(keys: string[]) {
  const real = keys.filter((k) => k !== BLANK && k !== UNMATCHED);
  // tiers / dates / plain numbers, and numeric buckets such as "0-7 days", "8-14 days", "30+ days"
  return real.length > 0 && (real.every((k) => /^(tier|level|grade|q|wave|phase|band|decile)\s*\d/i.test(k) || /^\d{4}-/.test(k)) || real.every((k) => /^-?\d+(\.\d+)?$/.test(k)) || real.every((k) => /^\d+\s*(?:[-–]\s*\d+|\+)/.test(k)));
}

export const emptyFilters = (period: PeriodPreset = 'all'): FilterState => ({ period, selections: {} });
