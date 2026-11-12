import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, LineChart, Line, AreaChart, Area, PieChart, Pie, Cell, Legend } from 'recharts';
import { ArrowDownRight, ArrowUpRight, Minus, Download, Search, ChevronDown, X, RotateCcw, ArrowUpDown, Layers, Maximize2, Info } from 'lucide-react';
import type { DashComponent, DashboardSpec, FieldRef, Foundation, PeriodPreset } from '@/types';
import { Engine, type FilterState, display } from '@/lib/engine';
import { PERIOD_LABELS, bucketLabel, bucketRange, fmtPeriod } from '@/lib/dates';
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

  // group consecutive KPI cards into rows
  const blocks: (DashComponent | DashComponent[])[] = [];
  const sectionStart = new Map<string, string>(); // first component id of each section → heading
  let prevSection: string | undefined;
  for (const c of page?.components ?? []) {
    const last = blocks[blocks.length - 1];
    const newSection = c.section && c.section !== prevSection;
    if (newSection) sectionStart.set(c.id, c.section!);
    prevSection = c.section ?? prevSection;
    if (c.type === 'kpi' && Array.isArray(last) && !newSection) last.push(c);
    else blocks.push(c.type === 'kpi' ? [c] : c);
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
                <div className="col-span-12 grid gap-3" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(170px, 1fr))` }}>
                  {b.map((c) => <KpiCard key={c.id} c={c} ctx={ctx} />)}
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
      <button onClick={() => setOpen(true)} className="group flex flex-col rounded-xl border border-slate-200 bg-white px-4 py-3 text-left transition hover:border-brand-300 hover:shadow-sm" data-testid="kpi" data-title={c.title} title="Click for trend drill-down">
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

function Visual({ c, ctx }: { c: DashComponent; ctx: Ctx }) {
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
  const dimLabel = fieldLabel(ctx.foundation, c.dimension!);
  const selected = ctx.f.selections[c.dimension!] ?? [];
  const head = (key: string, label: string, right = false) => (
    <th className={cx('th cursor-pointer select-none hover:text-slate-800', right && 'text-right')} onClick={() => setSort({ key, dir: sort.key === key ? (sort.dir === 1 ? -1 : 1) : -1 })}>
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
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, limit).map((r) => (
              <tr key={String(r.__key)} onClick={() => ctx.toggle(c.dimension!, String(r.__key))} className={cx('cursor-pointer hover:bg-brand-50/50', selected.includes(String(r.__key)) && 'bg-brand-50')}>
                <td className="td font-medium text-navy-900">{String(r.__key)}</td>
                {attrs.map((a) => <td key={a} className="td text-xs">{display(r[a] ?? null)}</td>)}
                {ms.map((m) => <td key={m.id} className="td text-right tabular-nums">{fmtMeasure(r[m.id] as number, m)}</td>)}
              </tr>
            ))}
          </tbody>
          <tfoot className="sticky bottom-0 bg-slate-50">
            <tr>
              <td className="td font-semibold">Total ({filtered.length} rows)</td>
              {attrs.map((a) => <td key={a} className="td" />)}
              {ms.map((m) => <td key={m.id} className="td text-right font-semibold tabular-nums">{totals[m.id] == null ? '' : fmtMeasure(totals[m.id], m)}</td>)}
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

