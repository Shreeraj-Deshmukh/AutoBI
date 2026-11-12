import type { ReleaseState, CheckSpec, DashComponent, DashboardSpec, DataUnderstanding, MeasureDef, Row, TestStatus } from '@/types';
import { Engine, display, splitRef, type FilterState } from '@/lib/engine';
import { conditionsOf, test as testCond } from '@/lib/conditions';
import { rowsVersion } from '@/lib/rowStore';
import { bucketOf, fmtPeriod, parseDate, previousPeriod, resolvePeriod, toIsoDate, type Period } from '@/lib/dates';
import { bindCatalogue } from '@/lib/catalogue';
import { KPI_CATALOGUE } from '@/config/kpiCatalogue';

/**
 * Independent validators used by the Testing Agent.
 * These deliberately re-implement filtering, joining and aggregation directly
 * over the raw source rows (no Engine internals), so dashboard numbers are
 * reconciled against an independent calculation rather than against themselves.
 */

export interface CheckResult {
  status: TestStatus;
  actual: string;
  evidence: string;
}

interface Ctx {
  spec: DashboardSpec;
  u: DataUnderstanding;
  measures: MeasureDef[];
  rowsOf: (id: string) => Row[];
  engine: Engine;
  release?: ReleaseState;
}

const EPS = 1e-6;
const fmt = (n: number | null | undefined) => (n == null ? 'n/a' : Number.isInteger(n) ? n.toLocaleString('en-US') : n.toFixed(4));

// ── independent computation ──────────────────────────────────────────────
function lookupChain(ctx: Ctx, from: string, to: string): { fromField: string; toDataset: string; toField: string }[] | null {
  if (from === to) return [];
  const rels = ctx.u.relationships.filter((r) => r.status !== 'rejected');
  const walk = (cur: string, seen: Set<string>): { fromField: string; toDataset: string; toField: string }[] | null => {
    for (const r of rels.filter((x) => x.fromDataset === cur && !seen.has(x.toDataset))) {
      if (r.toDataset === to) return [r];
      const rest = walk(r.toDataset, new Set([...seen, r.toDataset]));
      if (rest) return [r, ...rest];
    }
    return null;
  };
  return walk(from, new Set([from]));
}

const indexCache = new Map<string, Map<string, Row>>();
function rowByKey(ctx: Ctx, ds: string, field: string) {
  const k = `${ds}|${field}|${ctx.rowsOf(ds).length}|${rowsVersion()}`;
  if (!indexCache.has(k)) {
    const m = new Map<string, Row>();
    for (const r of ctx.rowsOf(ds)) if (r[field] != null && !m.has(String(r[field]))) m.set(String(r[field]), r);
    indexCache.set(k, m);
  }
  return indexCache.get(k)!;
}

function attr(ctx: Ctx, ds: string, row: Row, field: string): string | undefined {
  const { datasetId, column } = splitRef(field);
  const chain = lookupChain(ctx, ds, datasetId);
  if (!chain) return undefined; // not applicable
  let cur: Row | undefined = row;
  for (const step of chain) {
    const key: unknown = cur?.[step.fromField];
    cur = key == null ? undefined : rowByKey(ctx, step.toDataset, step.toField).get(String(key));
    if (!cur) return '(Unmatched)';
  }
  return display(cur[column] ?? null);
}

function indRows(ctx: Ctx, ds: string, f: FilterState, period: Period | null): Row[] {
  const p = ctx.u.profiles.find((x) => x.datasetId === ds);
  const sels = Object.entries(f.selections).filter(([, v]) => v.length);
  return ctx.rowsOf(ds).filter((r) => {
    if (period && p?.dateField) {
      const t = parseDate(r[p.dateField] as string)?.t;
      if (t == null || t < period.start || t > period.end) return false;
    }
    for (const [field, vals] of sels) {
      const v = attr(ctx, ds, r, field);
      if (v !== undefined && !vals.includes(v)) return false;
    }
    return true;
  });
}

function indAgg(m: MeasureDef, rows: Row[]): number {
  let rs = rows;
  const conds = conditionsOf(m);
  if (conds.length) rs = rs.filter((r) => conds.every((c) => testCond(c, r[c.field])));
  if (m.kind === 'count') return m.field ? rs.filter((r) => r[m.field!] != null && r[m.field!] !== '').length : rs.length;
  if (m.kind === 'countDistinct') return new Set(rs.map((r) => r[m.field!]).filter((v) => v != null)).size;
  if (m.kind === 'sum') return rs.reduce((s, r) => s + (typeof r[m.field!] === 'number' ? (r[m.field!] as number) : 0), 0);
  if (m.kind === 'avg') {
    const ns = rs.map((r) => r[m.field!]).filter((v): v is number => typeof v === 'number');
    return ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : 0;
  }
  if (m.kind === 'median') {
    // independent median: middle element(s) of the sorted values
    const ns = rs.map((r) => r[m.field!]).filter((v): v is number => typeof v === 'number').sort((a, b) => a - b);
    if (!ns.length) return 0;
    const h = ns.length >> 1;
    return ns.length & 1 ? ns[h] : (ns[h - 1] + ns[h]) / 2;
  }
  return 0;
}

export function indValue(ctx: Ctx, mid: string, f: FilterState, period: Period | null): number | null {
  const m = ctx.measures.find((x) => x.id === mid);
  if (!m) return null;
  if (m.kind === 'ratio') {
    const n = indValue(ctx, m.numeratorId!, f, period);
    const d = indValue(ctx, m.denominatorId!, f, period);
    return n == null || !d ? null : (n / d) * (m.format === 'percent' ? 100 : 1);
  }
  return indAgg(m, indRows(ctx, m.datasetId!, f, period));
}

function indGroup(ctx: Ctx, mid: string, dim: string, f: FilterState, period: Period | null): Map<string, number> {
  const m = ctx.measures.find((x) => x.id === mid)!;
  if (m.kind === 'ratio') {
    const n = indGroup(ctx, m.numeratorId!, dim, f, period);
    const d = indGroup(ctx, m.denominatorId!, dim, f, period);
    const o = new Map<string, number>();
    for (const [k, dv] of d) if (dv) o.set(k, ((n.get(k) ?? 0) / dv) * (m.format === 'percent' ? 100 : 1));
    return o;
  }
  const groups = new Map<string, Row[]>();
  for (const r of indRows(ctx, m.datasetId!, f, period)) {
    const k = attr(ctx, m.datasetId!, r, dim) ?? '(n/a)';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }
  return new Map([...groups].map(([k, rs]) => [k, indAgg(m, rs)]));
}

// ── helpers ─────────────────────────────────────────────────────────────
const comp = (ctx: Ctx, id: string): DashComponent | undefined => ctx.spec.pages.flatMap((p) => p.components).find((c) => c.id === id);
const mname = (ctx: Ctx, id: string) => ctx.measures.find((m) => m.id === id)?.name ?? id;
const additive = (ctx: Ctx, id: string) => {
  const m = ctx.measures.find((x) => x.id === id);
  return !!m && (m.kind === 'count' || m.kind === 'sum');
};
const defaults = (ctx: Ctx): FilterState => ({ period: ctx.spec.defaultPeriod, selections: {} });
const pass = (actual: string, evidence: string): CheckResult => ({ status: 'Passed', actual, evidence });
const fail = (actual: string, evidence: string): CheckResult => ({ status: 'Failed', actual, evidence });

function compareMaps(a: Map<string, number>, b: Map<string, number>) {
  const diffs: string[] = [];
  for (const k of new Set([...a.keys(), ...b.keys()])) {
    const x = a.get(k) ?? 0;
    const y = b.get(k) ?? 0;
    if (Math.abs(x - y) > EPS) diffs.push(`${k}: dashboard ${fmt(x)} vs source ${fmt(y)}`);
  }
  return diffs;
}

function mostCommon(ctx: Ctx, field: string) {
  const { datasetId, column } = splitRef(field);
  const counts = new Map<string, number>();
  for (const r of ctx.rowsOf(datasetId)) {
    const v = display(r[column] ?? null);
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts].filter(([k]) => k !== '(Blank)').sort((a, b) => b[1] - a[1])[0]?.[0];
}

// ── execution ───────────────────────────────────────────────────────────
export function runCheck(check: CheckSpec, ctx: Ctx): CheckResult {
  const E = ctx.engine;
  const f = defaults(ctx);
  const { current } = E.resolve(f);
  switch (check.kind) {
    case 'kpi_recompute': {
      const k = E.kpi(check.measureId, f);
      const src = indValue(ctx, check.measureId, f, current);
      const prevSrc = k.previousPeriod ? indValue(ctx, check.measureId, f, k.previousPeriod) : null;
      const okCur = k.current != null && src != null && Math.abs(k.current - src) < EPS;
      const okPrev = !k.previousPeriod || (k.previous == null && prevSrc == null) || (k.previous != null && prevSrc != null && Math.abs(k.previous - prevSrc) < EPS);
      const ev = `Period ${fmtPeriod(current)}. Dashboard current=${fmt(k.current)}, source recomputation=${fmt(src)}; previous period dashboard=${fmt(k.previous)}, source=${fmt(prevSrc)}.`;
      return okCur && okPrev ? pass(`${mname(ctx, check.measureId)} = ${fmt(k.current)} matches source`, ev) : fail(`Mismatch: dashboard ${fmt(k.current)} vs source ${fmt(src)}`, ev);
    }
    case 'ratio_bounds': {
      const m = ctx.measures.find((x) => x.id === check.measureId)!;
      const v = E.value(m.id, f, current);
      const n = indValue(ctx, m.numeratorId!, f, current);
      const d = indValue(ctx, m.denominatorId!, f, current);
      const expected = n != null && d ? (n / d) * (m.format === 'percent' ? 100 : 1) : null;
      const inBounds = m.format !== 'percent' || (v != null && v >= 0 && v <= 100);
      const ev = `Numerator ${mname(ctx, m.numeratorId!)}=${fmt(n)}, denominator ${mname(ctx, m.denominatorId!)}=${fmt(d)}, expected ${fmt(expected)}, dashboard ${fmt(v)}.`;
      return v != null && expected != null && Math.abs(v - expected) < EPS && inBounds ? pass(`${m.name} = ${v.toFixed(2)}${m.format === 'percent' ? '%' : ''}, within bounds`, ev) : fail(`${m.name} invalid (${fmt(v)})`, ev);
    }
    case 'group_recompute': {
      const c = comp(ctx, check.componentId);
      if (!c?.dimension) return { status: 'Blocked', actual: 'Component no longer exists or has no dimension.', evidence: '' };
      const mid = check.measureId && c.measureIds.includes(check.measureId) ? check.measureId : c.measureIds[0];
      const dash = new Map(E.group(mid, c.dimension, f, { topN: c.topN, threshold: c.threshold }).map((g) => [g.key, g.value]));
      const src = indGroup(ctx, mid, c.dimension, f, current);
      if (c.topN) for (const k of [...src.keys()]) if (!dash.has(k)) src.delete(k);
      if (c.threshold) for (const [k, v] of [...src]) if (!(c.threshold.op === 'gt' ? v > c.threshold.value : v >= c.threshold.value)) src.delete(k);
      const diffs = compareMaps(dash, src);
      const ev = `${dash.size} categories compared for ${mname(ctx, mid)} by ${splitRef(c.dimension).column} (${fmtPeriod(current)}). ${[...dash].slice(0, 6).map(([k, v]) => `${k}=${fmt(v)}`).join(', ')}${dash.size > 6 ? ', …' : ''}`;
      return diffs.length ? fail(`${diffs.length} category value(s) differ from source`, `${ev}\nDifferences: ${diffs.slice(0, 5).join('; ')}`) : pass(`All ${dash.size} category values match source data`, ev);
    }
    case 'group_rollup': {
      const c = comp(ctx, check.componentId);
      if (!c?.dimension) return { status: 'Blocked', actual: 'Component missing.', evidence: '' };
      const mid = c.measureIds[0];
      if (!additive(ctx, mid)) return { status: 'Blocked', actual: 'Measure is not additive; roll-up check not applicable.', evidence: `${mname(ctx, mid)} is a ratio or distinct count.` };
      const total = E.value(mid, f, current) ?? 0;
      if (c.type === 'stacked' && c.series) {
        const g = E.group2(mid, c.dimension, c.series, f);
        const bad = g.rows.filter((r) => Math.abs(g.keys.reduce((s, k) => s + ((r[k] as number) ?? 0), 0) - (r.__total as number)) > EPS);
        const grand = g.rows.reduce((s, r) => s + (r.__total as number), 0);
        const ev = `${g.rows.length} stacks × ${g.keys.length} series. Sum of stacks=${fmt(grand)}; ${mname(ctx, mid)} total=${fmt(total)}.`;
        return !bad.length && Math.abs(grand - total) < EPS ? pass('Stacked totals equal the sum of their segments and the overall total', ev) : fail(`${bad.length} stack(s) inconsistent; grand total ${fmt(grand)} vs ${fmt(total)}`, ev);
      }
      const g = E.group(mid, c.dimension, f);
      const sum = g.reduce((s, x) => s + x.value, 0);
      const ev = `Sum of ${g.length} categories=${fmt(sum)}; ${mname(ctx, mid)} total=${fmt(total)} (${fmtPeriod(current)}).`;
      return Math.abs(sum - total) < EPS || c.topN || c.threshold ? pass(c.topN || c.threshold ? `Top ${c.topN} shown; sum ${fmt(sum)} ≤ total ${fmt(total)}` : 'Sum of categories equals the total', ev) : fail(`Sum of categories ${fmt(sum)} ≠ total ${fmt(total)}`, ev);
    }
    case 'series_recompute': {
      const c = comp(ctx, check.componentId);
      if (!c) return { status: 'Blocked', actual: 'Component missing.', evidence: '' };
      const grain = c.timeGrain ?? ctx.spec.timeGrain;
      const results: string[] = [];
      let ok = true;
      for (const mid of c.measureIds) {
        const s = E.series(mid, grain, f);
        const ds = ctx.measures.find((m) => m.id === mid);
        // independent bucketing
        const p = ctx.u.profiles.find((x) => x.datasetId === (ds?.datasetId ?? ctx.measures.find((m) => m.id === ds?.numeratorId)?.datasetId));
        if (!ds || !p?.dateField) continue;
        const src = new Map<string, number>();
        if (ds.kind !== 'ratio') {
          const groups = new Map<string, Row[]>();
          for (const r of indRows(ctx, ds.datasetId!, f, current)) {
            const t = parseDate(r[p.dateField] as string)?.t;
            if (t == null) continue;
            const b = bucketOf(t, grain);
            if (!groups.has(b)) groups.set(b, []);
            groups.get(b)!.push(r);
          }
          for (const [b, rs] of groups) src.set(b, indAgg(ds, rs));
          const diffs = compareMaps(new Map(s.map((x) => [x.bucket, x.value])), src);
          if (diffs.length) ok = false;
          results.push(`${ds.name}: ${s.length} buckets, ${diffs.length} difference(s)`);
        } else {
          const bad = s.filter((x) => ds.format === 'percent' && (x.value < 0 || x.value > 100));
          if (bad.length) ok = false;
          results.push(`${ds.name}: ${s.length} buckets, ${bad.length} out of range`);
        }
      }
      return ok ? pass(`Time series reconciles to source at ${grain} grain`, results.join('; ')) : fail('Time-series values differ from source', results.join('; '));
    }
    case 'table_total': {
      const c = comp(ctx, check.componentId);
      if (!c?.dimension) return { status: 'Blocked', actual: 'Component missing.', evidence: '' };
      const rows = E.table(c.dimension, c.measureIds, c.tableColumns ?? [], f);
      const lines: string[] = [];
      let ok = true;
      for (const mid of c.measureIds.filter((m) => additive(ctx, m))) {
        const sum = rows.reduce((s, r) => s + ((r[mid] as number) ?? 0), 0);
        const src = indValue(ctx, mid, f, current) ?? 0;
        if (Math.abs(sum - src) > EPS) ok = false;
        lines.push(`${mname(ctx, mid)}: row sum ${fmt(sum)} vs source total ${fmt(src)}`);
      }
      return ok ? pass(`Grand totals of ${rows.length} rows match source totals`, lines.join('; ')) : fail('Row-wise totals do not reconcile to source', lines.join('; '));
    }
    case 'filter_apply': {
      const fd = ctx.spec.filters.find((x) => x.id === check.filterId);
      if (!fd) return { status: 'Blocked', actual: 'Filter no longer exists.', evidence: '' };
      if (fd.type === 'period') return runCheck({ kind: 'period_logic' }, ctx);
      const val = mostCommon(ctx, fd.field!);
      const ff: FilterState = { ...f, selections: { [fd.field!]: [val!] } };
      const lines: string[] = [];
      let ok = true;
      let affected = 0;
      const mids = [...new Set(ctx.spec.pages.flatMap((p) => p.components.filter((c) => c.type === 'kpi').flatMap((c) => c.measureIds)))];
      for (const mid of mids) {
        const applies = E.applies(mid, fd.field!);
        const d = E.value(mid, ff, current);
        const s = indValue(ctx, mid, ff, current);
        if (applies) affected++;
        const same = (d == null && s == null) || (d != null && s != null && Math.abs(d - s) < EPS);
        if (!same) ok = false;
        lines.push(`${mname(ctx, mid)}${applies ? '' : ' (not related – unchanged)'}: ${fmt(d)} vs source ${fmt(s)}`);
      }
      return ok ? pass(`Filter ${fd.label} = "${val}" correctly updates ${affected} related measure(s)`, lines.join('; ')) : fail(`Filtered values differ from source for ${fd.label} = "${val}"`, lines.join('; '));
    }
    case 'multi_filter': {
      const multi = ctx.spec.filters.filter((x) => x.type === 'multi').slice(0, 2);
      if (!multi.length) return { status: 'Blocked', actual: 'Fewer than one category filter configured.', evidence: '' };
      const sel: Record<string, string[]> = {};
      for (const m of multi) sel[m.field!] = [mostCommon(ctx, m.field!)!];
      const ff: FilterState = { ...f, selections: sel };
      const mids = [...new Set(ctx.spec.pages.flatMap((p) => p.components.flatMap((c) => c.measureIds)))];
      const diffs = mids.filter((mid) => {
        const d = E.value(mid, ff, current);
        const s = indValue(ctx, mid, ff, current);
        return !((d == null && s == null) || (d != null && s != null && Math.abs(d - s) < EPS));
      });
      const ev = `Applied ${Object.entries(sel).map(([k, v]) => `${splitRef(k).column}=${v[0]}`).join(' + ')} with period ${fmtPeriod(current)} across ${mids.length} measures.`;
      return diffs.length ? fail(`${diffs.length} measure(s) inconsistent under combined filters`, `${ev} Failing: ${diffs.map((d) => mname(ctx, d)).join(', ')}`) : pass('All visuals update consistently under combined filters', ev);
    }
    case 'period_logic': {
      const presets = ['last4w', 'r13w', 'last6m'] as const;
      const lines: string[] = [];
      let ok = true;
      for (const pr of presets) {
        const p = resolvePeriod(pr, E.anchor, E.minDate)!;
        const prev = previousPeriod(p);
        const lenOk = Math.abs(p.end - p.start - (prev.end - prev.start)) < 1;
        const adj = p.start - prev.end === 86_400_000;
        if (!lenOk || !adj) ok = false;
        lines.push(`${pr}: current ${fmtPeriod(p)}, previous ${fmtPeriod(prev)}${lenOk && adj ? ' ✓' : ' ✗'}`);
      }
      const mid = ctx.measures.find((m) => m.kind === 'count' && !m.condition && m.datasetId && ctx.u.profiles.find((p) => p.datasetId === m.datasetId)?.kind === 'activity');
      if (mid) {
        const k = E.kpi(mid.id, f);
        const s = k.previousPeriod ? indValue(ctx, mid.id, f, k.previousPeriod) : null;
        if (k.previousPeriod && (s == null || k.previous == null || Math.abs(s - k.previous) > EPS)) ok = false;
        lines.push(`${mid.name}: current ${fmt(k.current)}, previous ${fmt(k.previous)} (source ${fmt(s)})`);
      }
      return ok ? pass('Previous period has equal length, is adjacent, and values reconcile', lines.join('\n')) : fail('Period comparison logic inconsistent', lines.join('\n'));
    }
    case 'default_period': {
      const p = resolvePeriod(ctx.spec.defaultPeriod, E.anchor, E.minDate);
      const maxDate = Math.max(...ctx.u.profiles.filter((x) => x.kind === 'activity' && x.dateField).map((x) => parseDate(x.columns.find((c) => c.name === x.dateField)!.dateMax!)!.t));
      const ok = (!p || p.end === maxDate) && E.anchor === maxDate;
      return ok ? pass(`Default period "${ctx.spec.defaultPeriod}" resolves to ${fmtPeriod(p)}`, `Anchor = latest activity date ${toIsoDate(maxDate)}.`) : fail('Default period not anchored to latest data date', `Anchor ${toIsoDate(E.anchor)} vs data max ${toIsoDate(maxDate)}.`);
    }
    case 'fk_integrity': {
      const r = ctx.u.relationships.find((x) => x.id === check.relationshipId);
      if (!r) return { status: 'Blocked', actual: 'Relationship removed.', evidence: '' };
      const keys = new Set(ctx.rowsOf(r.toDataset).map((x) => String(x[r.toField])));
      const bad = ctx.rowsOf(r.fromDataset).filter((x) => x[r.fromField] != null && !keys.has(String(x[r.fromField])));
      const label = (id: string) => ctx.u.profiles.find((p) => p.datasetId === id)?.label;
      const ev = `${ctx.rowsOf(r.fromDataset).length} ${label(r.fromDataset)} records checked against ${keys.size} ${label(r.toDataset)} keys.${bad.length ? ` Unmatched ${r.fromField} values: ${[...new Set(bad.map((b) => String(b[r.fromField])))].slice(0, 8).join(', ')}.` : ''}`;
      return bad.length ? fail(`${bad.length} record(s) reference a ${r.toField} not present in ${label(r.toDataset)}`, ev) : pass(`All ${r.fromField} values match ${label(r.toDataset)}`, ev);
    }
    case 'attribute_mapping': {
      const r = ctx.u.relationships.find((x) => x.id === check.relationshipId);
      if (!r) return { status: 'Blocked', actual: 'Relationship removed.', evidence: '' };
      const field = `${r.toDataset}::${check.field}`;
      const wide = E.wide(r.fromDataset);
      const src = ctx.rowsOf(r.fromDataset);
      const master = rowByKey(ctx, r.toDataset, r.toField);
      let checked = 0;
      let mismatched = 0;
      wide.forEach((w, i) => {
        const m = master.get(String(src[i][r.fromField]));
        if (!m) return;
        checked++;
        if (display(w.v[field]) !== display(m[check.field] ?? null)) mismatched++;
      });
      const ev = `${checked} matched records compared: ${check.field} on the dashboard vs ${check.field} in master record.`;
      return mismatched ? fail(`${mismatched} record(s) carry a different ${check.field} than the master`, ev) : pass(`${check.field} correctly mapped for all ${checked} matched records`, ev);
    }
    case 'row_count': {
      const p = ctx.u.profiles.find((x) => x.datasetId === check.datasetId);
      const n = ctx.rowsOf(check.datasetId).length;
      const wide = E.wide(check.datasetId).length;
      const ok = p?.rowCount === n && wide === n;
      return ok ? pass(`${n} rows loaded = ${n} rows profiled = ${wide} rows available to the dashboard`, `${p?.label}`) : fail(`Row count mismatch (source ${n}, profiled ${p?.rowCount}, dashboard ${wide})`, `${p?.label}`);
    }
    case 'duplicates': {
      const p = ctx.u.profiles.find((x) => x.datasetId === check.datasetId)!;
      const seen = new Map<string, number>();
      for (const r of ctx.rowsOf(check.datasetId)) {
        const k = JSON.stringify(r);
        seen.set(k, (seen.get(k) ?? 0) + 1);
      }
      const dups = [...seen.values()].reduce((s, c) => s + (c - 1), 0);
      const ex = [...seen].filter(([, c]) => c > 1).slice(0, 3).map(([k]) => (p.primaryKey ? String(JSON.parse(k)[p.primaryKey]) : k.slice(0, 60)));
      return dups ? fail(`${dups} duplicate record(s) found in ${p.label}`, `Examples: ${ex.join(', ')}. Duplicates inflate counts in every visual based on ${p.label}.`) : pass(`No duplicate records in ${p.label}`, `${ctx.rowsOf(check.datasetId).length} rows checked.`);
    }
    case 'timeline': {
      const m = ctx.measures.find((x) => x.id === check.measureId);
      const p = ctx.u.profiles.find((x) => x.datasetId === m?.datasetId);
      if (!m || !p?.dateField) return { status: 'Blocked', actual: 'No dated measure.', evidence: '' };
      const w = E.series(m.id, 'week', f).reduce((s, x) => s + x.value, 0);
      const mo = E.series(m.id, 'month', f).reduce((s, x) => s + x.value, 0);
      const q = E.series(m.id, 'quarter', f).reduce((s, x) => s + x.value, 0);
      const total = E.value(m.id, f, current) ?? 0;
      const undated = ctx.rowsOf(p.datasetId).filter((r) => !parseDate(r[p.dateField!] as string)).length;
      const ok = Math.abs(w - total) < EPS && Math.abs(mo - total) < EPS && Math.abs(q - total) < EPS;
      const ev = `Weekly sum ${fmt(w)}, monthly sum ${fmt(mo)}, quarterly sum ${fmt(q)}, period total ${fmt(total)}; ${undated} undated record(s) excluded.`;
      return ok ? pass('Weekly, monthly and quarterly aggregations reconcile to the period total', ev) : fail('Time aggregations do not reconcile', ev);
    }
    case 'outlier': {
      const c = comp(ctx, check.componentId);
      if (!c) return { status: 'Blocked', actual: 'Component missing.', evidence: '' };
      const s = E.series(c.measureIds[0], 'week', { ...f, period: 'all' });
      const vals = s.slice(1, -1).map((x) => x.value); // ignore partial first/last weeks
      const mean = vals.reduce((a, b) => a + b, 0) / (vals.length || 1);
      const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / (vals.length || 1));
      const spikes = s.slice(1, -1).filter((x) => sd > 0 && (x.value - mean) / sd > 3);
      const ev = `${s.length} weekly points; mean ${mean.toFixed(1)}, std dev ${sd.toFixed(1)}; threshold +3σ = ${(mean + 3 * sd).toFixed(1)}.`;
      return spikes.length ? { status: 'In Progress', actual: `${spikes.length} unexplained spike(s) need analyst review: ${spikes.map((x) => x.bucket).join(', ')}`, evidence: ev } : pass('No unexplained spikes (> +3σ) detected', ev);
    }
    case 'spec_integrity': {
      const pg = ctx.spec.pages.find((p) => p.id === check.pageId);
      if (!pg) return { status: 'Blocked', actual: 'Page removed.', evidence: '' };
      const problems: string[] = [];
      for (const c of pg.components) {
        if (c.measureIds.some((m) => !E.measures.has(m))) problems.push(`${c.title}: missing measure`);
        if (c.dimension && c.measureIds.some((m) => !E.applies(m, c.dimension!))) problems.push(`${c.title}: dimension unreachable`);
      }
      return problems.length || !pg.components.length ? fail(`${problems.length || 'No'} component problem(s) on ${pg.name}`, problems.join('; ') || 'Page has no components.') : pass(`Page "${pg.name}" resolves ${pg.components.length} components`, pg.components.map((c) => c.title).join(', '));
    }
    case 'correlation': {
      const a = E.series(check.measureA, 'week', { ...f, period: 'all' });
      const b = new Map(E.series(check.measureB, 'week', { ...f, period: 'all' }).map((x) => [x.bucket, x.value]));
      const pairs = a.filter((x) => b.has(x.bucket)).map((x) => [x.value, b.get(x.bucket)!] as const);
      if (pairs.length < 4) return fail('Activity timelines do not overlap', `${pairs.length} overlapping weeks.`);
      const ma = pairs.reduce((s, p) => s + p[0], 0) / pairs.length;
      const mb = pairs.reduce((s, p) => s + p[1], 0) / pairs.length;
      const cov = pairs.reduce((s, p) => s + (p[0] - ma) * (p[1] - mb), 0);
      const r = cov / Math.sqrt(pairs.reduce((s, p) => s + (p[0] - ma) ** 2, 0) * pairs.reduce((s, p) => s + (p[1] - mb) ** 2, 0) || 1);
      return pass(`${pairs.length} overlapping weeks; Pearson r = ${r.toFixed(2)}`, `Both channels cover the same reporting timeline. Correlation is informational: ${Math.abs(r) < 0.3 ? 'weak' : Math.abs(r) < 0.6 ? 'moderate' : 'strong'} alignment between ${mname(ctx, check.measureA)} and ${mname(ctx, check.measureB)}.`);
    }
    case 'unique_count': {
      const m = ctx.measures.find((x) => x.id === check.measureId);
      if (!m || m.kind === 'ratio' || !m.datasetId || !m.field) return { status: 'Blocked', actual: 'Measure no longer counts a field.', evidence: '' };
      const rows = indRows(ctx, m.datasetId, f, current);
      const conds = conditionsOf(m);
      const kept = conds.length ? rows.filter((r) => conds.every((c) => testCond(c, r[c.field]))) : rows;
      const vals = kept.map((r) => r[m.field!]).filter((v) => v != null && v !== '');
      const unique = new Set(vals.map(String)).size;
      const shown = E.value(m.id, f, current) ?? 0;
      const ev = `${m.name} = ${m.logic}. Period ${fmtPeriod(current)}: ${vals.length} records, ${unique} unique ${m.field}; dashboard shows ${fmt(shown)}.`;
      if (Math.abs(shown - unique) < EPS) return pass(`${m.name} = ${fmt(shown)} unique ${m.field} values`, ev);
      const dupIds = Object.entries(vals.reduce<Record<string, number>>((a, v) => ((a[String(v)] = (a[String(v)] ?? 0) + 1), a), {})).filter(([, n]) => n > 1).slice(0, 5).map(([k]) => k);
      return fail(`${m.name} shows ${fmt(shown)} but there are only ${unique} unique ${m.field} values — ${fmt(shown - unique)} duplicate record(s) are counted twice`, `${ev} Repeated IDs: ${dupIds.join(', ')}. Fix: change the KPI aggregation to COUNT DISTINCT(${m.field}) in KPI Definitions and re-run.`);
    }
    case 'funnel': {
      const c = comp(ctx, check.componentId);
      if (!c) return { status: 'Blocked', actual: 'Component missing.', evidence: '' };
      const lines: string[] = [];
      let ok = true;
      for (const mid of c.measureIds) {
        const d = E.value(mid, f, current);
        const sv = indValue(ctx, mid, f, current);
        const same = (d == null && sv == null) || (d != null && sv != null && Math.abs(d - sv) < EPS);
        if (!same) ok = false;
        lines.push(`${mname(ctx, mid)}: dashboard ${fmt(d)} vs source ${fmt(sv)}${same ? '' : ' ✗'}`);
      }
      return ok ? pass(`All ${c.measureIds.length} funnel stages match the source data`, lines.join('; ')) : fail('Funnel stage counts differ from the source data', lines.join('; '));
    }
    case 'records': {
      const c = comp(ctx, check.componentId);
      if (!c) return { status: 'Blocked', actual: 'Component missing.', evidence: '' };
      const m = ctx.measures.find((x) => x.id === c.measureIds[0]);
      if (!m?.datasetId) return { status: 'Blocked', actual: 'The list is not bound to a counted measure.', evidence: '' };
      const shown = E.records(m.id, f);
      // independent: raw source rows in the period that meet the measure's conditions
      const conds = conditionsOf(m);
      const src = indRows(ctx, m.datasetId, f, current).filter((r) => conds.every((cd) => testCond(cd, r[cd.field])) && (!m.field || (r[m.field] != null && r[m.field] !== '')));
      const keyCol = m.field ?? ctx.u.profiles.find((p) => p.datasetId === m.datasetId)?.primaryKey;
      const shownKeys = new Set(shown.map((w) => String(w.v[`${m.datasetId}::${keyCol}`])));
      const missing = src.filter((r) => !shownKeys.has(String(r[keyCol!])));
      const unlinked = (c.tableColumns ?? []).filter((x) => lookupChain(ctx, m.datasetId!, splitRef(x).datasetId) == null);
      const toggled = c.toggle ? E.records(m.id, f, c.toggle.filter) : null;
      const toggleOk = !toggled || toggled.every((w) => c.toggle!.filter.every((cd) => testCond(cd, w.v[`${m.datasetId}::${cd.field}`])));
      const ev = `${m.name} = ${m.logic}. Period ${fmtPeriod(current)}: list shows ${shown.length} record(s); source recount ${src.length}.${toggled ? ` "${c.toggle!.label}" narrows it to ${toggled.length}.` : ''}${unlinked.length ? ` Unlinked columns: ${unlinked.map((x) => splitRef(x).column).join(', ')}.` : ''}`;
      return shown.length === src.length && !missing.length && !unlinked.length && toggleOk ? pass(`All ${shown.length} ${m.name.toLowerCase()} records listed, matching the source`, ev) : fail(`Case list differs from source: ${shown.length} listed vs ${src.length} in source${missing.length ? `, ${missing.length} missing` : ''}`, ev);
    }
    case 'extremes': {
      const c = comp(ctx, check.componentId);
      if (!c?.dimension) return { status: 'Blocked', actual: 'Component missing.', evidence: '' };
      const mid = c.measureIds[0];
      const real = (k: string) => k !== '(Unmatched)' && k !== '(Blank)' && k !== '(n/a)';
      const pick = (entries: [string, number][]) => {
        const s = entries.filter(([k]) => real(k)).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
        return { hi: s[0], lo: s[s.length - 1] };
      };
      const dash = pick(E.group(mid, c.dimension, f).map((g) => [g.key, g.value]));
      const src = pick([...indGroup(ctx, mid, c.dimension, f, current)]);
      const same = (a?: [string, number], b?: [string, number]) => (!a && !b) || (!!a && !!b && Math.abs(a[1] - b[1]) < EPS);
      const ev = `${mname(ctx, mid)} by ${splitRef(c.dimension).column} (${fmtPeriod(current)}). Highest: dashboard ${dash.hi?.[0]} ${fmt(dash.hi?.[1])}, source ${src.hi?.[0]} ${fmt(src.hi?.[1])}. Lowest: dashboard ${dash.lo?.[0]} ${fmt(dash.lo?.[1])}, source ${src.lo?.[0]} ${fmt(src.lo?.[1])}.`;
      return same(dash.hi, src.hi) && same(dash.lo, src.lo) ? pass(`Highest (${dash.hi?.[0]}) and lowest (${dash.lo?.[0]}) match the source`, ev) : fail('Highest / lowest values differ from the source', ev);
    }
    case 'catalogue': {
      const m = ctx.measures.find((x) => x.id === check.measureId);
      if (!m?.catalogueRef) return { status: 'Blocked', actual: 'Measure is no longer linked to the KPI catalogue.', evidence: '' };
      const metric = KPI_CATALOGUE.find((x) => x.name === m.catalogueRef);
      // re-derive the catalogue definition from the data and compare with what the dashboard uses
      const fresh = bindCatalogue(ctx.u).measures;
      const ref = fresh.find((x) => x.catalogueRef === m.catalogueRef);
      const shape = (x: MeasureDef, all: MeasureDef[]): string =>
        x.kind === 'ratio' ? `ratio(${shape(all.find((y) => y.id === x.numeratorId)!, all)}/${shape(all.find((y) => y.id === x.denominatorId)!, all)})` : `${x.kind}(${x.datasetId}.${x.field ?? '*'})[${conditionsOf(x).map((cd) => `${cd.field}${cd.op}${cd.values.join('|')}`).join('&')}]`;
      if (!ref) return { status: 'Blocked', actual: 'The catalogue definition can no longer be derived from the data.', evidence: metric?.computation ?? '' };
      const same = shape(m, ctx.measures) === shape(ref, fresh) || (m.kind === 'count' && ref.kind === 'countDistinct' && shape({ ...m, kind: 'countDistinct' }, ctx.measures) === shape(ref, fresh));
      const k = E.kpi(m.id, f);
      const src = indValue(ctx, m.id, f, current);
      const ok = same && k.current != null && src != null && Math.abs(k.current - src) < EPS;
      const ev = `ProcDNA KPI Catalogue: ${metric ? `${metric.definition} Computation: ${metric.computation}` : m.catalogueRef}. Dashboard logic: ${m.logic}. Value ${fmt(k.current)} (source ${fmt(src)}).`;
      return ok ? pass(`${m.name} follows the catalogue definition and reconciles (${fmt(k.current)})`, ev) : fail(same ? `${m.name} does not reconcile: ${fmt(k.current)} vs source ${fmt(src)}` : `${m.name} no longer matches the catalogue definition`, ev);
    }
    case 'rls': {
      const rel = ctx.release;
      if (!rel?.securityField || !rel.users.length) return { status: 'Blocked', actual: 'No access roles configured yet — set them up in Release & Access.', evidence: '' };
      const field = rel.securityField;
      const mids = [...new Set(ctx.spec.pages.flatMap((p) => p.components.filter((c) => c.type === 'kpi').flatMap((c) => c.measureIds)))].filter((m) => E.applies(m, field));
      const problems: string[] = [];
      const lines: string[] = [];
      for (const usr of rel.users.filter((x) => x.values.length)) {
        const ff: FilterState = { ...f, selections: { [field]: usr.values } };
        for (const mid of mids) {
          const groups = E.group(mid, field, ff).filter((g) => g.value);
          const leak = groups.filter((g) => !usr.values.includes(g.key));
          if (leak.length) problems.push(`${usr.name} can see ${leak.map((g) => g.key).join(', ')} in ${mname(ctx, mid)}`);
          const d = E.value(mid, ff, current);
          const sv = indValue(ctx, mid, ff, current);
          if (!((d == null && sv == null) || (d != null && sv != null && Math.abs(d - sv) < EPS))) problems.push(`${usr.name}: ${mname(ctx, mid)} ${fmt(d)} vs source ${fmt(sv)}`);
        }
        lines.push(`${usr.name} → ${usr.values.join(', ')}`);
      }
      const ev = `${rel.users.length} user(s) checked on ${mids.length} measure(s) with security on ${splitRef(field).column}. ${lines.slice(0, 6).join('; ')}`;
      return problems.length ? fail(`${problems.length} access violation(s): ${problems[0]}`, `${ev}\n${problems.slice(0, 5).join('; ')}`) : pass('Every user sees only their authorised rows, and their numbers reconcile to source', ev);
    }
  }
}
