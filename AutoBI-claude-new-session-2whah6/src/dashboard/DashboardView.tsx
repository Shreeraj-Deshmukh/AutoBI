import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, LineChart, Line, AreaChart, Area, PieChart, Pie, Cell, ScatterChart, Scatter, LabelList } from 'recharts';
import { ChevronDown, X, RotateCcw } from 'lucide-react';
import type { DashComponent, DashboardSpec, FieldRef, Foundation, MeasureDef, PeriodPreset, TimeGrain } from '@/types';
import { Engine, type AxisLevel, type FilterState, type WideRow, axisOf, display, isMatrix, BLANK, UNMATCHED, VALUE } from '@/lib/engine';
import { PERIOD_LABELS, bucketRange, toIsoDate } from '@/lib/dates';
import { cx } from '@/components/ui';
import { download, toCsv } from '@/lib/util';
import { CLIENT_THEME as C, PALETTE, REPORT as R, fmtMeasure, pt } from './format';
import { fieldLabel } from '@/lib/fieldLabels';
import { followGeo, geoName } from '@/lib/geoLevel';
import { activePeriod } from '@/lib/periodFilter';
import { hasToggle, layoutPage, type LayoutItem } from '@/lib/powerbi/layout';
import { Banner, FilterBand, Logo, PageTitle, ReportCanvas, SELECT, SectionHeading, SlicerBox, Tabs, VisualBox, pos } from './reportFrame';

/**
 * The dashboard as the Power BI report shows it: every page is laid out with the export's own layout
 * (src/lib/powerbi/layout.ts) and drawn in the report's look (REPORT in ./format), so the web preview and the
 * downloaded Power BI file show the same visuals, in the same places, with the same values. Only what Power BI
 * itself offers is interactive: slicers, page tabs, click-to-filter, column sort and "Export data".
 */

interface Ctx {
  engine: Engine;
  f: FilterState;
  foundation: Foundation;
  spec: DashboardSpec;
  toggle: (field: FieldRef, value: string) => void;
  /** values chosen in each case list's narrowing slicer (component id → values) */
  narrow: Record<string, string[]>;
}

export default function DashboardView({ spec, engine, foundation, fullscreen, header, locked }: { spec: DashboardSpec; engine: Engine; foundation: Foundation; fullscreen?: boolean; header?: ReactNode; locked?: { field: FieldRef; values: string[]; user: string } }) {
  const [pageId, setPageId] = useState(spec.pages[0]?.id);
  // without a Time Period filter the dashboard shows all time; adding the filter switches to its default period
  const opening = activePeriod(spec);
  const [f, setF] = useState<FilterState>({ period: opening, selections: {} });
  useEffect(() => setF((s) => (s.period === opening ? s : { ...s, period: opening, custom: undefined })), [opening]);
  const [geo, setGeo] = useState<FieldRef | undefined>(spec.geoLevels?.default);
  const [narrow, setNarrow] = useState<Record<string, string[]>>({});
  const page0 = spec.pages.find((p) => p.id === pageId) ?? spec.pages[0];
  const geoHere = !!(spec.geoLevels && page0 && spec.geoLevels.pages.includes(page0.id));
  const page = useMemo(() => (page0 && geoHere && geo ? { ...page0, components: page0.components.map((c) => followGeo(c, spec, geo, foundation)) } : page0), [page0, geoHere, geo, spec, foundation]);
  const { current } = engine.resolve(f);

  const toggle = (field: FieldRef, value: string) =>
    setF((s) => {
      const cur = s.selections[field] ?? [];
      const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
      return { ...s, selections: { ...s.selections, [field]: next } };
    });
  // row-level security: the viewer's rows are fixed and cannot be widened by filters
  const eff: FilterState = locked && locked.values.length ? { ...f, selections: { ...f.selections, [locked.field]: locked.values } } : f;
  const ctx: Ctx = { engine, f: eff, foundation, spec, toggle, narrow };
  const active = Object.entries(f.selections).filter(([k, v]) => v.length && k !== locked?.field);

  // the same layout as the Power BI export
  const filters = useMemo(() => spec.filters.filter((x) => x.type === 'multi' && x.field), [spec.filters]);
  const hasDates = useMemo(() => engine.profiles.some((p) => p.kind === 'activity' && !!p.dateField), [engine]);
  const layout = useMemo(() => (page ? layoutPage(spec, page, { geo: geoHere, hasDates, filters, hasToggle }) : null), [spec, page, geoHere, hasDates, filters]);

  const render = (it: LayoutItem): ReactNode => {
    switch (it.kind) {
      case 'banner':
        return <Banner />;
      case 'logo':
        return <Logo />;
      case 'tabs':
        return <Tabs pages={spec.pages} activeId={page?.id} onSelect={setPageId} />;
      case 'title':
        return <PageTitle page={page} />;
      case 'band':
        return <FilterBand />;
      case 'section':
        return <SectionHeading text={it.text} />;
      case 'slicer': {
        const s = it.slot;
        if (s.kind === 'geo' && spec.geoLevels)
          return (
            <SlicerBox label="Geo Level">
              <select className={SELECT} value={geo} onChange={(e) => setGeo(e.target.value)} aria-label="Geo level" data-testid="geo-level">
                {spec.geoLevels.fields.map((g) => <option key={g} value={g}>{geoName(foundation, g)}</option>)}
              </select>
            </SlicerBox>
          );
        if (s.kind === 'period')
          return (
            <SlicerBox label="Time Period">
              {/* switching to Custom starts from the dates currently shown */}
              <select className={SELECT} value={f.period} onChange={(e) => { const p = e.target.value as PeriodPreset; setF({ ...f, period: p, custom: p === 'custom' ? f.custom ?? shownRange(current, engine) : f.custom }); }} aria-label="Reporting period">
                {(Object.keys(PERIOD_LABELS) as PeriodPreset[]).map((k) => <option key={k} value={k}>{PERIOD_LABELS[k]}</option>)}
              </select>
            </SlicerBox>
          );
        if (s.kind === 'date') {
          const off = f.period !== 'custom';
          const range = shownRange(current, engine);
          const start = off ? range.start : f.custom?.start ?? '';
          const end = off ? range.end : f.custom?.end ?? '';
          return (
            <SlicerBox label="Custom Date">
              <div className="flex gap-1.5" title={off ? 'Dates of the selected time period; choose "Custom range" to edit them' : undefined}>
                <input type="date" disabled={off} className={cx(SELECT, 'min-w-0 disabled:bg-white disabled:text-neutral-600')} value={start} onChange={(e) => setF({ ...f, period: 'custom', custom: { ...f.custom, start: e.target.value } })} aria-label="Start date" />
                <input type="date" disabled={off} className={cx(SELECT, 'min-w-0 disabled:bg-white disabled:text-neutral-600')} value={end} onChange={(e) => setF({ ...f, period: 'custom', custom: { ...f.custom, end: e.target.value } })} aria-label="End date" />
              </div>
            </SlicerBox>
          );
        }
        if (s.kind === 'filter') {
          const x = s.filter;
          const label = x.label || fieldLabel(foundation, x.field!);
          return (
            <SlicerBox label={label}>
              {locked?.values.length && x.field === locked.field ? <div className={cx(SELECT, 'truncate text-neutral-500')}>{locked.values.join(', ')}</div> : <MultiFilter label={label} options={engine.distinct(x.field!)} value={f.selections[x.field!] ?? []} onChange={(v) => setF({ ...f, selections: { ...f.selections, [x.field!]: v } })} />}
            </SlicerBox>
          );
        }
        return null;
      }
      case 'toggle': {
        // the case list's narrowing slicer: filters only the list below it
        const c = it.component;
        const tf = c.toggle!.filter[0];
        const ds = engine.measures.get(c.measureIds[0])?.datasetId;
        const label = c.toggle!.label.replace(/ only$/i, '');
        return (
          <SlicerBox label={label}>
            <MultiFilter label={label} options={ds ? engine.distinct(`${ds}::${tf.field}`) : []} value={narrow[c.id] ?? []} onChange={(v) => setNarrow({ ...narrow, [c.id]: v })} testId="records-toggle" />
          </SlicerBox>
        );
      }
      case 'component':
        return <Visual c={it.component} ctx={ctx} />;
    }
  };

  return (
    <div className={cx('flex flex-col', fullscreen ? 'min-h-screen' : 'overflow-hidden rounded-xl border border-slate-200')} style={{ background: C.page }}>
      {header && <div className="sticky top-0 z-20">{header}</div>}
      {/* viewer tools around the report (as in the Power BI service): row-level security view, filters in effect, reset */}
      <div className="flex min-h-[2.25rem] flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-1.5 text-[0.6875rem] text-slate-500">
        {locked?.values.length ? <span className="chip bg-navy-800 text-white" data-testid="rls-badge">Viewing as {locked.user} · {fieldLabel(foundation, locked.field)} = {locked.values.join(', ')}</span> : null}
        {active.map(([field, vals]) => (
          <span key={field} className="chip bg-brand-50 text-brand-800" data-testid="active-filter">
            {fieldLabel(foundation, field)}: {vals.join(', ')}
            <button onClick={() => setF({ ...f, selections: { ...f.selections, [field]: [] } })} aria-label="Clear filter"><X className="h-3 w-3" /></button>
          </span>
        ))}
        <button className="ml-auto flex items-center gap-1 rounded px-2 py-1 font-medium text-brand-700 hover:bg-brand-50" onClick={() => { setF({ period: opening, selections: {} }); setNarrow({}); setGeo(spec.geoLevels?.default); }} aria-label="Reset" title="Reset to default">
          <RotateCcw className="h-3.5 w-3.5" />Reset to default
        </button>
      </div>
      {layout && (
        <ReportCanvas height={layout.height} data-testid="report-page">
          {layout.items.map((it, i) => (
            <div key={`${it.kind}-${'component' in it ? it.component.id : i}`} className="absolute" style={pos(it.box)}>
              {render(it)}
            </div>
          ))}
          {!page?.components.length && <div className="absolute inset-x-4 rounded-[10px] border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500" style={{ top: 160 }}>This page has no components.</div>}
        </ReportCanvas>
      )}
    </div>
  );
}

const shownRange = (current: { start: number; end: number } | null, engine: Engine) => {
  const r = current ?? { start: engine.minDate, end: engine.anchor };
  return { start: toIsoDate(r.start), end: toIsoDate(r.end) };
};

function MultiFilter({ label, options, value, onChange, testId }: { label: string; options: string[]; value: string[]; onChange: (v: string[]) => void; testId?: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} className={cx(SELECT, 'flex items-center justify-between gap-1 text-left')} aria-label={`${label} filter`} data-testid={testId}>
        <span className="truncate">{value.length ? (value.length === 1 ? value[0] : 'Multiple selections') : 'All'}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-neutral-500" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute left-0 z-40 mt-1 w-60 rounded-md border border-neutral-200 bg-white p-2 shadow-lg">
            {options.length > 8 && <input className="input mb-1.5 py-1 text-xs" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />}
            <div className="max-h-60 overflow-y-auto">
              {options.filter((o) => o.toLowerCase().includes(q.toLowerCase())).map((o) => (
                <label key={o} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-neutral-50">
                  <input type="checkbox" checked={value.includes(o)} onChange={() => onChange(value.includes(o) ? value.filter((x) => x !== o) : [...value, o])} />
                  {o}
                </label>
              ))}
            </div>
            <div className="mt-1 flex justify-between border-t border-neutral-100 pt-1.5">
              <button className="text-[0.6875rem] text-neutral-500 hover:underline" onClick={() => onChange([])}>Clear</button>
              <button className="text-[0.6875rem] font-medium text-brand-700 hover:underline" onClick={() => setOpen(false)}>Done</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ───────────────────────────── visuals ─────────────────────────────

const measureOf = (ctx: Ctx, id: string) => ctx.foundation.measures.find((x) => x.id === id);
const exportRows = (title: string, rows: Record<string, unknown>[]) => download(`${title.replace(/[^\w]+/g, '_')}.csv`, toCsv(rows), 'text/csv');

/** Axis, legend and label text of the charts (Power BI's 9 pt labels). */
const AXIS = { fontSize: 12, fill: C.inkSecondary };
/** axis titles take the report's title colour (Power BI's "title" text class) */
const AXIS_TITLE = { fontSize: 12, fill: R.titleColor, color: R.titleColor, fontWeight: 600 };
/** room for the value axis title beside its numbers */
const Y_W = 66;
const GRID = <CartesianGrid strokeDasharray="1 3" stroke="#d4d4d4" vertical={false} />;

/** Period labels as the Power BI date table shows them: "Jan 2026", "05 Jan 2026", "2026 Q1". */
function periodLabel(bucket: string, grain: TimeGrain) {
  if (grain === 'quarter') return bucket.replace('-', ' ');
  const t = grain === 'month' ? `${bucket}-01T00:00:00Z` : `${bucket}T00:00:00Z`;
  return new Date(t).toLocaleDateString('en-GB', { ...(grain === 'week' ? { day: '2-digit' } : {}), month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** Legend below a chart: the split field's name, then a dot per series (Power BI's bottom legend). */
function LegendRow({ title, items }: { title?: string; items: { name: string; color: string }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 pl-1" style={{ fontSize: 12, color: C.inkSecondary }}>
      {title && <span className="font-semibold" style={{ color: C.ink }}>{title}</span>}
      {items.map((it) => <span key={it.name} className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full" style={{ background: it.color }} />{it.name}</span>)}
    </div>
  );
}

function Visual({ c, ctx }: { c: DashComponent; ctx: Ctx }) {
  if (c.type === 'kpi') return <KpiCard c={c} ctx={ctx} />;
  if (c.type === 'kpiGroup') return c.dimension ? <CategoryRowCard c={c} ctx={ctx} /> : <MultiValueCard c={c} ctx={ctx} />;
  if (c.type === 'extremes') return <ExtremesCard c={c} ctx={ctx} />;
  if (c.type === 'records') return <RecordsVisual c={c} ctx={ctx} />;
  if (c.type === 'scatter') return <ScatterVisual c={c} ctx={ctx} />;
  if (c.type === 'table') return <TableVisual c={c} ctx={ctx} />;
  if (c.type === 'line' || c.type === 'area') return <LineVisual c={c} ctx={ctx} />;
  if (isMatrix(c)) return <MatrixVisual c={c} ctx={ctx} />;
  if (c.type === 'stacked') return <StackedVisual c={c} ctx={ctx} />;
  if (c.type === 'funnel') return <FunnelVisual c={c} ctx={ctx} />;
  return <CategoryVisual c={c} ctx={ctx} />;
}

/** Whether the reporting period changes a measure (master-data counts are not date-filtered), as in the export. */
const isDated = (ctx: Ctx, id: string) => ctx.engine.measureDatasets(id).some((ds) => { const p = ctx.engine.profile(ds); return p?.kind === 'activity' && !!p.dateField; });

/** Single KPI (Power BI card): the value, with "+4.2% vs prev. 1,234" (or "Selected period") as the subtitle. */
function KpiCard({ c, ctx }: { c: DashComponent; ctx: Ctx }) {
  const m = measureOf(ctx, c.measureIds[0]);
  const k = ctx.engine.kpi(c.measureIds[0], ctx.f);
  let sub: string | undefined;
  if (c.comparison !== false && isDated(ctx, c.measureIds[0]) && hasDatesAt(ctx)) {
    const pct = m?.format === 'percent';
    const d = k.current != null && k.previous != null && k.previous !== 0 ? (pct ? k.current - k.previous : ((k.current - k.previous) / Math.abs(k.previous)) * 100) : null;
    sub = d == null ? 'Selected period' : `${d > 0.05 ? '+' : d < -0.05 ? '-' : ''}${Math.abs(d).toFixed(1)}${pct ? ' pts' : '%'} vs prev. ${fmtMeasure(k.previous, m)}`;
  }
  return (
    <VisualBox title={c.title} subtitle={sub} testId="kpi" dataTitle={c.title}>
      <div className="flex h-full items-center justify-center font-semibold tabular-nums" style={{ fontSize: pt(R.kpiValue), color: C.ink }} data-testid="kpi-value" title={m?.logic}>{fmtMeasure(k.current, m)}</div>
    </VisualBox>
  );
}
const hasDatesAt = (ctx: Ctx) => ctx.engine.profiles.some((p) => p.kind === 'activity' && !!p.dateField);

/** Power BI multi-row card: values side by side, each above its label, with the accent bar on the left. */
function CardValues({ items }: { items: { value: string; label: string; title?: string }[] }) {
  return (
    <div className="flex h-full items-center">
      <div className="grid w-full border-l-[3px] py-0.5" style={{ borderColor: R.cardBar, gridTemplateColumns: `repeat(${Math.max(1, items.length)}, minmax(0, 1fr))` }}>
        {items.map((it, i) => (
          <div key={i} className="min-w-0 px-3" title={it.title ?? it.value}>
            <div className="truncate font-normal tabular-nums leading-tight" style={{ fontSize: pt(R.value), color: C.ink }} data-testid="kpi-value">{it.value}</div>
            <div className="truncate" style={{ fontSize: pt(R.label), color: C.muted }}>{it.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Several measures in one card (Cases: Total / Open / Closed / Closure Rate). */
function MultiValueCard({ c, ctx }: { c: DashComponent; ctx: Ctx }) {
  const { current } = ctx.engine.resolve(ctx.f);
  const items = c.measureIds.map((id, i) => {
    const m = measureOf(ctx, id);
    return { value: fmtMeasure(ctx.engine.value(id, ctx.f, current), m), label: c.labels?.[i] ?? m?.name ?? '', title: m?.logic };
  });
  return (
    <VisualBox title={c.title} subtitle={c.description || undefined} testId="kpi-group" dataTitle={c.title}>
      <CardValues items={items} />
    </VisualBox>
  );
}

/** One measure per category in one row (Power BI one-row matrix): category headers, values right-aligned. */
function CategoryRowCard({ c, ctx }: { c: DashComponent; ctx: Ctx }) {
  const m = measureOf(ctx, c.measureIds[0]);
  const selected = ctx.f.selections[c.dimension!] ?? [];
  const items = ctx.engine.group(c.measureIds[0], c.dimension!, ctx.f).filter((g) => g.key !== UNMATCHED);
  return (
    <VisualBox title={c.title} subtitle={c.description || undefined} testId="kpi-group" dataTitle={c.title} onExport={() => exportRows(c.title, items.map((g) => ({ [fieldLabel(ctx.foundation, c.dimension!)]: g.key, [m?.name ?? 'Value']: g.value })))}>
      <div className="flex h-full items-center">
        {items.length ? (
          <table className="w-full table-fixed border-collapse">
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.primary}` }}>
                {items.map((g) => <th key={g.key} className="border-l border-neutral-200 px-2 pb-1 text-left align-bottom font-normal leading-tight first:border-l-0" style={{ fontSize: pt(R.label), color: C.inkSecondary }}>{g.key}</th>)}
              </tr>
            </thead>
            <tbody>
              <tr>
                {items.map((g) => (
                  <td key={g.key} className={cx('cursor-pointer border-l border-neutral-200 px-2 pt-1 text-right font-semibold tabular-nums first:border-l-0', selected.length && !selected.includes(g.key) && 'opacity-40')} style={{ fontSize: pt(R.value), color: C.ink }} onClick={() => ctx.toggle(c.dimension!, g.key)} data-testid="kpi-value">
                    {fmtMeasure(g.value, m)}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        ) : <NoData />}
      </div>
    </VisualBox>
  );
}

/** Highest / lowest category of a measure ("Northeast · 282" over "Highest"), as the export's scorecard card. */
function ExtremesCard({ c, ctx }: { c: DashComponent; ctx: Ctx }) {
  const m = measureOf(ctx, c.measureIds[0]);
  const g = ctx.engine.group(c.measureIds[0], c.dimension!, ctx.f).filter((x) => x.key !== UNMATCHED && x.key !== BLANK).sort((a, b) => b.value - a.value || a.key.localeCompare(b.key));
  const hi = g[0];
  const lo = g[g.length - 1];
  const text = (x?: { key: string; value: number }) => (x ? `${x.key} · ${fmtMeasure(x.value, m)}` : '—');
  let items: { value: string; label: string }[];
  if (c.topOnly) {
    const attr = hi ? display(ctx.engine.table(c.dimension!, [c.measureIds[0]], [c.topOnly], ctx.f).find((r) => r.__key === hi.key)?.[c.topOnly] ?? null) : undefined;
    items = [{ value: text(hi), label: fieldLabel(ctx.foundation, c.dimension!) }, { value: attr ?? '—', label: fieldLabel(ctx.foundation, c.topOnly) }];
  } else items = c.lowIsBest ? [{ value: text(lo), label: 'Fastest' }, { value: text(hi), label: 'Slowest' }] : [{ value: text(hi), label: 'Highest' }, { value: text(lo), label: 'Lowest' }];
  return (
    <VisualBox title={c.title} subtitle={c.description || undefined} testId="extremes" dataTitle={c.title}>
      <CardValues items={items} />
    </VisualBox>
  );
}

const fillFor = (selected: string[], key: string, color: string) => (selected.length && !selected.includes(key) ? C.deselected : color);

/** Column / bar / donut chart of one measure by one category. */
function CategoryVisual({ c, ctx }: { c: DashComponent; ctx: Ctx }) {
  const m = measureOf(ctx, c.measureIds[0]);
  const dim = c.dimension!;
  const data = ctx.engine.group(c.measureIds[0], dim, ctx.f, { topN: c.topN, threshold: c.threshold });
  const selected = ctx.f.selections[dim] ?? [];
  const rows = data.map((d) => ({ name: d.key, value: d.value }));
  const dimName = fieldLabel(ctx.foundation, dim);
  const label = (v: number) => fmtMeasure(v, m, true);
  return (
    <VisualBox title={c.title} subtitle={c.description || undefined} testId="visual" dataTitle={c.title} onExport={() => exportRows(c.title, rows.map((r) => ({ [dimName]: r.name, [m?.name ?? 'Value']: r.value })))}>
      {!rows.length ? <NoData /> : c.type === 'donut' ? (
        <div className="flex h-full flex-col">
          <div className="min-h-0 flex-1">
            <ResponsiveContainer>
              <PieChart>
                <Pie isAnimationActive={false} data={rows} dataKey="value" nameKey="name" innerRadius="50%" outerRadius="80%" onClick={(d) => ctx.toggle(dim, String(d.name))} cursor="pointer" label={(p: { value: number }) => label(p.value)} labelLine={false} style={{ fontSize: 12 }}>
                  {rows.map((r, i) => <Cell key={r.name} fill={fillFor(selected, r.name, PALETTE[i % PALETTE.length])} />)}
                </Pie>
                <Tooltip formatter={(v: number) => fmtMeasure(v, m)} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <LegendRow title={dimName} items={rows.map((r, i) => ({ name: r.name, color: PALETTE[i % PALETTE.length] }))} />
        </div>
      ) : (
        <ResponsiveContainer>
          {c.type === 'hbar' ? (
            <BarChart data={rows} layout="vertical" margin={{ left: 8, right: 28, bottom: 12 }}>
              <CartesianGrid strokeDasharray="1 3" stroke="#d4d4d4" horizontal={false} />
              <XAxis type="number" tick={AXIS} tickFormatter={label} label={{ value: m?.name, position: 'insideBottom', offset: -8, ...AXIS_TITLE }} />
              <YAxis type="category" dataKey="name" tick={AXIS} width={110} label={{ value: dimName, angle: -90, position: 'insideLeft', ...AXIS_TITLE }} />
              <Tooltip formatter={(v: number) => fmtMeasure(v, m)} cursor={{ fill: '#f5f5f5' }} />
              <Bar isAnimationActive={false} dataKey="value" name={m?.name} onClick={(d) => ctx.toggle(dim, String(d.name))} cursor="pointer">
                {rows.map((r) => <Cell key={r.name} fill={fillFor(selected, r.name, PALETTE[0])} />)}
                <LabelList dataKey="value" position="right" formatter={label} style={{ fontSize: 12, fill: C.inkSecondary }} />
              </Bar>
            </BarChart>
          ) : (
            <BarChart data={rows} margin={{ top: 16, right: 8, bottom: 14 }}>
              {GRID}
              <XAxis dataKey="name" tick={AXIS} interval={0} angle={rows.length > 6 ? -30 : 0} textAnchor={rows.length > 6 ? 'end' : 'middle'} height={rows.length > 6 ? 60 : 30} label={{ value: dimName, position: 'insideBottom', offset: -10, ...AXIS_TITLE }} />
              <YAxis tick={AXIS} width={Y_W} tickFormatter={label} label={{ value: m?.name, angle: -90, position: 'insideLeft', ...AXIS_TITLE }} />
              <Tooltip formatter={(v: number) => fmtMeasure(v, m)} cursor={{ fill: '#f5f5f5' }} />
              <Bar isAnimationActive={false} dataKey="value" name={m?.name} onClick={(d) => ctx.toggle(dim, String(d.name))} cursor="pointer">
                {rows.map((r) => <Cell key={r.name} fill={fillFor(selected, r.name, PALETTE[0])} />)}
                <LabelList dataKey="value" position="top" formatter={label} style={{ fontSize: 12, fill: C.inkSecondary }} />
              </Bar>
            </BarChart>
          )}
        </ResponsiveContainer>
      )}
    </VisualBox>
  );
}

/** Column chart with a two-level axis (Territory › Product, Month › Product) and/or one bar per series value. */
function MatrixVisual({ c, ctx }: { c: DashComponent; ctx: Ctx }) {
  const m = measureOf(ctx, c.measureIds[0]);
  const axis = axisOf(c);
  const { rows, series } = ctx.engine.matrix(c.measureIds[0], axis, c.series, ctx.f);
  const text = (k: string, i: number) => { const a = axis[i]; return 'grain' in a ? periodLabel(k, a.grain) : k; };
  const data = rows.map((r) => ({ __k: r.keys.join(' · '), __keys: r.keys.map(text), __raw: r.keys, ...r.values }));
  const keys = c.series ? series : [VALUE];
  const stacked = c.type === 'stacked';
  const outer = axis[0] && 'field' in axis[0] ? axis[0].field : undefined;
  const selected = outer ? ctx.f.selections[outer] ?? [] : [];
  const fieldName = (i: number) => { const a = axis[i]; return 'grain' in a ? `${a.grain[0].toUpperCase()}${a.grain.slice(1)}` : fieldLabel(ctx.foundation, a.field); };
  const narrow = data.length > 10;
  return (
    <VisualBox title={c.title} subtitle={c.description || undefined} testId="visual" dataTitle={c.title} onExport={() => exportRows(c.title, data.map((d) => ({ ...Object.fromEntries(axis.map((_, i) => [fieldName(i), d.__keys[i]])), ...Object.fromEntries(keys.map((k) => [k === VALUE ? m?.name ?? 'Value' : k, (d as Record<string, unknown>)[k]])) })))}>
      {!data.length ? <NoData /> : (
        <div className="flex h-full flex-col">
          <div className="min-h-0 flex-1">
            <ResponsiveContainer>
              <BarChart data={data} margin={{ top: 10, right: 8, bottom: 0 }} barCategoryGap={stacked ? '18%' : '12%'}>
                {GRID}
                <XAxis dataKey="__k" interval={0} tickLine={false} height={axis.length > 1 ? (narrow ? 86 : 46) : narrow ? 62 : 26} tick={<AxisTick data={data} levels={axis.length} vertical={narrow} />} />
                <YAxis tick={AXIS} width={Y_W} tickFormatter={(v: number) => fmtMeasure(v, m, true)} label={{ value: m?.name, angle: -90, position: 'insideLeft', ...AXIS_TITLE }} />
                <Tooltip formatter={(v: number, n: string) => [fmtMeasure(v, m), n === VALUE ? m?.name : n]} labelFormatter={(_, p) => (p?.[0]?.payload?.__keys as string[] | undefined)?.join(' › ') ?? ''} cursor={{ fill: '#f5f5f5' }} />
                {keys.map((k, i) => (
                  <Bar isAnimationActive={false} key={k} dataKey={k} name={k === VALUE ? m?.name : k} stackId={stacked ? 'a' : undefined} fill={PALETTE[i % PALETTE.length]} onClick={(d: { __raw?: string[] }) => outer && d.__raw && ctx.toggle(outer, d.__raw[0])} cursor={outer ? 'pointer' : undefined}>
                    {outer && data.map((d) => <Cell key={d.__k} fill={fillFor(selected, d.__raw[0], PALETTE[i % PALETTE.length])} />)}
                    {stacked && data.length <= 16 && <LabelList dataKey={k} position="center" formatter={(v: number) => (v ? fmtMeasure(v, m, true) : '')} style={{ fontSize: 11, fill: '#fff' }} />}
                  </Bar>
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="pb-0.5 text-center" style={AXIS_TITLE}>{fieldName(axis.length - 1)}</div>
          {c.series && <LegendRow title={fieldLabel(ctx.foundation, c.series)} items={series.map((s, i) => ({ name: s, color: PALETTE[i % PALETTE.length] }))} />}
        </div>
      )}
    </VisualBox>
  );
}

/** Axis tick for a two-level axis: inner value under each bar, outer value centred under its group with a separator. */
function AxisTick(props: { x?: number; y?: number; width?: number; visibleTicksCount?: number; index?: number; data: { __keys: string[] }[]; levels: number; vertical: boolean }) {
  const { x = 0, y = 0, index = 0, data, levels, vertical } = props;
  const band = (props.width ?? 0) / Math.max(1, props.visibleTicksCount ?? data.length);
  const keys = data[index]?.__keys ?? [];
  const inner = keys[levels - 1] ?? '';
  const innerEl = vertical
    ? <text x={0} y={0} dy={4} textAnchor="end" transform="rotate(-90)" fontSize={11} fill={C.inkSecondary}>{inner}</text>
    : <text x={0} y={0} dy={12} textAnchor="middle" fontSize={11} fill={C.inkSecondary}>{inner}</text>;
  if (levels < 2) return <g transform={`translate(${x},${y + (vertical ? 6 : 0)})`}>{innerEl}</g>;
  const outer = keys[0];
  const first = index === 0 || data[index - 1]?.__keys[0] !== outer;
  let size = 0;
  while (data[index + size]?.__keys[0] === outer) size++;
  const innerH = vertical ? 58 : 18;
  return (
    <g>
      <g transform={`translate(${x},${y + (vertical ? 6 : 0)})`}>{innerEl}</g>
      {first && (
        <>
          <line x1={x - band / 2} x2={x - band / 2} y1={y} y2={y + innerH + 18} stroke="#d4d4d4" />
          <text x={x - band / 2 + (size * band) / 2} y={y + innerH + 12} textAnchor="middle" fontSize={11} fill={C.inkSecondary}>{outer}</text>
        </>
      )}
      {index === data.length - 1 && <line x1={x + band / 2} x2={x + band / 2} y1={y} y2={y + innerH + 18} stroke="#d4d4d4" />}
    </g>
  );
}

/** Stacked column chart: one measure by a category, split by a series. */
function StackedVisual({ c, ctx }: { c: DashComponent; ctx: Ctx }) {
  const m = measureOf(ctx, c.measureIds[0]);
  const { rows, keys } = ctx.engine.group2(c.measureIds[0], c.dimension!, c.series!, ctx.f);
  const dimName = fieldLabel(ctx.foundation, c.dimension!);
  return (
    <VisualBox title={c.title} subtitle={c.description || undefined} testId="visual" dataTitle={c.title} onExport={() => exportRows(c.title, rows.map(({ __total, ...r }) => ({ ...r, Total: __total })))}>
      {!rows.length ? <NoData /> : (
        <div className="flex h-full flex-col">
          <div className="min-h-0 flex-1">
            <ResponsiveContainer>
              <BarChart data={rows} margin={{ top: 10, right: 8, bottom: 14 }}>
                {GRID}
                <XAxis dataKey="key" tick={AXIS} label={{ value: dimName, position: 'insideBottom', offset: -10, ...AXIS_TITLE }} />
                <YAxis tick={AXIS} width={Y_W} tickFormatter={(v: number) => fmtMeasure(v, m, true)} label={{ value: m?.name, angle: -90, position: 'insideLeft', ...AXIS_TITLE }} />
                <Tooltip formatter={(v: number) => fmtMeasure(v, m)} cursor={{ fill: '#f5f5f5' }} />
                {keys.map((k, i) => (
                  <Bar isAnimationActive={false} key={k} dataKey={k} stackId="a" fill={PALETTE[i % PALETTE.length]} onClick={(d: { key?: string }) => d.key && ctx.toggle(c.dimension!, String(d.key))} cursor="pointer">
                    {rows.length <= 16 && <LabelList dataKey={k} position="center" formatter={(v: number) => (v ? fmtMeasure(v, m, true) : '')} style={{ fontSize: 11, fill: '#fff' }} />}
                  </Bar>
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
          <LegendRow title={fieldLabel(ctx.foundation, c.series!)} items={keys.map((k, i) => ({ name: k, color: PALETTE[i % PALETTE.length] }))} />
        </div>
      )}
    </VisualBox>
  );
}

/** Line / area chart: one line per measure over the period axis. */
function LineVisual({ c, ctx }: { c: DashComponent; ctx: Ctx }) {
  const grain = c.timeGrain ?? ctx.spec.timeGrain;
  const ms = c.measureIds.map((id) => measureOf(ctx, id)).filter(Boolean) as MeasureDef[];
  const map = new Map<string, Record<string, number | string>>();
  for (const m of ms) for (const s of ctx.engine.series(m.id, grain, ctx.f)) {
    if (!map.has(s.bucket)) map.set(s.bucket, { bucket: s.bucket, name: periodLabel(s.bucket, grain) });
    map.get(s.bucket)![m.name] = s.value;
  }
  const keys = [...map.keys()].sort();
  // zero-fill periods with no activity for additive measures so lines don't bridge gaps
  if (keys.length > 1)
    for (const b of bucketRange(keys[0], keys[keys.length - 1], grain)) {
      if (!map.has(b)) map.set(b, { bucket: b, name: periodLabel(b, grain) });
      const row = map.get(b)!;
      for (const m of ms) if (row[m.name] == null && m.kind !== 'ratio') row[m.name] = 0;
    }
  const rows = [...map.values()].sort((a, b) => String(a.bucket).localeCompare(String(b.bucket)));
  const Chart = c.type === 'area' ? AreaChart : LineChart;
  return (
    <VisualBox title={c.title} subtitle={c.description || undefined} testId="visual" dataTitle={c.title} onExport={() => exportRows(c.title, rows)}>
      {!rows.length ? <NoData /> : (
        <div className="flex h-full flex-col">
          <div className="min-h-0 flex-1">
            <ResponsiveContainer>
              <Chart data={rows} margin={{ top: 10, right: 12, bottom: 14 }}>
                {GRID}
                <XAxis dataKey="name" tick={AXIS} minTickGap={16} label={{ value: grain === 'week' ? 'Week Start' : grain === 'quarter' ? 'Quarter' : 'Month', position: 'insideBottom', offset: -10, ...AXIS_TITLE }} />
                <YAxis tick={AXIS} width={Y_W} tickFormatter={(v: number) => fmtMeasure(v, ms[0], true)} />
                <Tooltip formatter={(v: number, n: string) => fmtMeasure(v, ms.find((m) => m.name === n))} />
                {ms.map((m, i) => (c.type === 'area' ? <Area isAnimationActive={false} key={m.id} dataKey={m.name} stroke={PALETTE[i]} fill={PALETTE[i]} fillOpacity={0.15} strokeWidth={2} /> : <Line isAnimationActive={false} key={m.id} dataKey={m.name} stroke={PALETTE[i]} strokeWidth={2} dot={false} connectNulls />))}
              </Chart>
            </ResponsiveContainer>
          </div>
          {ms.length > 1 && <LegendRow items={ms.map((m, i) => ({ name: m.name, color: PALETTE[i] }))} />}
        </div>
      )}
    </VisualBox>
  );
}

/** Funnel stages as Power BI's clustered bar chart: one bar per stage measure, with its value. */
function FunnelVisual({ c, ctx }: { c: DashComponent; ctx: Ctx }) {
  const { current } = ctx.engine.resolve(ctx.f);
  const stages = c.measureIds.map((id) => ({ m: measureOf(ctx, id), v: ctx.engine.value(id, ctx.f, current) ?? 0 }));
  const row = Object.fromEntries([['name', ''], ...stages.map((s) => [s.m?.name ?? s.m?.id ?? '', s.v])]);
  return (
    <VisualBox title={c.title} subtitle={c.description || undefined} testId="visual" dataTitle={c.title} onExport={() => exportRows(c.title, stages.map((s) => ({ Stage: s.m?.name, Value: s.v })))}>
      <div className="flex h-full flex-col" data-testid="funnel">
        <div className="min-h-0 flex-1">
          <ResponsiveContainer>
            <BarChart data={[row]} layout="vertical" margin={{ left: 8, right: 36 }} barCategoryGap="8%" barGap={4}>
              <CartesianGrid strokeDasharray="1 3" stroke="#d4d4d4" horizontal={false} />
              <XAxis type="number" tick={AXIS} />
              <YAxis type="category" dataKey="name" hide />
              <Tooltip formatter={(v: number, n: string) => fmtMeasure(v, stages.find((s) => s.m?.name === n)?.m)} cursor={{ fill: '#f5f5f5' }} />
              {stages.map((s, i) => (
                <Bar isAnimationActive={false} key={s.m?.id ?? i} dataKey={s.m?.name ?? ''} fill={PALETTE[i % PALETTE.length]}>
                  <LabelList dataKey={s.m?.name ?? ''} position="right" formatter={(v: number) => fmtMeasure(v, s.m, true)} style={{ fontSize: 12, fill: C.inkSecondary }} />
                </Bar>
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
        <LegendRow items={stages.map((s, i) => ({ name: s.m?.name ?? '', color: PALETTE[i % PALETTE.length] }))} />
      </div>
    </VisualBox>
  );
}

function NoData() {
  return <div className="flex h-full items-center justify-center text-xs text-neutral-400">No data for the current filters</div>;
}

// ───────────────────────────── tables ─────────────────────────────

/** Table header cell: the report's purple header (theme tableEx column headers). */
const thStyle: CSSProperties = { background: R.tableHeaderBack, color: R.tableHeaderText, fontSize: pt(R.table) };
const tdStyle: CSSProperties = { fontSize: pt(R.table), color: C.ink };
const sortMark = (on: boolean, dir: 1 | -1) => (on ? (dir === 1 ? ' ▲' : ' ▼') : '');

/** Category table with attribute columns, measures, a totals row and priority flags (⚑⚑ / ⚑, as in the export). */
function TableVisual({ c, ctx }: { c: DashComponent; ctx: Ctx }) {
  const daysAttr = (c.tableColumns ?? []).find((a) => /days/i.test(a));
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: daysAttr ?? c.measureIds[0], dir: -1 });
  const ms = c.measureIds.map((id) => measureOf(ctx, id)).filter(Boolean) as MeasureDef[];
  const attrs = c.tableColumns ?? [];
  const rows = ctx.engine
    .table(c.dimension!, c.measureIds, attrs, ctx.f)
    .filter((r) => !c.threshold || (c.threshold.op === 'gt' ? Number(r[c.measureIds[0]]) > c.threshold.value : Number(r[c.measureIds[0]]) >= c.threshold.value))
    .sort((a, b) => {
      const x = a[sort.key];
      const y = b[sort.key];
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''))) * sort.dir;
    });
  // totals as Power BI computes them: additive measures sum over the rows, others are the measure over all rows
  const { current } = ctx.engine.resolve(ctx.f);
  const totals = Object.fromEntries(ms.map((m) => [m.id, m.kind === 'count' || m.kind === 'sum' ? rows.reduce((s, r) => s + ((r[m.id] as number) ?? 0), 0) : ctx.engine.value(m.id, ctx.f, current)]));
  // priority flags: explicit thresholds, or the top 10% (two flags) and next 25% (one flag) of the rows in view
  const ranked = rows.map((r) => Number(r[c.measureIds[0]] ?? 0)).filter((x) => x > 0).sort((a, b) => b - a);
  const at = (q: number) => ranked[Math.min(ranked.length - 1, Math.floor(ranked.length * q))] ?? Infinity;
  const flagAt = { high: c.flags?.high ?? Math.max(2, at(0.1)), medium: c.flags?.medium ?? Math.max(1, at(0.35)) };
  const flagOf = (v: number) => (c.flags && v > 0 ? (v >= flagAt.high ? '⚑⚑' : v >= flagAt.medium ? '⚑' : '') : '');
  const dimName = fieldLabel(ctx.foundation, c.dimension!);
  const selected = ctx.f.selections[c.dimension!] ?? [];
  const head = (key: string, label: string, right = false) => (
    <th key={key} className={cx('cursor-pointer select-none whitespace-nowrap px-2 py-1 font-bold', right ? 'text-right' : 'text-left')} style={thStyle} onClick={() => setSort({ key, dir: sort.key === key ? (sort.dir === 1 ? -1 : 1) : -1 })}>
      {label}{sortMark(sort.key === key, sort.dir)}
    </th>
  );
  return (
    <VisualBox title={c.title} subtitle={c.description || undefined} testId="visual" dataTitle={c.title} onExport={() => exportRows(c.title, rows.map((r) => ({ [dimName]: r.__key, ...Object.fromEntries(attrs.map((a) => [fieldLabel(ctx.foundation, a), r[a]])), ...Object.fromEntries(ms.map((m) => [m.name, r[m.id]])) })))}>
      <div className="h-full overflow-auto">
        <table className="w-full border-collapse" data-testid="data-table">
          <thead className="sticky top-0 z-10">
            <tr>
              {head('__key', dimName)}
              {attrs.map((a) => head(a, fieldLabel(ctx.foundation, a)))}
              {ms.map((m) => head(m.id, m.name, true))}
              {c.flags && <th className="whitespace-nowrap px-2 py-1 text-left font-bold" style={thStyle}>Priority Flag</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={String(r.__key)} onClick={() => ctx.toggle(c.dimension!, String(r.__key))} className="cursor-pointer hover:!bg-brand-50" style={{ background: selected.includes(String(r.__key)) ? '#ecdcff' : i % 2 ? C.page : '#fff' }}>
                <td className="px-2 py-0.5" style={tdStyle}>{String(r.__key)}</td>
                {attrs.map((a) => <td key={a} className="px-2 py-0.5" style={tdStyle}>{display(r[a] ?? null)}</td>)}
                {ms.map((m) => <td key={m.id} className="px-2 py-0.5 text-right tabular-nums" style={tdStyle}>{fmtMeasure(r[m.id] as number, m)}</td>)}
                {c.flags && <td className="px-2 py-0.5" style={tdStyle} aria-label="priority flag">{flagOf(Number(r[c.measureIds[0]] ?? 0))}</td>}
              </tr>
            ))}
          </tbody>
          <tfoot className="sticky bottom-0 bg-white">
            <tr style={{ borderTop: `1px solid ${C.primary}` }}>
              <td className="px-2 py-1 font-bold" style={tdStyle}>Total</td>
              {attrs.map((a) => <td key={a} />)}
              {ms.map((m) => <td key={m.id} className="px-2 py-1 text-right font-bold tabular-nums" style={tdStyle}>{totals[m.id] == null ? '' : fmtMeasure(totals[m.id] as number, m)}</td>)}
              {c.flags && <td className="px-2 py-1 font-bold" style={tdStyle}>{flagOf(Number(totals[c.measureIds[0]] ?? 0))}</td>}
            </tr>
          </tfoot>
        </table>
        {!rows.length && <div className="py-8"><NoData /></div>}
      </div>
    </VisualBox>
  );
}

/** Record-level cell: empty values read as blank in a case list, not as a "(Blank)" category. */
const cellText = (v: WideRow['v'][string] | undefined) => (v == null || v === '' ? '' : display(v));

/** Row-level list of the records behind a measure (e.g. every case), narrowed by its own slicer above it. */
function RecordsVisual({ c, ctx }: { c: DashComponent; ctx: Ctx }) {
  const cols = c.tableColumns ?? [];
  const [sort, setSort] = useState<{ key: FieldRef; dir: 1 | -1 }>({ key: c.sortBy ?? cols[0], dir: -1 });
  const tf = c.toggle?.filter[0];
  const picked = ctx.narrow[c.id] ?? [];
  const rows = ctx.engine
    .records(c.measureIds[0], ctx.f, tf && picked.length ? [{ field: tf.field, op: 'eq', values: picked }] : [])
    .sort((a, b) => {
      const x = a.v[sort.key];
      const y = b.v[sort.key];
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''))) * sort.dir;
    });
  const label = (k: FieldRef) => fieldLabel(ctx.foundation, k);
  return (
    <VisualBox title={c.title} subtitle={c.description || undefined} testId="visual" dataTitle={c.title} onExport={() => exportRows(c.title, rows.map((w) => Object.fromEntries(cols.map((k) => [label(k), w.v[k]]))))}>
      <div className="h-full overflow-auto">
        <table className="w-full border-collapse" data-testid="records-table">
          <thead className="sticky top-0 z-10">
            <tr>
              {cols.map((k) => (
                <th key={k} className="cursor-pointer select-none whitespace-nowrap px-2 py-1 text-left font-bold" style={thStyle} onClick={() => setSort({ key: k, dir: sort.key === k ? (sort.dir === 1 ? -1 : 1) : -1 })}>
                  {label(k)}{sortMark(sort.key === k, sort.dir)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((w, i) => (
              <tr key={String(w.v[cols[0]]) + i} style={{ background: i % 2 ? C.page : '#fff' }}>
                {cols.map((k) => <td key={k} className="whitespace-nowrap px-2 py-0.5" style={tdStyle}>{cellText(w.v[k])}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <div className="py-8"><NoData /></div>}
      </div>
    </VisualBox>
  );
}

// ───────────────────────────── scatter ─────────────────────────────

/** Two measures per category (x against y), one colour per series value, category labels on the points. */
function ScatterVisual({ c, ctx }: { c: DashComponent; ctx: Ctx }) {
  const [mx, my] = c.measureIds.map((id) => measureOf(ctx, id));
  const ax: AxisLevel[] = [{ field: c.dimension! }];
  const xs = ctx.engine.matrix(c.measureIds[0], ax, c.series, ctx.f);
  const ys = ctx.engine.matrix(c.measureIds[1], ax, c.series, ctx.f);
  const yOf = new Map(ys.rows.map((r) => [r.keys[0], r.values]));
  const groups = (c.series ? xs.series : [VALUE]).map((s) => ({ s, pts: xs.rows.filter((r) => r.values[s] != null && yOf.get(r.keys[0])?.[s] != null).map((r) => ({ name: r.keys[0], x: r.values[s], y: yOf.get(r.keys[0])![s] })) })).filter((g) => g.pts.length);
  const selected = ctx.f.selections[c.dimension!] ?? [];
  return (
    <VisualBox title={c.title} subtitle={c.description || undefined} testId="visual" dataTitle={c.title} onExport={() => exportRows(c.title, groups.flatMap((g) => g.pts.map((p) => ({ [fieldLabel(ctx.foundation, c.dimension!)]: p.name, ...(c.series ? { [fieldLabel(ctx.foundation, c.series)]: g.s } : {}), [mx?.name ?? 'x']: p.x, [my?.name ?? 'y']: p.y }))))}>
      {!groups.length ? <NoData /> : (
        <div className="flex h-full flex-col">
          <div className="min-h-0 flex-1">
            <ResponsiveContainer>
              <ScatterChart margin={{ top: 12, right: 24, bottom: 14, left: 0 }}>
                <CartesianGrid strokeDasharray="1 3" stroke="#d4d4d4" />
                <XAxis type="number" dataKey="x" name={mx?.name} tick={AXIS} domain={['auto', 'auto']} label={{ value: mx?.name, position: 'insideBottom', offset: -10, ...AXIS_TITLE }} />
                <YAxis type="number" dataKey="y" name={my?.name} tick={AXIS} width={Y_W} domain={['auto', 'auto']} label={{ value: my?.name, angle: -90, position: 'insideLeft', ...AXIS_TITLE }} />
                <Tooltip cursor={{ strokeDasharray: '3 3' }} formatter={(v: number, n: string) => fmtMeasure(v, n === mx?.name ? mx : my)} labelFormatter={() => ''} />
                {groups.map((g, i) => (
                  <Scatter isAnimationActive={false} key={g.s} name={g.s === VALUE ? fieldLabel(ctx.foundation, c.dimension!) : g.s} data={g.pts} fill={PALETTE[i % PALETTE.length]} onClick={(d: { name?: string }) => d.name && ctx.toggle(c.dimension!, d.name)} cursor="pointer">
                    {g.pts.map((p) => <Cell key={p.name} fill={fillFor(selected, p.name, PALETTE[i % PALETTE.length])} />)}
                    <LabelList dataKey="name" position="top" style={{ fontSize: 11, fill: C.inkSecondary }} />
                  </Scatter>
                ))}
              </ScatterChart>
            </ResponsiveContainer>
          </div>
          {c.series && <LegendRow title={fieldLabel(ctx.foundation, c.series)} items={groups.map((g, i) => ({ name: g.s, color: PALETTE[i % PALETTE.length] }))} />}
        </div>
      )}
    </VisualBox>
  );
}
