import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, LineChart, Line, AreaChart, Area, PieChart, Pie, Cell, Legend, ScatterChart, Scatter, LabelList } from 'recharts';
import { ArrowDownRight, ArrowUpRight, Minus, Download, Search, ChevronDown, X, RotateCcw, ArrowUpDown, Layers, Maximize2, Info, Flag, ChevronRight } from 'lucide-react';
import type { DashComponent, DashboardSpec, FieldRef, Foundation, PeriodPreset } from '@/types';
import { Engine, type FilterState, type WideRow, display, splitRef, BLANK, UNMATCHED } from '@/lib/engine';
import { PERIOD_LABELS, bucketLabel, bucketRange, fmtPeriod, parseDate } from '@/lib/dates';
import { CARD_TYPES, cardWeight } from '@/agents/designAgent';
import { cx, Modal } from '@/components/ui';
import { download, toCsv } from '@/lib/util';
import { PALETTE, fmtMeasure } from './format';
import BrandLogo from '@/components/BrandLogo';
import { fieldLabel } from '@/lib/fieldLabels';

interface Ctx {
  engine: Engine;
  f: FilterState;
  foundation: Foundation;
  spec: DashboardSpec;
  toggle: (field: FieldRef, value: string) => void;
  hierarchy: FieldRef[];
  drillTo: (field: FieldRef, value: string) => void;
}

export default function DashboardView({ spec, engine, foundation, fullscreen, header, locked }: { spec: DashboardSpec; engine: Engine; foundation: Foundation; fullscreen?: boolean; header?: ReactNode; locked?: { field: FieldRef; values: string[]; user: string } }) {
  const [pageId, setPageId] = useState(spec.pages[0]?.id);
  const [f, setF] = useState<FilterState>({ period: spec.defaultPeriod, selections: {} });
  const page = spec.pages.find((p) => p.id === pageId) ?? spec.pages[0];
  const { current, previous } = engine.resolve(f); // period does not depend on locked rows

  // geographic / categorical hierarchy for drill-down (from Dim_Geography if present)
  const hierarchy = useMemo(() => {
    const geo = foundation.tables.find((t) => t.name === 'Dim_Geography');
    return geo?.sourceDatasetId ? geo.fields.map((c) => `${geo.sourceDatasetId}::${c}`) : [];
  }, [foundation]);

  const toggle = (field: FieldRef, value: string) =>
    setF((s) => {
      const cur = s.selections[field] ?? [];
      const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
      return { ...s, selections: { ...s.selections, [field]: next } };
    });
  const drillTo = (field: FieldRef, value: string) => setF((s) => ({ ...s, selections: { ...s.selections, [field]: [value] } }));
  // row-level security: the viewer's rows are fixed and cannot be widened by filters
  const eff: FilterState = locked && locked.values.length ? { ...f, selections: { ...f.selections, [locked.field]: locked.values } } : f;
  const ctx: Ctx = { engine, f: eff, foundation, spec, toggle, hierarchy, drillTo };
  const active = Object.entries(f.selections).filter(([k, v]) => v.length && k !== locked?.field);

  // group consecutive cards (KPI, KPI group, highest/lowest) into rows
  const blocks: (DashComponent | DashComponent[])[] = [];
  const sectionStart = new Map<string, string>(); // first component id of each section → heading
  let prevSection: string | undefined;
  for (const c of page?.components ?? []) {
    const last = blocks[blocks.length - 1];
    const newSection = c.section && c.section !== prevSection;
    if (newSection) sectionStart.set(c.id, c.section!);
    prevSection = c.section ?? prevSection;
    const card = CARD_TYPES.includes(c.type);
    if (card && Array.isArray(last) && !newSection) last.push(c);
    else blocks.push(card ? [c] : c);
  }
  const heading = (c: DashComponent) => sectionStart.get(c.id);

  return (
    <div className={cx('flex flex-col', fullscreen ? 'min-h-screen bg-slate-100' : 'rounded-xl border border-slate-200 bg-slate-100')}>
      <div className={cx('sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur', !fullscreen && 'rounded-t-xl')}>
        {header}
        <div className="flex items-end justify-between gap-4 border-b border-slate-200 px-4 pt-2">
          <div className="-mb-px flex min-w-0 flex-wrap gap-1" role="tablist">
            {spec.pages.map((p) => (
              <button key={p.id} role="tab" aria-selected={p.id === page?.id} onClick={() => setPageId(p.id)} className={cx('whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium', p.id === page?.id ? 'border-brand-600 text-navy-900' : 'border-transparent text-slate-500 hover:text-slate-800')}>
                {p.name}
              </button>
            ))}
          </div>
          <BrandLogo className="mb-1 shrink-0" />
        </div>
        <div className="flex flex-wrap items-center gap-2 px-4 py-2.5" data-testid="filter-bar">
          <PeriodFilter value={f.period} custom={f.custom} onChange={(period, custom) => setF({ ...f, period, custom })} />
          {spec.filters.filter((x) => x.type === 'multi' && x.field).map((x) => (
            locked?.values.length && x.field === locked.field ? <span key={x.id} className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-500">{fieldLabel(foundation, x.field!)}: {locked.values.join(', ')}</span> : <MultiFilter key={x.id} label={fieldLabel(foundation, x.field!)} options={locked?.values.length ? engine.distinct(x.field!) : engine.distinct(x.field!)} value={f.selections[x.field!] ?? []} onChange={(v) => setF({ ...f, selections: { ...f.selections, [x.field!]: v } })} />
          ))}
          <button className="ml-auto flex items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-slate-100" onClick={() => setF({ period: spec.defaultPeriod, selections: {} })}>
            <RotateCcw className="h-3 w-3" /> Reset
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2 px-4 pb-2 text-[0.6875rem] text-slate-500">
          {locked?.values.length ? <span className="chip bg-navy-800 text-white" data-testid="rls-badge">Viewing as {locked.user} · {fieldLabel(foundation, locked.field)} = {locked.values.join(', ')}</span> : null}
          <span>Period: <b className="text-slate-700">{fmtPeriod(current)}</b>{previous && <> · compared with {fmtPeriod(previous)}</>}</span>
          {active.map(([field, vals]) => (
            <span key={field} className="chip bg-brand-50 text-brand-800" data-testid="active-filter">
              {fieldLabel(foundation, field)}: {vals.join(', ')}
              <button onClick={() => setF({ ...f, selections: { ...f.selections, [field]: [] } })} aria-label="Clear filter"><X className="h-3 w-3" /></button>
            </span>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-12 gap-3 p-4">
        {blocks.map((b, i) => {
          const first = Array.isArray(b) ? b[0] : b;
          const h = heading(first);
          return (
            <Fragment key={first.id + i}>
              {h && <h3 className="col-span-12 mt-2 flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.14em] text-navy-800 first:mt-0" data-testid="section-heading">{h}<span className="h-px flex-1 bg-slate-300/70" /></h3>}
              {Array.isArray(b) ? (
                <div className="col-span-12 flex flex-wrap gap-3">
                  {b.map((c) => (
                    <div key={c.id} className="flex min-w-0" style={{ flex: `${cardWeight(c)} 1 ${cardWeight(c) * 150 + 20}px` }}>
                      {c.type === 'kpiGroup' ? <KpiGroupCard c={c} ctx={ctx} /> : c.type === 'extremes' ? <ExtremesCard c={c} ctx={ctx} /> : <KpiCard c={c} ctx={ctx} />}
                    </div>
                  ))}
                </div>
              ) : (
                <div className={cx('col-span-12', b.width === 12 ? '' : b.width === 8 ? 'xl:col-span-8' : b.width === 4 ? 'lg:col-span-6 xl:col-span-4' : b.width === 3 ? 'md:col-span-6 xl:col-span-3' : 'lg:col-span-6')}>
                  <Visual c={b} ctx={ctx} />
                </div>
              )}
            </Fragment>
          );
        })}
        {!page?.components.length && <div className="col-span-12 rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">This page has no components.</div>}
      </div>
    </div>
  );
}

// ───────────────────────────── filters ─────────────────────────────
function PeriodFilter({ value, custom, onChange }: { value: PeriodPreset; custom?: { start?: string; end?: string }; onChange: (p: PeriodPreset, c?: { start?: string; end?: string }) => void }) {
  return (
    <div className="flex items-center gap-1.5">
      <label className="text-[0.6875rem] font-medium text-slate-500">Period</label>
      <select className="input w-auto py-1 text-xs" value={value} onChange={(e) => onChange(e.target.value as PeriodPreset, custom)} aria-label="Reporting period">
        {(Object.keys(PERIOD_LABELS) as PeriodPreset[]).map((k) => <option key={k} value={k}>{PERIOD_LABELS[k]}</option>)}
      </select>
      {value === 'custom' && (
        <>
          <input type="date" className="input w-auto py-1 text-xs" value={custom?.start ?? ''} onChange={(e) => onChange('custom', { ...custom, start: e.target.value })} aria-label="Start date" />
          <span className="text-xs text-slate-400">→</span>
          <input type="date" className="input w-auto py-1 text-xs" value={custom?.end ?? ''} onChange={(e) => onChange('custom', { ...custom, end: e.target.value })} aria-label="End date" />
        </>
      )}
    </div>
  );
}

function MultiFilter({ label, options, value, onChange }: { label: string; options: string[]; value: string[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} className={cx('flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs', value.length ? 'border-brand-300 bg-brand-50 text-brand-800' : 'border-slate-300 bg-white text-slate-700')} aria-label={`${label} filter`}>
        {label}{value.length ? `: ${value.length === 1 ? value[0] : `${value.length} selected`}` : ': All'}
        <ChevronDown className="h-3 w-3" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute left-0 z-40 mt-1 w-60 rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
            {options.length > 8 && <input className="input mb-1.5 py-1 text-xs" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />}
            <div className="max-h-60 overflow-y-auto">
              {options.filter((o) => o.toLowerCase().includes(q.toLowerCase())).map((o) => (
                <label key={o} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-slate-50">
                  <input type="checkbox" checked={value.includes(o)} onChange={() => onChange(value.includes(o) ? value.filter((x) => x !== o) : [...value, o])} />
                  {o}
                </label>
              ))}
            </div>
            <div className="mt-1 flex justify-between border-t border-slate-100 pt-1.5">
              <button className="text-[0.6875rem] text-slate-500 hover:underline" onClick={() => onChange([])}>Clear</button>
              <button className="text-[0.6875rem] font-medium text-brand-700 hover:underline" onClick={() => setOpen(false)}>Done</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ───────────────────────────── components ─────────────────────────────
function notAffected(c: DashComponent, ctx: Ctx) {
  const fields = Object.entries(ctx.f.selections).filter(([, v]) => v.length).map(([k]) => k);
  return fields.filter((fd) => c.measureIds.some((m) => !ctx.engine.applies(m, fd))).map((fd) => fieldLabel(ctx.foundation, fd));
}

function Frame({ c, ctx, children, actions, onExport }: { c: DashComponent; ctx: Ctx; children: ReactNode; actions?: ReactNode; onExport?: () => void }) {
  const na = notAffected(c, ctx);
  return (
    <div className="flex h-full flex-col rounded-xl border border-slate-200 bg-white" data-testid="visual" data-title={c.title}>
      <div className="flex items-start justify-between gap-2 px-4 pt-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-navy-900">{c.title}</div>
          {c.description && <div className="truncate text-[0.6875rem] text-slate-500">{c.description}</div>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {actions}
          {onExport && <button onClick={onExport} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Export data (CSV)" aria-label={`Export ${c.title}`}><Download className="h-3.5 w-3.5" /></button>}
        </div>
      </div>
      <div className="min-h-0 flex-1 px-2 pb-2 pt-1">{children}</div>
      {na.length > 0 && <div className="flex items-center gap-1 border-t border-slate-100 px-4 py-1 text-[0.625rem] text-slate-400"><Info className="h-3 w-3" />Not affected by {na.join(', ')} filter (no relationship)</div>}
    </div>
  );
}

function KpiCard({ c, ctx }: { c: DashComponent; ctx: Ctx }) {
  const [open, setOpen] = useState(false);
  const m = ctx.foundation.measures.find((x) => x.id === c.measureIds[0]);
  const k = ctx.engine.kpi(c.measureIds[0], ctx.f);
  const showCmp = c.comparison !== false && k.previousPeriod;
  const up = (k.delta ?? 0) > 0;
  const flat = k.delta == null || Math.abs(k.delta) < 0.05;
  const series = useMemo(() => (m && ctx.engine.profile(m.datasetId ?? '')?.dateField ? ctx.engine.series(m.id, ctx.spec.timeGrain, ctx.f) : m?.kind === 'ratio' ? ctx.engine.series(m.id, ctx.spec.timeGrain, ctx.f) : []), [m, ctx.engine, ctx.f, ctx.spec.timeGrain]);
  return (
    <>
      <button onClick={() => setOpen(true)} className="group flex w-full flex-col rounded-xl border border-slate-200 bg-white px-4 py-3 text-left transition hover:border-brand-300 hover:shadow-sm" data-testid="kpi" data-title={c.title} title="Click for trend drill-down">
        <div className="flex items-center justify-between text-[0.6875rem] font-medium uppercase tracking-wide text-slate-500">{c.title}<Maximize2 className="h-3 w-3 opacity-0 group-hover:opacity-100" /></div>
        <div className="mt-1 text-2xl font-semibold tabular-nums text-navy-900" data-testid="kpi-value">{fmtMeasure(k.current, m)}</div>
        {showCmp ? (
          <div className="mt-1 flex items-center gap-1 text-[0.6875rem]">
            <span className={cx('flex items-center font-medium', flat ? 'text-slate-500' : up ? 'text-emerald-600' : 'text-red-600')}>
              {flat ? <Minus className="h-3 w-3" /> : up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
              {k.delta == null ? 'n/a' : `${k.delta > 0 ? '+' : ''}${k.delta.toFixed(1)}${m?.format === 'percent' ? ' pts' : '%'}`}
            </span>
            <span className="text-slate-400">vs prev. {fmtMeasure(k.previous, m)}</span>
          </div>
        ) : <div className="mt-1 text-[0.6875rem] text-slate-400">{k.period ? 'Selected period' : 'All time'}</div>}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={`${c.title} — drill-down`} wide>
        <div className="mb-3 grid grid-cols-3 gap-3 text-sm">
          <div><div className="text-[0.6875rem] uppercase text-slate-500">Current</div><div className="text-xl font-semibold">{fmtMeasure(k.current, m)}</div><div className="text-[0.6875rem] text-slate-400">{fmtPeriod(k.period)}</div></div>
          <div><div className="text-[0.6875rem] uppercase text-slate-500">Previous</div><div className="text-xl font-semibold">{fmtMeasure(k.previous, m)}</div><div className="text-[0.6875rem] text-slate-400">{fmtPeriod(k.previousPeriod)}</div></div>
          <div><div className="text-[0.6875rem] uppercase text-slate-500">Logic</div><div className="font-mono text-[0.6875rem] text-slate-600">{m?.logic}</div></div>
        </div>
        {series.length > 0 ? (
          <div className="h-64">
            <ResponsiveContainer>
              <AreaChart data={series.map((s) => ({ name: bucketLabel(s.bucket, ctx.spec.timeGrain), value: s.value }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} width={48} />
                <Tooltip formatter={(v: number) => fmtMeasure(v, m)} />
                <Area isAnimationActive={false} dataKey="value" stroke={PALETTE[0]} fill={PALETTE[0]} fillOpacity={0.12} name={c.title} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : <div className="text-sm text-slate-500">This measure is not time-based (master data), so no trend is available.</div>}
      </Modal>
    </>
  );
}

const exportRows = (title: string, rows: Record<string, unknown>[]) => download(`${title.replace(/[^\w]+/g, '_')}.csv`, toCsv(rows), 'text/csv');

/** One card, several values: either a set of measures (Total / Open / Closed …) or one measure per category. */
function KpiGroupCard({ c, ctx }: { c: DashComponent; ctx: Ctx }) {
  const { current } = ctx.engine.resolve(ctx.f);
  const ms = c.measureIds.map((id) => ctx.foundation.measures.find((x) => x.id === id));
  const selected = c.dimension ? ctx.f.selections[c.dimension] ?? [] : [];
  const items = c.dimension
    ? ctx.engine.group(c.measureIds[0], c.dimension, ctx.f).filter((g) => g.key !== UNMATCHED).map((g) => ({ label: g.key, value: g.value as number | null, m: ms[0], key: g.key }))
    : c.measureIds.map((id, i) => ({ label: c.labels?.[i] ?? ms[i]?.name ?? '', value: ctx.engine.value(id, ctx.f, current), m: ms[i], key: undefined as string | undefined }));
  return (
    <div className="flex w-full flex-col rounded-xl border border-slate-200 bg-white px-4 py-3" data-testid="kpi-group" data-title={c.title} title={c.description}>
      <div className="text-[0.75rem] font-semibold text-navy-900">{c.title}</div>
      <div className="mt-2 grid flex-1 items-end divide-x divide-slate-200" style={{ gridTemplateColumns: `repeat(${Math.max(1, items.length)}, minmax(0, 1fr))` }}>
        {items.map((it) => {
          const body = (
            <>
              <div className="truncate text-[0.6875rem] text-slate-500" title={it.label}>{it.label}</div>
              <div className="text-xl font-semibold tabular-nums text-navy-900" data-testid="kpi-value" title={it.m?.logic}>{fmtMeasure(it.value, it.m)}</div>
            </>
          );
          return it.key != null ? (
            <button key={it.label} onClick={() => ctx.toggle(c.dimension!, it.key!)} className={cx('min-w-0 rounded px-2 text-center hover:bg-brand-50', selected.length && !selected.includes(it.key) && 'opacity-40')}>{body}</button>
          ) : <div key={it.label} className="min-w-0 px-2 text-center">{body}</div>;
        })}
        {!items.length && <div className="text-xs text-slate-400">No data</div>}
      </div>
    </div>
  );
}

/** Highest and lowest category for a measure (territory scorecard). */
function ExtremesCard({ c, ctx }: { c: DashComponent; ctx: Ctx }) {
  const m = ctx.foundation.measures.find((x) => x.id === c.measureIds[0]);
  const g = ctx.engine.group(c.measureIds[0], c.dimension!, ctx.f).filter((x) => x.key !== UNMATCHED && x.key !== BLANK).sort((a, b) => b.value - a.value || a.key.localeCompare(b.key));
  const hi = g[0];
  const lo = g[g.length - 1];
  const cell = (head: string, name?: string, value?: string) => (
    <div className="min-w-0 px-2 text-center first:pl-0">
      <div className="text-[0.6875rem] text-slate-500">{head}</div>
      <button className="mt-0.5 block w-full truncate text-xs font-semibold text-navy-900 hover:text-brand-700" title={name} onClick={() => name && ctx.toggle(c.dimension!, name)}>{name ?? '—'}</button>
      {value != null && <div className="text-base font-semibold tabular-nums text-navy-900">{value}</div>}
    </div>
  );
  let attr: string | undefined;
  if (c.topOnly && hi) attr = display(ctx.engine.table(c.dimension!, [c.measureIds[0]], [c.topOnly], ctx.f).find((r) => r.__key === hi.key)?.[c.topOnly] ?? null);
  return (
    <div className="flex w-full flex-col rounded-xl border border-slate-200 bg-white px-4 py-3" data-testid="extremes" data-title={c.title}>
      <div className="text-[0.75rem] font-semibold text-navy-900" title={m?.logic}>{c.title}</div>
      <div className="mt-2 grid flex-1 grid-cols-2 items-end divide-x divide-slate-200">
        {c.topOnly ? (
          <>
            {cell(fieldLabel(ctx.foundation, c.dimension!), hi?.key, hi ? fmtMeasure(hi.value, m) : undefined)}
            <div className="min-w-0 px-2 text-center"><div className="text-[0.6875rem] text-slate-500">{fieldLabel(ctx.foundation, c.topOnly)}</div><div className="mt-0.5 truncate text-xs font-semibold text-navy-900" title={attr}>{attr ?? '—'}</div></div>
          </>
        ) : (
          <>
            {cell(c.lowIsBest ? 'Fastest' : 'Highest', (c.lowIsBest ? lo : hi)?.key, fmtMeasure((c.lowIsBest ? lo : hi)?.value, m))}
            {cell(c.lowIsBest ? 'Slowest' : 'Lowest', (c.lowIsBest ? hi : lo)?.key, fmtMeasure((c.lowIsBest ? hi : lo)?.value, m))}
          </>
        )}
      </div>
    </div>
  );
}

function Visual({ c, ctx }: { c: DashComponent; ctx: Ctx }) {
  if (c.type === 'records') return <RecordsVisual c={c} ctx={ctx} />;
  if (c.type === 'scatter') return <ScatterVisual c={c} ctx={ctx} />;
  if (c.type === 'drilldown') return <DrilldownVisual c={c} ctx={ctx} />;
  if (c.type === 'kpiGroup') return <KpiGroupCard c={c} ctx={ctx} />;
  if (c.type === 'extremes') return <ExtremesCard c={c} ctx={ctx} />;
  if (c.type === 'table') return <TableVisual c={c} ctx={ctx} />;
  if (c.type === 'line' || c.type === 'area') return <LineVisual c={c} ctx={ctx} />;
  if (c.type === 'stacked') return <StackedVisual c={c} ctx={ctx} />;
  if (c.type === 'funnel') return <FunnelVisual c={c} ctx={ctx} />;
  return <CategoryVisual c={c} ctx={ctx} />;
}

function CategoryVisual({ c, ctx }: { c: DashComponent; ctx: Ctx }) {
  const [drill, setDrill] = useState(false);
  const m = ctx.foundation.measures.find((x) => x.id === c.measureIds[0]);
  const hIdx = c.dimension ? ctx.hierarchy.indexOf(c.dimension) : -1;
  // when drilling, show the next level of the hierarchy below the deepest selected level
  let dim = c.dimension!;
  if (drill && hIdx >= 0) {
    let lvl = hIdx;
    while (lvl < ctx.hierarchy.length - 1 && (ctx.f.selections[ctx.hierarchy[lvl]]?.length ?? 0) === 1) lvl++;
    dim = ctx.hierarchy[lvl];
  }
  const canDrill = hIdx >= 0 && hIdx < ctx.hierarchy.length - 1;
  const data = ctx.engine.group(c.measureIds[0], dim, ctx.f, { topN: c.topN, threshold: c.threshold });
  const selected = ctx.f.selections[dim] ?? [];
  const click = (key: string) => {
    const lvl = ctx.hierarchy.indexOf(dim);
    if (drill && lvl >= 0 && lvl < ctx.hierarchy.length - 1) ctx.drillTo(dim, key);
    else ctx.toggle(dim, key);
  };
  const fill = (k: string, i: number) => (selected.length && !selected.includes(k) ? '#cbd5e1' : c.type === 'donut' ? PALETTE[i % PALETTE.length] : PALETTE[0]);
  const rows = data.map((d) => ({ name: d.key, value: d.value }));
  const empty = !rows.length;
  return (
    <Frame
      c={c}
      ctx={ctx}
      onExport={() => exportRows(c.title, rows.map((r) => ({ [fieldLabel(ctx.foundation, dim)]: r.name, [m?.name ?? 'Value']: r.value })))}
      actions={canDrill && (
        <button onClick={() => setDrill(!drill)} className={cx('flex items-center gap-1 rounded px-1.5 py-0.5 text-[0.625rem]', drill ? 'bg-brand-600 text-white' : 'text-slate-500 hover:bg-slate-100')} title="Drill down through the hierarchy">
          <Layers className="h-3 w-3" />{drill ? `Drill: ${fieldLabel(ctx.foundation, dim)}` : 'Drill'}
        </button>
      )}
    >
      <div className={c.type === 'hbar' ? 'h-80' : 'h-64'}>
        {empty ? <NoData /> : (
          <ResponsiveContainer>
            {c.type === 'donut' ? (
              <PieChart>
                <Pie isAnimationActive={false} data={rows} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="85%" paddingAngle={1} onClick={(d) => click(String(d.name))} cursor="pointer">
                  {rows.map((r, i) => <Cell key={r.name} fill={fill(r.name, i)} />)}
                </Pie>
                <Tooltip formatter={(v: number) => fmtMeasure(v, m)} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            ) : c.type === 'hbar' ? (
              <BarChart data={rows} layout="vertical" margin={{ left: 10, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={130} />
                <Tooltip formatter={(v: number) => fmtMeasure(v, m)} cursor={{ fill: '#f1f5f9' }} />
                <Bar isAnimationActive={false} dataKey="value" name={m?.name} radius={[0, 4, 4, 0]} onClick={(d) => click(String(d.name))} cursor="pointer">
                  {rows.map((r, i) => <Cell key={r.name} fill={fill(r.name, i)} />)}
                </Bar>
              </BarChart>
            ) : (
              <BarChart data={rows} margin={{ top: 8, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={rows.length > 6 ? -25 : 0} textAnchor={rows.length > 6 ? 'end' : 'middle'} height={rows.length > 6 ? 54 : 24} />
                <YAxis tick={{ fontSize: 10 }} width={44} />
                <Tooltip formatter={(v: number) => fmtMeasure(v, m)} cursor={{ fill: '#f1f5f9' }} />
                <Bar isAnimationActive={false} dataKey="value" name={m?.name} radius={[4, 4, 0, 0]} onClick={(d) => click(String(d.name))} cursor="pointer">
                  {rows.map((r, i) => <Cell key={r.name} fill={fill(r.name, i)} />)}
                </Bar>
              </BarChart>
            )}
          </ResponsiveContainer>
        )}
      </div>
    </Frame>
  );
}

function StackedVisual({ c, ctx }: { c: DashComponent; ctx: Ctx }) {
  const m = ctx.foundation.measures.find((x) => x.id === c.measureIds[0]);
  const { rows, keys } = ctx.engine.group2(c.measureIds[0], c.dimension!, c.series!, ctx.f);
  return (
    <Frame c={c} ctx={ctx} onExport={() => exportRows(c.title, rows.map(({ __total, ...r }) => ({ ...r, Total: __total })))}>
      <div className="h-72">
        {!rows.length ? <NoData /> : (
          <ResponsiveContainer>
            <BarChart data={rows} margin={{ top: 8, right: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="key" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} width={44} />
              <Tooltip formatter={(v: number) => fmtMeasure(v, m)} cursor={{ fill: '#f1f5f9' }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {keys.map((k, i) => <Bar isAnimationActive={false} key={k} dataKey={k} stackId="a" fill={PALETTE[i % PALETTE.length]} onClick={(d: { key?: string }) => d.key && ctx.toggle(c.dimension!, String(d.key))} cursor="pointer" />)}
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </Frame>
  );
}

function LineVisual({ c, ctx }: { c: DashComponent; ctx: Ctx }) {
  const grain = c.timeGrain ?? ctx.spec.timeGrain;
  const ms = c.measureIds.map((id) => ctx.foundation.measures.find((x) => x.id === id)).filter(Boolean) as Foundation['measures'];
  const map = new Map<string, Record<string, number | string>>();
  for (const m of ms) for (const s of ctx.engine.series(m.id, grain, ctx.f)) {
    if (!map.has(s.bucket)) map.set(s.bucket, { bucket: s.bucket, name: bucketLabel(s.bucket, grain) });
    map.get(s.bucket)![m.name] = s.value;
  }
  const keys = [...map.keys()].sort();
  // zero-fill periods with no activity for additive measures so lines don't bridge gaps
  if (keys.length > 1)
    for (const b of bucketRange(keys[0], keys[keys.length - 1], grain)) {
      if (!map.has(b)) map.set(b, { bucket: b, name: bucketLabel(b, grain) });
      const row = map.get(b)!;
      for (const m of ms) if (row[m.name] == null && m.kind !== 'ratio') row[m.name] = 0;
    }
  const rows = [...map.values()].sort((a, b) => String(a.bucket).localeCompare(String(b.bucket)));
  const Chart = c.type === 'area' ? AreaChart : LineChart;
  return (
    <Frame c={c} ctx={ctx} onExport={() => exportRows(c.title, rows)} actions={<span className="rounded bg-slate-100 px-1.5 py-0.5 text-[0.625rem] text-slate-500">{grain}ly</span>}>
      <div className="h-64">
        {!rows.length ? <NoData /> : (
          <ResponsiveContainer>
            <Chart data={rows} margin={{ top: 8, right: 12 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} minTickGap={16} />
              <YAxis tick={{ fontSize: 10 }} width={44} />
              <Tooltip formatter={(v: number, n: string) => fmtMeasure(v, ms.find((m) => m.name === n))} />
              {ms.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
              {ms.map((m, i) => c.type === 'area' ? <Area isAnimationActive={false} key={m.id} dataKey={m.name} stroke={PALETTE[i]} fill={PALETTE[i]} fillOpacity={0.12} strokeWidth={2} /> : <Line isAnimationActive={false} key={m.id} dataKey={m.name} stroke={PALETTE[i]} strokeWidth={2} dot={rows.length < 20} connectNulls />)}
            </Chart>
          </ResponsiveContainer>
        )}
      </div>
    </Frame>
  );
}

function TableVisual({ c, ctx }: { c: DashComponent; ctx: Ctx }) {
  const [q, setQ] = useState('');
  const daysAttr = (c.tableColumns ?? []).find((a) => /days/i.test(a));
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: daysAttr ?? c.measureIds[0], dir: -1 });
  const [limit, setLimit] = useState(15);
  const ms = c.measureIds.map((id) => ctx.foundation.measures.find((x) => x.id === id)).filter(Boolean) as Foundation['measures'];
  const attrs = c.tableColumns ?? [];
  const rows = ctx.engine.table(c.dimension!, c.measureIds, attrs, ctx.f).filter((r) => !c.threshold || (c.threshold.op === 'gt' ? Number(r[c.measureIds[0]]) > c.threshold.value : Number(r[c.measureIds[0]]) >= c.threshold.value));
  const filtered = rows
    .filter((r) => !q || [r.__key, ...attrs.map((a) => r[a])].some((v) => String(v ?? '').toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => {
      const x = a[sort.key];
      const y = b[sort.key];
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''))) * sort.dir;
    });
  const totals = Object.fromEntries(ms.map((m) => [m.id, m.kind === 'count' || m.kind === 'sum' ? filtered.reduce((s, r) => s + ((r[m.id] as number) ?? 0), 0) : null]));
  // priority flags: explicit thresholds, or the top 10% (two flags) and next 25% (one flag) of the rows in view
  const ranked = rows.map((r) => Number(r[c.measureIds[0]] ?? 0)).filter((x) => x > 0).sort((a, b) => b - a);
  const at = (q: number) => ranked[Math.min(ranked.length - 1, Math.floor(ranked.length * q))] ?? Infinity;
  const flagAt = { high: c.flags?.high ?? Math.max(2, at(0.1)), medium: c.flags?.medium ?? Math.max(1, at(0.35)) };
  const dimLabel = fieldLabel(ctx.foundation, c.dimension!);
  const selected = ctx.f.selections[c.dimension!] ?? [];
  const head = (key: string, label: string, right = false) => (
    <th key={key} className={cx('th cursor-pointer select-none hover:text-slate-800', right && 'text-right')} onClick={() => setSort({ key, dir: sort.key === key ? (sort.dir === 1 ? -1 : 1) : -1 })}>
      <span className="inline-flex items-center gap-1">{label}<ArrowUpDown className={cx('h-3 w-3', sort.key === key ? 'text-brand-600' : 'text-slate-300')} /></span>
    </th>
  );
  return (
    <Frame
      c={c}
      ctx={ctx}
      onExport={() => exportRows(c.title, filtered.map((r) => ({ [dimLabel]: r.__key, ...Object.fromEntries(attrs.map((a) => [fieldLabel(ctx.foundation, a), r[a]])), ...Object.fromEntries(ms.map((m) => [m.name, r[m.id]])) })))}
      actions={
        <div className="relative">
          <Search className="absolute left-2 top-1.5 h-3.5 w-3.5 text-slate-400" />
          <input className="input w-48 py-1 pl-7 text-xs" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} aria-label={`Search ${c.title}`} />
        </div>
      }
    >
      <div className="max-h-[26.25rem] overflow-auto">
        <table className="w-full" data-testid="data-table">
          <thead className="sticky top-0 z-10">
            <tr>
              {head('__key', dimLabel)}
              {attrs.map((a) => head(a, fieldLabel(ctx.foundation, a)))}
              {ms.map((m) => head(m.id, m.name, true))}
              {c.flags && <th className="th text-center">Priority Flag</th>}
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, limit).map((r) => {
              const v = Number(r[c.measureIds[0]] ?? 0);
              const flags = c.flags && v > 0 ? (v >= flagAt.high ? 2 : v >= flagAt.medium ? 1 : 0) : 0;
              return (
                <tr key={String(r.__key)} onClick={() => ctx.toggle(c.dimension!, String(r.__key))} className={cx('cursor-pointer hover:bg-brand-50/50', selected.includes(String(r.__key)) && 'bg-brand-50')}>
                  <td className="td font-medium text-navy-900">{String(r.__key)}</td>
                  {attrs.map((a) => <td key={a} className="td text-xs">{display(r[a] ?? null)}</td>)}
                  {ms.map((m) => <td key={m.id} className="td text-right tabular-nums">{fmtMeasure(r[m.id] as number, m)}</td>)}
                  {c.flags && <td className="td text-center" aria-label={`${flags} priority flag(s)`}>{Array.from({ length: flags }, (_, i) => <Flag key={i} className="inline h-3.5 w-3.5 fill-amber-400 text-amber-500" />)}</td>}
                </tr>
              );
            })}
          </tbody>
          <tfoot className="sticky bottom-0 bg-slate-50">
            <tr>
              <td className="td font-semibold">Total ({filtered.length} rows)</td>
              {attrs.map((a) => <td key={a} className="td" />)}
              {ms.map((m) => <td key={m.id} className="td text-right font-semibold tabular-nums">{totals[m.id] == null ? '' : fmtMeasure(totals[m.id], m)}</td>)}
              {c.flags && <td className="td" />}
            </tr>
          </tfoot>
        </table>
        {filtered.length > limit && <button className="w-full py-2 text-xs font-medium text-brand-700 hover:bg-slate-50" onClick={() => setLimit(limit + 25)}>Show more ({filtered.length - limit} remaining)</button>}
      </div>
    </Frame>
  );
}

function FunnelVisual({ c, ctx }: { c: DashComponent; ctx: Ctx }) {
  const { current } = ctx.engine.resolve(ctx.f);
  const stages = c.measureIds.map((id) => ({ m: ctx.foundation.measures.find((x) => x.id === id), v: ctx.engine.value(id, ctx.f, current) ?? 0 }));
  const top = Math.max(1, ...stages.map((s) => s.v));
  const first = stages[0]?.v || 1;
  return (
    <Frame c={c} ctx={ctx} onExport={() => exportRows(c.title, stages.map((s) => ({ Stage: s.m?.name, Value: s.v, 'Share of first stage %': Math.round((s.v / first) * 1000) / 10 })))}>
      <div className="space-y-2 px-2 py-2" data-testid="funnel">
        {stages.map((s, i) => (
          <div key={s.m?.id ?? i} className="grid grid-cols-[minmax(8.75rem,13.75rem)_1fr_auto] items-center gap-3">
            <div className="truncate text-xs font-medium text-slate-700" title={s.m?.logic}>{s.m?.name ?? '—'}</div>
            <div className="h-8 rounded-md bg-slate-100">
              <div className="flex h-full items-center rounded-md px-2 text-[0.6875rem] font-semibold text-white" style={{ width: `${Math.max(4, (s.v / top) * 100)}%`, background: PALETTE[i % PALETTE.length] }}>
                {fmtMeasure(s.v, s.m)}
              </div>
            </div>
            <div className="w-14 text-right text-[0.6875rem] tabular-nums text-slate-500">{i === 0 ? '100%' : `${((s.v / first) * 100).toFixed(1)}%`}</div>
          </div>
        ))}
      </div>
    </Frame>
  );
}

function NoData() {
  return <div className="flex h-full items-center justify-center text-xs text-slate-400">No data for the current filters</div>;
}

/** Record-level cell: empty values read as a dash in a case list, not as a "(Blank)" category. */
const cellText = (v: WideRow['v'][string] | undefined) => (v == null || v === '' ? '—' : display(v));

/** Row-level list of the records behind a measure (e.g. every open case), with an optional narrowing toggle and a detail view. */
function RecordsVisual({ c, ctx }: { c: DashComponent; ctx: Ctx }) {
  const cols = c.tableColumns ?? [];
  const [narrow, setNarrow] = useState(false);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<{ key: FieldRef; dir: 1 | -1 }>({ key: c.sortBy ?? cols[0], dir: -1 });
  const [limit, setLimit] = useState(15);
  const [open, setOpen] = useState<WideRow | null>(null);
  const all = ctx.engine.records(c.measureIds[0], ctx.f);
  const toggled = c.toggle ? ctx.engine.records(c.measureIds[0], ctx.f, c.toggle.filter) : [];
  const rows = (narrow && c.toggle ? toggled : all)
    .filter((w) => !q || cols.some((k) => String(w.v[k] ?? '').toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => {
      const x = a.v[sort.key];
      const y = b.v[sort.key];
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''))) * sort.dir;
    });
  const label = (k: FieldRef) => fieldLabel(ctx.foundation, k);
  return (
    <Frame
      c={c}
      ctx={ctx}
      onExport={() => exportRows(c.title, rows.map((w) => Object.fromEntries(cols.map((k) => [label(k), w.v[k]]))))}
      actions={
        <div className="flex items-center gap-2">
          {c.toggle && (
            <div className="flex items-center rounded-lg border border-slate-200 p-0.5 text-[0.6875rem]" role="group" aria-label="Case list view">
              <button className={cx('rounded-md px-2 py-0.5', !narrow ? 'bg-navy-800 text-white' : 'text-slate-600')} onClick={() => setNarrow(false)}>All ({all.length})</button>
              <button className={cx('rounded-md px-2 py-0.5', narrow ? 'bg-navy-800 text-white' : 'text-slate-600')} onClick={() => setNarrow(true)} data-testid="records-toggle">{c.toggle.label} ({toggled.length})</button>
            </div>
          )}
          <div className="relative">
            <Search className="absolute left-2 top-1.5 h-3.5 w-3.5 text-slate-400" />
            <input className="input w-44 py-1 pl-7 text-xs" placeholder="Search cases…" value={q} onChange={(e) => setQ(e.target.value)} aria-label={`Search ${c.title}`} />
          </div>
        </div>
      }
    >
      <div className="max-h-[26.25rem] overflow-auto">
        <table className="w-full" data-testid="records-table">
          <thead className="sticky top-0 z-10">
            <tr>
              {cols.map((k) => (
                <th key={k} className="th cursor-pointer select-none whitespace-nowrap hover:text-slate-800" onClick={() => setSort({ key: k, dir: sort.key === k ? (sort.dir === 1 ? -1 : 1) : -1 })}>
                  <span className="inline-flex items-center gap-1">{label(k)}<ArrowUpDown className={cx('h-3 w-3', sort.key === k ? 'text-brand-600' : 'text-slate-300')} /></span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map((w, i) => (
              <tr key={String(w.v[cols[0]]) + i} onClick={() => setOpen(w)} className="cursor-pointer hover:bg-brand-50/50" title="Open case detail">
                {cols.map((k, j) => <td key={k} className={cx('td text-xs', j === 0 && 'font-medium text-navy-900', /details?|issue/i.test(k) && 'min-w-[14rem]')}>{cellText(w.v[k])}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <div className="py-8"><NoData /></div>}
        {rows.length > limit && <button className="w-full py-2 text-xs font-medium text-brand-700 hover:bg-slate-50" onClick={() => setLimit(limit + 25)}>Show more ({rows.length - limit} remaining)</button>}
      </div>
      {open && <RecordDetail w={open} cols={cols} ctx={ctx} onClose={() => setOpen(null)} />}
    </Frame>
  );
}

/** Case detail: the record's attributes and the patient journey as a dated timeline (every date reachable from the record). */
function RecordDetail({ w, cols, ctx, onClose }: { w: WideRow; cols: FieldRef[]; ctx: Ctx; onClose: () => void }) {
  const label = (k: FieldRef) => fieldLabel(ctx.foundation, k);
  const dsLabel = (k: FieldRef) => ctx.engine.profile(splitRef(k).datasetId)?.label ?? '';
  const events = ctx.engine.profiles
    .flatMap((p) => p.columns.filter((col) => col.type === 'date').map((col) => `${p.datasetId}::${col.name}`))
    .map((k) => ({ k, t: parseDate(w.v[k] as string)?.t, v: w.v[k] }))
    .filter((e): e is { k: FieldRef; t: number; v: string } => e.t != null)
    .sort((a, b) => a.t - b.t);
  const stuck = Object.keys(w.v).find((k) => /::current_?stage$/i.test(k));
  const daysIn = Object.keys(w.v).find((k) => /::days_in_current_stage$/i.test(k));
  return (
    <Modal open onClose={onClose} title={`${label(cols[0])} ${display(w.v[cols[0]] ?? null)}`} wide>
      {stuck && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <b>Where the patient is now:</b> {display(w.v[stuck] ?? null)}
          {daysIn && w.v[daysIn] != null && <span className="text-amber-700">· {String(w.v[daysIn])} days in this stage</span>}
        </div>
      )}
      <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <div className="mb-2 text-[0.6875rem] font-semibold uppercase tracking-wide text-slate-500">Journey timeline</div>
          <ol className="relative space-y-3 border-l-2 border-brand-100 pl-4" data-testid="journey-timeline">
            {events.map((e) => (
              <li key={e.k} className="relative">
                <span className="absolute -left-[1.3rem] top-1 h-2.5 w-2.5 rounded-full bg-brand-500" />
                <div className="text-xs font-medium text-navy-900">{label(e.k)}</div>
                <div className="text-[0.6875rem] text-slate-500">{String(e.v)} · {dsLabel(e.k)}</div>
              </li>
            ))}
            {!events.length && <li className="text-xs text-slate-400">No dated events.</li>}
          </ol>
        </div>
        <div>
          <div className="mb-2 text-[0.6875rem] font-semibold uppercase tracking-wide text-slate-500">Case details</div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
            {cols.map((k) => (
              <Fragment key={k}>
                <dt className="text-slate-500">{label(k)}</dt>
                <dd className="font-medium text-slate-800">{cellText(w.v[k])}</dd>
              </Fragment>
            ))}
          </dl>
        </div>
      </div>
    </Modal>
  );
}

/** Two measures per category, e.g. FRM response time (x) against case volume (y) by territory. */
function ScatterVisual({ c, ctx }: { c: DashComponent; ctx: Ctx }) {
  const [mx, my] = c.measureIds.map((id) => ctx.foundation.measures.find((x) => x.id === id));
  const ys = new Map(ctx.engine.group(c.measureIds[1], c.dimension!, ctx.f).map((g) => [g.key, g.value]));
  const pts = ctx.engine.group(c.measureIds[0], c.dimension!, ctx.f).filter((g) => ys.has(g.key) && g.key !== UNMATCHED).map((g) => ({ name: g.key, x: g.value, y: ys.get(g.key)! }));
  const selected = ctx.f.selections[c.dimension!] ?? [];
  return (
    <Frame c={c} ctx={ctx} onExport={() => exportRows(c.title, pts.map((p) => ({ [fieldLabel(ctx.foundation, c.dimension!)]: p.name, [mx?.name ?? 'x']: p.x, [my?.name ?? 'y']: p.y })))}>
      <div className="h-72">
        {!pts.length ? <NoData /> : (
          <ResponsiveContainer>
            <ScatterChart margin={{ top: 12, right: 24, bottom: 18, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis type="number" dataKey="x" name={mx?.name} tick={{ fontSize: 10 }} label={{ value: mx?.name, position: 'insideBottom', offset: -10, fontSize: 10 }} domain={['auto', 'auto']} />
              <YAxis type="number" dataKey="y" name={my?.name} tick={{ fontSize: 10 }} width={44} domain={['auto', 'auto']} />
              <Tooltip cursor={{ strokeDasharray: '3 3' }} formatter={(v: number, n: string) => fmtMeasure(v, n === mx?.name ? mx : my)} labelFormatter={() => ''} />
              <Scatter isAnimationActive={false} data={pts} onClick={(d: { name?: string }) => d.name && ctx.toggle(c.dimension!, d.name)} cursor="pointer">
                {pts.map((p) => <Cell key={p.name} fill={selected.length && !selected.includes(p.name) ? '#cbd5e1' : PALETTE[0]} />)}
                <LabelList dataKey="name" position="top" style={{ fontSize: 9, fill: '#475569' }} />
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        )}
      </div>
    </Frame>
  );
}

/** Decomposition tree: one column per level; clicking a bar opens the next level for that node. */
function DrilldownVisual({ c, ctx }: { c: DashComponent; ctx: Ctx }) {
  const levels = c.levels ?? (c.dimension ? [c.dimension] : []);
  const [path, setPath] = useState<string[]>([]);
  const m = ctx.foundation.measures.find((x) => x.id === c.measureIds[0]);
  const { current } = ctx.engine.resolve(ctx.f);
  const total = ctx.engine.value(c.measureIds[0], ctx.f, current);
  const columns = levels.slice(0, path.length + 1).map((lvl, i) => {
    const sel = Object.fromEntries(path.slice(0, i).map((v, j) => [levels[j], [v]]));
    const f: FilterState = { ...ctx.f, selections: { ...ctx.f.selections, ...sel } };
    return { lvl, rows: ctx.engine.group(c.measureIds[0], lvl, f).filter((g) => g.value) };
  });
  const click = (i: number, key: string) => setPath(path[i] === key ? path.slice(0, i) : [...path.slice(0, i), key]);
  return (
    <Frame c={c} ctx={ctx} actions={path.length ? <button className="rounded px-1.5 py-0.5 text-[0.625rem] text-slate-500 hover:bg-slate-100" onClick={() => setPath([])}>Collapse</button> : undefined}>
      <div className="flex gap-2 overflow-x-auto px-2 pb-2 pt-1" data-testid="drilldown">
        <div className="w-40 shrink-0">
          <div className="mb-1.5 truncate text-[0.6875rem] font-semibold text-slate-500">{m?.name}</div>
          <div className="rounded-md bg-navy-800 px-2 py-2 text-white"><div className="text-[0.6875rem] opacity-80">Total</div><div className="text-lg font-semibold tabular-nums">{fmtMeasure(total, m)}</div></div>
        </div>
        {columns.map(({ lvl, rows }, i) => {
          const top = Math.max(1, ...rows.map((r) => r.value));
          return (
            <div key={lvl} className="flex w-52 shrink-0 gap-1">
              <ChevronRight className="mt-6 h-4 w-4 shrink-0 text-slate-300" />
              <div className="min-w-0 flex-1">
                <div className="mb-1.5 truncate text-[0.6875rem] font-semibold text-slate-500">{fieldLabel(ctx.foundation, lvl)}{path[i - 1] ? <span className="font-normal"> · {path[i - 1]}</span> : null}</div>
                <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
                  {rows.map((r) => (
                    <button key={r.key} onClick={() => i < levels.length - 1 && click(i, r.key)} className={cx('block w-full rounded px-1 py-0.5 text-left', i < levels.length - 1 ? 'hover:bg-slate-50' : 'cursor-default', path[i] === r.key && 'bg-brand-50 ring-1 ring-brand-200')} data-testid="drill-node">
                      <div className="flex justify-between gap-2 text-[0.6875rem]"><span className="truncate text-slate-700">{r.key}</span><span className="tabular-nums text-slate-500">{fmtMeasure(r.value, m)}</span></div>
                      <div className="mt-0.5 h-2 rounded-sm bg-slate-100"><div className="h-full rounded-sm" style={{ width: `${(r.value / top) * 100}%`, background: path[i] === r.key ? PALETTE[0] : '#93b4fd' }} /></div>
                    </button>
                  ))}
                  {!rows.length && <div className="text-[0.6875rem] text-slate-400">No data</div>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {path.length < levels.length - 1 && <div className="px-4 pb-1 text-[0.625rem] text-slate-400">Click a bar to open {fieldLabel(ctx.foundation, levels[path.length + 1])}.</div>}
    </Frame>
  );
}

