import { Fragment, useState } from 'react';
import { GripVertical, Trash2, ArrowUp, ArrowDown, Calendar, ChevronDown } from 'lucide-react';
import type { DashComponent, DashboardSpec, Foundation } from '@/types';
import { cx } from '@/components/ui';
import { CARD_TYPES, CHART_LABELS, cardWeight } from '@/agents/designAgent';
import { PERIOD_LABELS } from '@/lib/dates';
import BrandLogo from '@/components/BrandLogo';
import { fieldIncluded, fieldLabel } from '@/lib/fieldLabels';
import { PALETTE_TINTS as T } from './format';

/** Grid span (of 60) for a card: consecutive cards in a section share the row in proportion to the values they show. */
function cardSpan(cs: DashComponent[], i: number) {
  const card = (k: number) => CARD_TYPES.includes(cs[k].type) && (k === i || cs[k].section === cs[i].section);
  let a = i;
  let b = i;
  while (a > 0 && card(a - 1)) a--;
  while (b < cs.length - 1 && card(b + 1)) b++;
  // wrap long runs: at most 6 weight units per row
  const run = cs.slice(a, b + 1);
  const rows: DashComponent[][] = [[]];
  for (const c of run) {
    const cur = rows[rows.length - 1];
    if (cur.length && (cur.reduce((s, x) => s + cardWeight(x), 0) + cardWeight(c) > 8 || cur.length >= 6)) rows.push([c]);
    else cur.push(c);
  }
  const row = rows.find((r) => r.includes(cs[i]))!;
  const total = row.reduce((s, x) => s + cardWeight(x), 0);
  return Math.max(6, Math.floor((60 * cardWeight(cs[i])) / total));
}

function Placeholder({ c }: { c: DashComponent }) {
  const bars = [62, 88, 45, 74, 55, 92, 38, 67];
  if (c.type === 'kpiGroup' || c.type === 'extremes') {
    const n = c.type === 'extremes' ? 2 : c.dimension ? 5 : Math.max(1, c.measureIds.length);
    return (
      <div className="grid divide-x divide-slate-200" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
        {Array.from({ length: n }, (_, i) => (
          <div key={i} className="px-1.5 first:pl-0">
            <div className="truncate text-[0.625rem] text-slate-400">{c.type === 'extremes' ? (i ? (c.lowIsBest ? 'Slowest' : 'Lowest') : c.lowIsBest ? 'Fastest' : 'Highest') : c.labels?.[i] ?? (c.dimension ? 'Category' : 'Value')}</div>
            <div className="mt-1 h-5 w-full max-w-[3.5rem] rounded bg-slate-200" />
          </div>
        ))}
      </div>
    );
  }
  if (c.type === 'records')
    return (
      <div className="space-y-1">
        <div className="flex gap-1.5 border-b border-slate-200 pb-1">{(c.tableColumns ?? []).slice(0, 9).map((k) => <div key={k} className="flex-1 truncate text-[0.5625rem] font-medium text-slate-400">{k.split('::')[1]?.replace(/_/g, ' ')}</div>)}</div>
        {[0, 1, 2, 3, 4].map((r) => <div key={r} className="flex gap-1.5">{(c.tableColumns ?? []).slice(0, 9).map((k) => <div key={k} className="h-2 flex-1 rounded bg-slate-100" />)}</div>)}
        {c.toggle && <div className="pt-1 text-[0.625rem] text-slate-400">Toggle: All · {c.toggle.label}</div>}
      </div>
    );
  if (c.type === 'scatter')
    return (
      <svg viewBox="0 0 200 80" className="h-28 w-full">
        <line x1="10" y1="72" x2="198" y2="72" stroke="#e2e8f0" /><line x1="10" y1="4" x2="10" y2="72" stroke="#e2e8f0" />
        {[[30, 50], [55, 30], [70, 58], [95, 22], [120, 44], [150, 18], [170, 60], [185, 36]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r="4" fill={T[0]} />)}
      </svg>
    );
  if (c.type === 'drilldown')
    return (
      <div className="flex gap-3 py-1">
        <div className="h-8 w-14 rounded bg-navy-800/80" />
        {(c.levels ?? []).map((k, i) => (
          <div key={k} className="flex-1 space-y-1">
            <div className="truncate text-[0.5625rem] font-medium text-slate-400">{k.split('::')[1]?.replace(/_/g, ' ')}</div>
            {[80, 55, 35].slice(0, i === 0 ? 3 : 2).map((w, j) => <div key={j} className="h-2 rounded-sm bg-brand-200" style={{ width: `${w}%` }} />)}
          </div>
        ))}
      </div>
    );
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
                <div className="flex-1" style={{ background: T[1] }} />
                <div className="flex-1" style={{ background: T[2] }} />
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
        <polyline fill={c.type === 'area' ? '#ecdcff' : 'none'} stroke={T[0]} strokeWidth="2" points="0,55 20,48 40,52 60,38 80,42 100,30 120,34 140,22 160,26 180,14 200,18" />
        {c.measureIds.length > 1 && <polyline fill="none" stroke={T[1]} strokeWidth="2" points="0,62 20,58 40,60 60,52 80,54 100,46 120,48 140,40 160,42 180,34 200,36" />}
        <line x1="0" y1="69" x2="200" y2="69" stroke="#e2e8f0" />
      </svg>
    );
  if (c.type === 'funnel')
    return (
      <div className="space-y-1.5 py-1">
        {[100, 72, 51, 38, 22].slice(0, Math.max(2, Math.min(5, c.measureIds.length))).map((w, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="h-2 w-16 rounded bg-slate-200" />
            <div className="h-4 rounded-sm" style={{ width: `${w * 0.75}%`, background: T[i] }} />
          </div>
        ))}
      </div>
    );
  if (c.type === 'donut')
    return (
      <div className="flex h-28 items-center justify-center gap-4">
        <div className="h-24 w-24 rounded-full" style={{ background: `conic-gradient(${T[0]} 0 45%, ${T[1]} 45% 75%, ${T[2]} 75% 100%)`, WebkitMask: 'radial-gradient(circle, transparent 52%, black 53%)', mask: 'radial-gradient(circle, transparent 52%, black 53%)' }} />
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
        <div className="flex items-center gap-4 rounded-t-xl bg-gradient-to-r from-brand-900 via-brand-700 to-brand-500 px-4">
          <div className="shrink-0 rounded-md bg-white px-2 py-1"><BrandLogo className="h-6" /></div>
          <div className="flex min-w-0 flex-1 flex-wrap justify-center gap-1">
            {spec.pages.map((p) => (
              <button
                key={p.id}
                onClick={() => onPage(p.id)}
                onDragOver={(e) => { if (dragId && p.id !== page.id) e.preventDefault(); }}
                onDrop={(e) => { e.preventDefault(); if (dragId) move(dragId, p.id, null); setDragId(null); }}
                className={cx('whitespace-nowrap border-b-2 px-2.5 py-3 text-[0.8125rem]', p.id === page.id ? 'border-white font-semibold text-white' : 'border-transparent text-white/75 hover:text-white', dragId && p.id !== page.id && 'rounded-t bg-white/20')}
              >
                {p.name} <span className="text-[0.625rem] text-white/60">({p.components.length})</span>
              </button>
            ))}
          </div>
          <div className="w-16 shrink-0" />
        </div>
        <div className="flex flex-wrap items-center gap-2 bg-brand-50/60 px-4 py-2.5">
          {spec.geoLevels?.pages.includes(page.id) && <span className="flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-600" data-testid="wf-geo">Geo Level: {fieldLabel(foundation, spec.geoLevels.default).replace(/ Name$/, '')}<ChevronDown className="h-3 w-3" /></span>}
          {spec.filters.filter((f) => f.type === 'multi').map((f) => (
            <span key={f.id} className="flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-600" data-testid="wf-filter">{f.label || (f.field ? fieldLabel(foundation, f.field) : '')}: All<ChevronDown className="h-3 w-3" /></span>
          ))}
          <span className="flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-600"><Calendar className="h-3 w-3" />{PERIOD_LABELS[spec.defaultPeriod]}<ChevronDown className="h-3 w-3" /></span>
        </div>
      </div>
      <div className="grid gap-3 p-4" style={{ gridTemplateColumns: 'repeat(60, minmax(0, 1fr))' }} onDragOver={(e) => dragId && e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (dragId && !overId) move(dragId, page.id, null); setDragId(null); setOverId(null); }}>
        {page.components.map((c, i) => (
          <Fragment key={c.id}>
          {c.section && c.section !== page.components[i - 1]?.section && <div style={{ gridColumn: 'span 60 / span 60' }} className="flex items-center gap-3 pt-1 text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-navy-800">{c.section}<span className="h-px flex-1 bg-slate-300/70" /></div>}
          <div
            style={{ gridColumn: `span ${CARD_TYPES.includes(c.type) ? cardSpan(page.components, i) : c.width * 5} / span ${CARD_TYPES.includes(c.type) ? cardSpan(page.components, i) : c.width * 5}` }}
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
                <div className="truncate text-[0.625rem] text-slate-500">{CHART_LABELS[c.type]} · {c.measureIds.map(mname).join(', ')}{c.levels ? ` · ${c.levels.map((x) => fieldLabel(foundation, x)).join(' › ')}` : c.dimension ? ` by ${fieldLabel(foundation, c.dimension)}` : c.timeGrain && c.subDimension ? ` by ${c.timeGrain}` : ''}{c.subDimension ? ` › ${fieldLabel(foundation, c.subDimension)}` : ''}{c.series ? ` × ${fieldLabel(foundation, c.series)}` : ''}{c.timeGrain && c.type !== 'kpi' && !c.subDimension ? ` · ${c.timeGrain}ly` : ''}</div>
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
