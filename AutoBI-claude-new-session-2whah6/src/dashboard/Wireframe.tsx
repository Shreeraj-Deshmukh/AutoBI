import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { GripVertical, Trash2, ArrowUp, ArrowDown, ChevronDown } from 'lucide-react';
import type { DashComponent, DashboardSpec, Foundation } from '@/types';
import { cx } from '@/components/ui';
import { CHART_LABELS } from '@/agents/designAgent';
import { PERIOD_LABELS } from '@/lib/dates';
import { fieldIncluded, fieldLabel } from '@/lib/fieldLabels';
import { hasToggle, layoutPage, type LayoutItem } from '@/lib/powerbi/layout';
import { CLIENT_THEME as C, PALETTE_TINTS as T, REPORT as R, pt } from './format';
import { Banner, FilterBand, Logo, PageTitle, ReportCanvas, SELECT, SectionHeading, SlicerBox, Tabs, VisualBox, pos } from './reportFrame';
import { useJustAdded } from '@/lib/useJustAdded';

/**
 * Design mock of the dashboard: the same page layout, frame and look as the development dashboard and the
 * downloaded Power BI report (src/lib/powerbi/layout.ts, ./reportFrame), with grey placeholders for the data.
 */

const BAR = 'rounded-sm bg-neutral-200';

/** A grey stand-in for a value, shaped like the Power BI visual the component becomes. */
function Placeholder({ c }: { c: DashComponent }) {
  const bars = [62, 88, 45, 74, 55, 92, 38, 67];
  if (c.type === 'kpi') return <div className="flex h-full items-center justify-center"><div className={cx(BAR, 'h-7 w-24')} /></div>;
  if (c.type === 'kpiGroup' && c.dimension)
    return (
      <div className="flex h-full items-center">
        <div className="grid w-full" style={{ gridTemplateColumns: 'repeat(5, minmax(0, 1fr))' }}>
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="border-l border-neutral-200 px-2 first:border-l-0">
              <div className="truncate border-b pb-1 text-left" style={{ fontSize: pt(R.label), color: C.inkSecondary, borderColor: C.primary }}>Category</div>
              <div className={cx(BAR, 'ml-auto mt-1.5 h-5 w-12')} />
            </div>
          ))}
        </div>
      </div>
    );
  if (c.type === 'kpiGroup' || c.type === 'extremes') {
    const labels = c.type === 'extremes' ? (c.topOnly ? [fieldLabel(undefined, c.dimension ?? ''), fieldLabel(undefined, c.topOnly)] : c.lowIsBest ? ['Fastest', 'Slowest'] : ['Highest', 'Lowest']) : c.measureIds.map((_, i) => c.labels?.[i] ?? 'Value');
    return (
      <div className="flex h-full items-center">
        <div className="grid w-full border-l-[3px]" style={{ borderColor: R.cardBar, gridTemplateColumns: `repeat(${labels.length}, minmax(0, 1fr))` }}>
          {labels.map((l, i) => (
            <div key={i} className="min-w-0 px-3">
              <div className={cx(BAR, 'h-5 w-full max-w-[5rem]')} />
              <div className="mt-1 truncate" style={{ fontSize: pt(R.label), color: C.muted }}>{l}</div>
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (c.type === 'table' || c.type === 'records') {
    const n = c.type === 'records' ? Math.min(9, (c.tableColumns ?? []).length || 6) : 2 + (c.tableColumns ?? []).length + c.measureIds.length;
    return (
      <div className="h-full overflow-hidden">
        <div className="flex gap-2 px-1.5 py-1" style={{ background: R.tableHeaderBack }}>{Array.from({ length: n }, (_, i) => <div key={i} className="h-2.5 flex-1 rounded-sm bg-white/40" />)}</div>
        {Array.from({ length: 14 }, (_, r) => <div key={r} className="flex gap-2 px-1.5 py-1" style={{ background: r % 2 ? C.page : '#fff' }}>{Array.from({ length: n }, (_, i) => <div key={i} className={cx(BAR, 'h-2 flex-1 bg-neutral-100')} />)}</div>)}
      </div>
    );
  }
  if (c.type === 'scatter')
    return (
      <svg viewBox="0 0 200 100" preserveAspectRatio="none" className="h-full w-full">
        <line x1="10" y1="92" x2="198" y2="92" stroke="#e5e5e5" /><line x1="10" y1="4" x2="10" y2="92" stroke="#e5e5e5" />
        {[[30, 60], [55, 36], [70, 70], [95, 28], [120, 54], [150, 22], [170, 74], [185, 44]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r="3" fill={T[i % 2]} />)}
      </svg>
    );
  if (c.type === 'hbar' || c.type === 'funnel')
    return (
      <div className="flex h-full flex-col justify-around py-1">
        {(c.type === 'funnel' ? [100, 72, 51, 38, 22].slice(0, Math.max(2, Math.min(5, c.measureIds.length))) : bars.slice(0, 6)).map((h, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className={cx(BAR, 'h-2 w-14 shrink-0')} />
            <div className="h-3.5 rounded-r-sm" style={{ width: `${h * 0.75}%`, background: c.type === 'funnel' ? T[i % T.length] : T[0] }} />
          </div>
        ))}
      </div>
    );
  if (c.type === 'line' || c.type === 'area')
    return (
      <svg viewBox="0 0 200 70" preserveAspectRatio="none" className="h-full w-full">
        <polyline fill={c.type === 'area' ? '#ecdcff' : 'none'} stroke={T[0]} strokeWidth="2" vectorEffect="non-scaling-stroke" points="0,55 20,48 40,52 60,38 80,42 100,30 120,34 140,22 160,26 180,14 200,18" />
        {c.measureIds.length > 1 && <polyline fill="none" stroke={T[1]} strokeWidth="2" vectorEffect="non-scaling-stroke" points="0,62 20,58 40,60 60,52 80,54 100,46 120,48 140,40 160,42 180,34 200,36" />}
        <line x1="0" y1="69" x2="200" y2="69" stroke="#e5e5e5" />
      </svg>
    );
  if (c.type === 'donut')
    return (
      <div className="flex h-full items-center justify-center gap-4">
        <div className="aspect-square h-[70%] rounded-full" style={{ background: `conic-gradient(${T[0]} 0 45%, ${T[1]} 45% 75%, ${T[2]} 75% 100%)`, WebkitMask: 'radial-gradient(circle, transparent 50%, black 51%)', mask: 'radial-gradient(circle, transparent 50%, black 51%)' }} />
      </div>
    );
  // column charts (one bar, side-by-side bars per split value, or stacked segments)
  const split = c.series ? 3 : 1;
  return (
    <div className="flex h-full items-end gap-2 border-b border-neutral-200 px-2 pb-0.5">
      {bars.slice(0, 7).map((h, i) => (
        <div key={i} className={cx('flex flex-1 items-end', c.type === 'stacked' ? 'flex-col justify-end' : 'gap-0.5')} style={{ height: `${h}%` }}>
          {c.type === 'stacked'
            ? [2, 1, 1].map((f, k) => <div key={k} className="w-full" style={{ flex: f, background: T[k] }} />)
            : Array.from({ length: split }, (_, k) => <div key={k} className="flex-1" style={{ height: `${100 - k * 22}%`, background: T[k] }} />)}
        </div>
      ))}
    </div>
  );
}

const fakeDropdown = (text: string) => (
  <div className={cx(SELECT, 'flex items-center justify-between text-neutral-600')}>
    <span className="truncate">{text}</span>
    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-neutral-500" />
  </div>
);

export default function Wireframe({ spec, foundation, pageId, onPage, selected, onSelect, onChange, readOnly }: { spec: DashboardSpec; foundation: Foundation; pageId: string; onPage: (id: string) => void; selected: string | null; onSelect: (id: string | null) => void; onChange: (spec: DashboardSpec, note: string) => void; readOnly?: boolean }) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const page = spec.pages.find((p) => p.id === pageId) ?? spec.pages[0];
  const mname = (id: string) => foundation.measures.find((m) => m.id === id)?.name ?? '⚠ missing KPI';
  const clone = () => JSON.parse(JSON.stringify(spec)) as DashboardSpec;

  // briefly highlight what was just added (by the user or the design assistant)
  const fresh = useJustAdded(useMemo(() => [...spec.pages.map((p) => `page:${p.id}`), ...spec.pages.flatMap((p) => p.components.map((c) => `cmp:${c.id}`)), ...spec.filters.map((f) => `flt:${f.id}`)], [spec]));
  const isNew = (kind: 'page' | 'cmp' | 'flt', id: string) => fresh.has(`${kind}:${id}`);
  const newPeriod = spec.filters.some((f) => f.type === 'period' && isNew('flt', f.id));
  const gridRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!fresh.size) return;
    // a visual added to another page: show that page
    const target = spec.pages.find((p) => p.components.some((c) => isNew('cmp', c.id)));
    if (target && target.id !== page.id && !readOnly) onPage(target.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fresh]);
  useEffect(() => {
    if (fresh.size) gridRef.current?.querySelector('.just-added')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [fresh, page.id]);

  const move = (id: string, toPageId: string, beforeId: string | null) => {
    const s = clone();
    const from = s.pages.find((p) => p.components.some((c) => c.id === id))!;
    const comp = from.components.find((c) => c.id === id)!;
    from.components = from.components.filter((c) => c.id !== id);
    const to = s.pages.find((p) => p.id === toPageId)!;
    const idx = beforeId ? to.components.findIndex((c) => c.id === beforeId) : -1;
    if (idx >= 0) to.components.splice(idx, 0, comp);
    else to.components.push(comp);
    onChange(s, from.id === to.id ? `Rearranged "${comp.title}"` : `Moved "${comp.title}" to ${to.name}`);
  };
  const shift = (id: string, d: -1 | 1) => {
    const s = clone();
    const pg = s.pages.find((p) => p.id === page.id)!;
    const i = pg.components.findIndex((c) => c.id === id);
    const j = i + d;
    if (j < 0 || j >= pg.components.length) return;
    [pg.components[i], pg.components[j]] = [pg.components[j], pg.components[i]];
    onChange(s, `Rearranged "${pg.components[j].title}"`);
  };
  const remove = (id: string) => {
    const s = clone();
    const pg = s.pages.find((p) => p.id === page.id)!;
    const c = pg.components.find((x) => x.id === id)!;
    pg.components = pg.components.filter((x) => x.id !== id);
    onSelect(null);
    onChange(s, `Removed "${c.title}"`);
  };

  // the same layout as the development dashboard and the Power BI report
  const geoHere = !!spec.geoLevels?.pages.includes(page.id);
  const hasDates = foundation.tables.some((t) => t.name === 'Dim_Date');
  const filters = useMemo(() => spec.filters.filter((x) => x.type === 'multi' && x.field), [spec.filters]);
  const layout = useMemo(() => layoutPage(spec, page, { geo: geoHere, hasDates, filters, hasToggle }), [spec, page, geoHere, hasDates, filters]);
  const index = (c: DashComponent) => page.components.findIndex((x) => x.id === c.id);

  /** What the component shows, for the designer (type · measures · split). */
  const spec1 = (c: DashComponent) =>
    `${CHART_LABELS[c.type]} · ${c.measureIds.map(mname).join(', ')}${c.dimension ? ` by ${fieldLabel(foundation, c.dimension)}` : c.timeGrain && c.subDimension ? ` by ${c.timeGrain}` : ''}${c.subDimension ? ` › ${fieldLabel(foundation, c.subDimension)}` : ''}${c.series ? ` × ${fieldLabel(foundation, c.series)}` : ''}${c.timeGrain && c.type !== 'kpi' && !c.subDimension ? ` · ${c.timeGrain}ly` : ''}`;

  const component = (c: DashComponent): ReactNode => {
    const i = index(c);
    const excluded = [c.dimension, c.series, ...(c.tableColumns ?? [])].some((x) => x && !fieldIncluded(foundation, x));
    return (
      <div
        className="h-full"
        draggable={!readOnly}
        onDragStart={(e) => { setDragId(c.id); e.dataTransfer.effectAllowed = 'move'; }}
        onDragEnd={() => { setDragId(null); setOverId(null); }}
        onDragOver={(e) => { if (dragId && dragId !== c.id) { e.preventDefault(); e.stopPropagation(); setOverId(c.id); } }}
        onDragLeave={() => setOverId(null)}
        onDrop={(e) => { e.preventDefault(); e.stopPropagation(); if (dragId && dragId !== c.id) move(dragId, page.id, c.id); setDragId(null); setOverId(null); }}
        onClick={() => onSelect(c.id)}
        data-testid="wf-component"
        data-title={c.title}
      >
        <VisualBox
          title={c.title}
          subtitle={<span title={`${spec1(c)}${c.description ? ` — ${c.description}` : ''}`}>{c.description || spec1(c)}</span>}
          className={cx('cursor-pointer transition', isNew('cmp', c.id) && 'just-added just-added-shimmer', selected === c.id ? '!border-brand-500 ring-2 ring-brand-100' : 'hover:!border-brand-300', overId === c.id && '!border-l-4 !border-l-brand-500', dragId === c.id && 'opacity-40')}
        >
          {!readOnly && (
            <div className="absolute right-1.5 top-1.5 z-10 flex items-center gap-0.5 rounded-md bg-white/95 opacity-0 shadow-sm group-hover:opacity-100">
              <button onClick={(e) => { e.stopPropagation(); shift(c.id, -1); }} disabled={i === 0} className="rounded p-0.5 text-slate-400 hover:bg-slate-100 disabled:opacity-30" aria-label="Move earlier"><ArrowUp className="h-3 w-3" /></button>
              <button onClick={(e) => { e.stopPropagation(); shift(c.id, 1); }} disabled={i === page.components.length - 1} className="rounded p-0.5 text-slate-400 hover:bg-slate-100 disabled:opacity-30" aria-label="Move later"><ArrowDown className="h-3 w-3" /></button>
              <button onClick={(e) => { e.stopPropagation(); remove(c.id); }} className="rounded p-0.5 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label={`Remove ${c.title}`}><Trash2 className="h-3 w-3" /></button>
              <GripVertical className="h-3.5 w-3.5 cursor-grab text-slate-300" />
            </div>
          )}
          {excluded && <div className="mb-1 rounded bg-red-50 px-1.5 py-0.5 text-[0.625rem] font-medium text-red-700">Uses a field excluded in Field Mapping</div>}
          <Placeholder c={c} />
        </VisualBox>
      </div>
    );
  };

  const render = (it: LayoutItem): ReactNode => {
    switch (it.kind) {
      case 'banner':
        return <Banner />;
      case 'logo':
        return <Logo />;
      case 'tabs':
        return (
          <Tabs
            pages={spec.pages}
            activeId={page.id}
            onSelect={onPage}
            tabProps={(p) => ({
              onDragOver: (e) => { if (dragId && p.id !== page.id) e.preventDefault(); },
              onDrop: (e) => { e.preventDefault(); if (dragId) move(dragId, p.id, null); setDragId(null); },
              className: cx(isNew('page', p.id) && 'just-added-ring', dragId && p.id !== page.id && 'rounded-t bg-white/20'),
            })}
          />
        );
      case 'title':
        return <PageTitle page={page} />;
      case 'band':
        return <FilterBand />;
      case 'section':
        return <SectionHeading text={it.text} />;
      case 'slicer': {
        const s = it.slot;
        if (s.kind === 'geo') return <SlicerBox label="Geo Level" testId="wf-geo">{fakeDropdown(spec.geoLevels ? fieldLabel(foundation, spec.geoLevels.default).replace(/ Name$/, '') : '')}</SlicerBox>;
        if (s.kind === 'period') return <SlicerBox label="Time Period" testId="wf-period" className={cx(newPeriod && 'just-added')}>{fakeDropdown(PERIOD_LABELS[spec.defaultPeriod])}</SlicerBox>;
        if (s.kind === 'date') return <SlicerBox label="Custom Date" className={cx(newPeriod && 'just-added')}><div className="flex gap-1.5">{fakeDropdown('Start date')}{fakeDropdown('End date')}</div></SlicerBox>;
        if (s.kind === 'filter') return <SlicerBox label={s.filter.label || (s.filter.field ? fieldLabel(foundation, s.filter.field) : '')} testId="wf-filter" className={cx(isNew('flt', s.filter.id) && 'just-added')}>{fakeDropdown('All')}</SlicerBox>;
        return null;
      }
      case 'toggle':
        return <SlicerBox label={it.component.toggle!.label.replace(/ only$/i, '')}>{fakeDropdown('All')}</SlicerBox>;
      case 'component':
        return component(it.component);
    }
  };

  return (
    <div className="overflow-hidden rounded-xl border border-slate-300" style={{ background: C.page }} data-testid="wireframe">
      <div ref={gridRef}>
        <ReportCanvas
          height={layout.height}
          onDragOver={(e) => dragId && e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); if (dragId && !overId) move(dragId, page.id, null); setDragId(null); setOverId(null); }}
        >
          {layout.items.map((it, i) => (
            <div key={`${it.kind}-${'component' in it ? it.component.id : i}`} className="absolute" style={pos(it.box)}>
              {render(it)}
            </div>
          ))}
          {!page.components.length && <div className="absolute inset-x-4 rounded-[10px] border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500" style={{ top: 180 }}>Empty page — add components from the palette or drag them onto this page’s tab.</div>}
        </ReportCanvas>
      </div>
    </div>
  );
}
