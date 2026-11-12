import { Fragment, useState } from 'react';
import { GripVertical, Trash2, ArrowUp, ArrowDown, Calendar, ChevronDown } from 'lucide-react';
import type { DashComponent, DashboardSpec, Foundation } from '@/types';
import { cx } from '@/components/ui';
import { CHART_LABELS } from '@/agents/designAgent';
import { PERIOD_LABELS } from '@/lib/dates';
import BrandLogo from '@/components/BrandLogo';
import { fieldIncluded, fieldLabel } from '@/lib/fieldLabels';

/** Length of the run of consecutive KPI cards containing index i (KPI rows share the full width). */
function kpiRun(cs: DashComponent[], i: number) {
  let a = i;
  let b = i;
  while (a > 0 && cs[a - 1].type === 'kpi') a--;
  while (b < cs.length - 1 && cs[b + 1].type === 'kpi') b++;
  return Math.min(6, b - a + 1);
}

function Placeholder({ c }: { c: DashComponent }) {
  const bars = [62, 88, 45, 74, 55, 92, 38, 67];
  if (c.type === 'kpi')
    return (
      <div>
        <div className="h-6 w-24 rounded bg-slate-200" />
        {c.comparison && <div className="mt-1.5 h-2.5 w-20 rounded bg-emerald-100" />}
      </div>
    );
  if (c.type === 'bar' || c.type === 'stacked')
    return (
      <div className="flex h-28 items-end gap-1.5 border-b border-l border-slate-200 px-2">
        {bars.slice(0, 6).map((h, i) => (
          <div key={i} className="flex flex-1 flex-col justify-end" style={{ height: `${h}%` }}>
            {c.type === 'stacked' ? (
              <>
                <div className="flex-[2] rounded-t-sm bg-brand-200" />
                <div className="flex-1 bg-sky-200" />
                <div className="flex-1 bg-teal-200" />
              </>
            ) : <div className="h-full rounded-t-sm bg-brand-200" />}
          </div>
        ))}
      </div>
    );
  if (c.type === 'hbar')
    return (
      <div className="space-y-1.5 py-1">
        {bars.slice(0, 6).map((h, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="h-2 w-14 rounded bg-slate-200" />
            <div className="h-3 rounded-r-sm bg-brand-200" style={{ width: `${h * 0.7}%` }} />
          </div>
        ))}
      </div>
    );
  if (c.type === 'line' || c.type === 'area')
    return (
      <svg viewBox="0 0 200 70" className="h-28 w-full">
        <polyline fill={c.type === 'area' ? '#dbe6fe' : 'none'} stroke="#93b4fd" strokeWidth="2" points="0,55 20,48 40,52 60,38 80,42 100,30 120,34 140,22 160,26 180,14 200,18" />
        {c.measureIds.length > 1 && <polyline fill="none" stroke="#7dd3fc" strokeWidth="2" points="0,62 20,58 40,60 60,52 80,54 100,46 120,48 140,40 160,42 180,34 200,36" />}
        <line x1="0" y1="69" x2="200" y2="69" stroke="#e2e8f0" />
      </svg>
    );
  if (c.type === 'funnel')
    return (
      <div className="space-y-1.5 py-1">
        {[100, 72, 51, 38, 22].slice(0, Math.max(2, Math.min(5, c.measureIds.length))).map((w, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="h-2 w-16 rounded bg-slate-200" />
            <div className="h-4 rounded-sm" style={{ width: `${w * 0.75}%`, background: ['#93b4fd', '#7dd3fc', '#5eead4', '#fcd34d', '#c4b5fd'][i] }} />
          </div>
        ))}
      </div>
    );
  if (c.type === 'donut')
    return (
      <div className="flex h-28 items-center justify-center gap-4">
        <div className="h-24 w-24 rounded-full" style={{ background: 'conic-gradient(#93b4fd 0 45%, #7dd3fc 45% 75%, #5eead4 75% 100%)', WebkitMask: 'radial-gradient(circle, transparent 52%, black 53%)', mask: 'radial-gradient(circle, transparent 52%, black 53%)' }} />
        <div className="space-y-1">{[0, 1, 2].map((i) => <div key={i} className="h-2 w-12 rounded bg-slate-200" />)}</div>
      </div>
    );
  return (
    <div className="space-y-1">
      <div className="flex gap-2 border-b border-slate-200 pb-1">{[30, 16, 16, 14, 14].map((w, i) => <div key={i} className="h-2.5 rounded bg-slate-300" style={{ width: `${w}%` }} />)}</div>
      {[0, 1, 2, 3, 4].map((r) => <div key={r} className="flex gap-2">{[30, 16, 16, 14, 14].map((w, i) => <div key={i} className="h-2 rounded bg-slate-100" style={{ width: `${w}%` }} />)}</div>)}
    </div>
  );
}

export default function Wireframe({ spec, foundation, pageId, onPage, selected, onSelect, onChange, readOnly }: { spec: DashboardSpec; foundation: Foundation; pageId: string; onPage: (id: string) => void; selected: string | null; onSelect: (id: string | null) => void; onChange: (spec: DashboardSpec, note: string) => void; readOnly?: boolean }) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const page = spec.pages.find((p) => p.id === pageId) ?? spec.pages[0];
  const mname = (id: string) => foundation.measures.find((m) => m.id === id)?.name ?? '⚠ missing KPI';
  const clone = () => JSON.parse(JSON.stringify(spec)) as DashboardSpec;

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

  return (
    <div className="rounded-xl border border-slate-300 bg-slate-100" data-testid="wireframe">
      <div className="rounded-t-xl border-b border-slate-200 bg-white">
        <div className="flex items-end justify-between gap-4 border-b border-slate-200 px-4 pt-2">
          <div className="-mb-px flex min-w-0 flex-wrap gap-1">
            {spec.pages.map((p) => (
              <button
                key={p.id}
                onClick={() => onPage(p.id)}
                onDragOver={(e) => { if (dragId && p.id !== page.id) e.preventDefault(); }}
                onDrop={(e) => { e.preventDefault(); if (dragId) move(dragId, p.id, null); setDragId(null); }}
                className={cx('whitespace-nowrap border-b-2 px-2.5 py-2.5 text-[0.8125rem] font-medium', p.id === page.id ? 'border-brand-600 text-navy-900' : 'border-transparent text-slate-500 hover:text-slate-800', dragId && p.id !== page.id && 'rounded-t bg-brand-50')}
              >
                {p.name} <span className="text-[0.625rem] text-slate-400">({p.components.length})</span>
              </button>
            ))}
          </div>
          <BrandLogo className="mb-1 shrink-0" />
        </div>
        <div className="flex flex-wrap items-center gap-2 px-4 py-2.5">
          <span className="flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1 text-xs text-slate-600"><Calendar className="h-3 w-3" />{PERIOD_LABELS[spec.defaultPeriod]}<ChevronDown className="h-3 w-3" /></span>
          {spec.filters.filter((f) => f.type === 'multi').map((f) => (
            <span key={f.id} className="flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1 text-xs text-slate-600" data-testid="wf-filter">{f.field ? fieldLabel(foundation, f.field) : f.label}: All<ChevronDown className="h-3 w-3" /></span>
          ))}
        </div>
      </div>
      <div className="grid gap-3 p-4" style={{ gridTemplateColumns: 'repeat(60, minmax(0, 1fr))' }} onDragOver={(e) => dragId && e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (dragId && !overId) move(dragId, page.id, null); setDragId(null); setOverId(null); }}>
        {page.components.map((c, i) => (
          <Fragment key={c.id}>
          {c.section && c.section !== page.components[i - 1]?.section && <div style={{ gridColumn: 'span 60 / span 60' }} className="flex items-center gap-3 pt-1 text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-navy-800">{c.section}<span className="h-px flex-1 bg-slate-300/70" /></div>}
          <div
            style={{ gridColumn: `span ${c.type === 'kpi' ? Math.floor(60 / kpiRun(page.components, i)) : c.width * 5} / span ${c.type === 'kpi' ? Math.floor(60 / kpiRun(page.components, i)) : c.width * 5}` }}
            key={c.id}
            draggable={!readOnly}
            onDragStart={(e) => { setDragId(c.id); e.dataTransfer.effectAllowed = 'move'; }}
            onDragEnd={() => { setDragId(null); setOverId(null); }}
            onDragOver={(e) => { if (dragId && dragId !== c.id) { e.preventDefault(); e.stopPropagation(); setOverId(c.id); } }}
            onDragLeave={() => setOverId(null)}
            onDrop={(e) => { e.preventDefault(); e.stopPropagation(); if (dragId && dragId !== c.id) move(dragId, page.id, c.id); setDragId(null); setOverId(null); }}
            onClick={() => onSelect(c.id)}
            className={cx('group relative cursor-pointer rounded-xl border bg-white p-3 transition', selected === c.id ? 'border-brand-500 ring-2 ring-brand-100' : 'border-slate-200 hover:border-brand-300', overId === c.id && 'border-l-4 border-l-brand-500', dragId === c.id && 'opacity-40')}
            data-testid="wf-component"
            data-title={c.title}
          >
            <div className="mb-2 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-[0.8125rem] font-semibold text-navy-900">{c.title}</div>
                <div className="truncate text-[0.625rem] text-slate-500">{CHART_LABELS[c.type]} · {c.measureIds.map(mname).join(', ')}{c.dimension ? ` by ${fieldLabel(foundation, c.dimension)}` : ''}{c.series ? ` × ${fieldLabel(foundation, c.series)}` : ''}{c.timeGrain && c.type !== 'kpi' ? ` · ${c.timeGrain}ly` : ''}</div>
              </div>
              {!readOnly && (
                <div className="absolute right-1.5 top-1.5 flex items-center gap-0.5 rounded-md bg-white/95 opacity-0 shadow-sm group-hover:opacity-100">
                  <button onClick={(e) => { e.stopPropagation(); shift(c.id, -1); }} disabled={i === 0} className="rounded p-0.5 text-slate-400 hover:bg-slate-100 disabled:opacity-30" aria-label="Move earlier"><ArrowUp className="h-3 w-3" /></button>
                  <button onClick={(e) => { e.stopPropagation(); shift(c.id, 1); }} disabled={i === page.components.length - 1} className="rounded p-0.5 text-slate-400 hover:bg-slate-100 disabled:opacity-30" aria-label="Move later"><ArrowDown className="h-3 w-3" /></button>
                  <button onClick={(e) => { e.stopPropagation(); remove(c.id); }} className="rounded p-0.5 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label={`Remove ${c.title}`}><Trash2 className="h-3 w-3" /></button>
                  <GripVertical className="h-3.5 w-3.5 cursor-grab text-slate-300" />
                </div>
              )}
            </div>
            {[c.dimension, c.series, ...(c.tableColumns ?? [])].some((x) => x && !fieldIncluded(foundation, x)) && <div className="mb-1.5 rounded bg-red-50 px-1.5 py-0.5 text-[0.625rem] font-medium text-red-700">Uses a field excluded in Field Mapping</div>}
            <Placeholder c={c} />
            {c.description && <div className="mt-2 line-clamp-2 text-[0.625rem] italic text-slate-400">{c.description}</div>}
          </div>
          </Fragment>
        ))}
        {!page.components.length && <div style={{ gridColumn: 'span 60 / span 60' }} className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">Empty page — add components from the palette or drag them onto this page’s tab.</div>}
      </div>
    </div>
  );
}
