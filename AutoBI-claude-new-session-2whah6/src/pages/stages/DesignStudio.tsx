import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Save, RefreshCw, Plus, PenTool, History, Trash2, Lock } from 'lucide-react';
import type { ComponentType, DashComponent, DashboardSpec, PeriodPreset, Project, TimeGrain } from '@/types';
import StageLayout from '@/components/StageLayout';
import Chat from '@/components/Chat';
import { Button, Callout, Card, Badge, Field, Modal, Empty } from '@/components/ui';
import Wireframe from '@/dashboard/Wireframe';
import DashboardView from '@/dashboard/DashboardView';
import { approveDesign, designCommand, isRunning, runDesignAgent, saveDesignDraft, updateDesign } from '@/store/orchestrator';
import { CHART_LABELS, TEMPLATE_TYPES, designStats } from '@/agents/designAgent';
import { useEngine } from '@/store/engineCache';
import { PERIOD_LABELS } from '@/lib/dates';
import { ref } from '@/lib/engine';
import { fieldLabel, visibleProfiles } from '@/lib/fieldLabels';
import { fmtDateTime, humanize, uid } from '@/lib/util';

export default function DesignStage({ p }: { p: Project }) {
  const nav = useNavigate();
  const d = p.design;
  const busy = isRunning(p, 'design');
  const engine = useEngine(p);
  const [pageId, setPageId] = useState(d?.spec.pages[0]?.id ?? '');
  const [sel, setSel] = useState<string | null>(null);
  // the data-bound preview lives on the Development page; the studio shows the wireframe
  const [view] = useState<'wire' | 'data'>('wire');
  const [adding, setAdding] = useState(false);
  const [versions, setVersions] = useState(false);
  const [newFilter, setNewFilter] = useState('');
  const f = p.foundation!;
  const u = p.understanding!;

  if (!d)
    return <StageLayout p={p} agent="design" main={busy ? null : <Empty icon={<PenTool className="h-5 w-5" />} title="No wireframe yet" action={<Button variant="primary" onClick={() => runDesignAgent(p.id)}>Generate wireframe</Button>}>The Dashboard Design Agent will propose a multi-page dashboard from the approved requirements and reporting foundation.</Empty>} />;

  const spec = d.spec;
  const page = spec.pages.find((x) => x.id === pageId) ?? spec.pages[0];
  const comp = spec.pages.flatMap((x) => x.components).find((c) => c.id === sel);
  const change = (s: DashboardSpec, note: string) => updateDesign(p.id, s, note);
  const editComp = (patch: Partial<DashComponent>, note: string) => {
    const s: DashboardSpec = JSON.parse(JSON.stringify(spec));
    const c = s.pages.flatMap((x) => x.components).find((x) => x.id === sel)!;
    Object.assign(c, patch);
    change(s, note);
  };
  const dims = visibleProfiles(u.profiles, f).flatMap((pr) => pr.columns.filter((c) => ['dimension', 'status', 'attribute', 'foreign_key'].includes(c.role)).map((c) => ({ ref: ref(pr.datasetId, c.name), label: `${fieldLabel(f, ref(pr.datasetId, c.name))} · ${pr.label}` })));
  const allCols = visibleProfiles(u.profiles, f).flatMap((pr) => pr.columns.map((c) => ({ ref: ref(pr.datasetId, c.name), label: `${fieldLabel(f, ref(pr.datasetId, c.name))} · ${pr.label}` })));
  const stats = designStats(spec);
  const approved = d.status === 'approved';
  const foundationOk = p.stages.foundation.status === 'approved';

  const main = (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-navy-900"><PenTool className="h-4 w-4 text-brand-600" />Wireframe</div>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button size="sm" icon={<Save className="h-3.5 w-3.5" />} onClick={() => saveDesignDraft(p.id)} disabled={approved}>Save as Draft</Button>
          {approved ? (
            <Button size="sm" variant="primary" onClick={() => nav(`/p/${p.id}/development`)}>Go to Development →</Button>
          ) : (
            <Button size="sm" variant="success" icon={<CheckCircle2 className="h-3.5 w-3.5" />} disabled={!foundationOk} title={foundationOk ? '' : 'Approve the reporting foundation first'} onClick={() => approveDesign(p.id) && nav(`/p/${p.id}/development`)}>Approve Design & Start Development</Button>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <Badge tone={approved ? 'green' : 'amber'}>{approved ? <><Lock className="h-3 w-3" /> v{d.version} approved</> : `Draft v${d.version}`}</Badge>
        <span>{stats.pages} pages · {stats.kpis} KPIs · {stats.charts} charts · {stats.tables} tables{approved && ' · editing creates a new draft for re-approval'}</span>
        <span className="ml-auto flex gap-1">
          <Button size="xs" variant="ghost" icon={<RefreshCw className="h-3 w-3" />} loading={busy} onClick={() => confirm('Regenerate the wireframe from scratch? The current version is kept in history.') && runDesignAgent(p.id)}>Regenerate</Button>
          <Button size="xs" variant="ghost" icon={<History className="h-3 w-3" />} onClick={() => setVersions(true)}>Versions ({p.versions.design.length})</Button>
        </span>
      </div>
      {!foundationOk && <Callout tone="warning" title="Reporting foundation not yet approved">You can iterate on the design, but approval requires the reporting foundation to be reviewed and approved first.</Callout>}

      {view === 'wire' ? (
        <Wireframe spec={spec} foundation={f} pageId={page.id} onPage={setPageId} selected={sel} onSelect={setSel} onChange={change} />
      ) : engine ? (
        <DashboardView spec={spec} engine={engine} foundation={f} />
      ) : null}

      <details className="card px-4 py-3">
        <summary className="cursor-pointer text-sm font-medium text-slate-700">Pages, filters & defaults</summary>
      <div className="mt-3 grid gap-4 lg:grid-cols-2">
        <Card title="Pages" actions={<Button size="xs" icon={<Plus className="h-3 w-3" />} onClick={() => { const name = prompt('New page name'); if (name) { const s: DashboardSpec = JSON.parse(JSON.stringify(spec)); const id = uid('pg'); s.pages.push({ id, name, description: 'User-added page', components: [] }); change(s, `Added page "${name}"`); setPageId(id); } }}>Add page</Button>}>
          <ul className="space-y-1.5">
            {spec.pages.map((pg) => (
              <li key={pg.id} className="flex items-center gap-2">
                <input className="input py-1 text-sm" defaultValue={pg.name} key={pg.name} onBlur={(e) => { if (e.target.value && e.target.value !== pg.name) { const s: DashboardSpec = JSON.parse(JSON.stringify(spec)); s.pages.find((x) => x.id === pg.id)!.name = e.target.value; change(s, `Renamed page to "${e.target.value}"`); } }} aria-label="Page name" />
                <span className="w-10 text-right text-[0.6875rem] text-slate-400">{pg.components.length}</span>
                <Button size="xs" variant="ghost" icon={<Trash2 className="h-3 w-3" />} disabled={spec.pages.length === 1} onClick={() => { if (confirm(`Delete page "${pg.name}"?`)) { const s: DashboardSpec = JSON.parse(JSON.stringify(spec)); s.pages = s.pages.filter((x) => x.id !== pg.id); change(s, `Deleted page "${pg.name}"`); setPageId(s.pages[0].id); } }} aria-label={`Delete page ${pg.name}`} />
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Filters & defaults">
          <ul className="mb-2 flex flex-wrap gap-1.5">
            {spec.filters.map((x) => (
              <li key={x.id} className="chip bg-slate-100 text-slate-700">
                {x.field ? fieldLabel(f, x.field) : x.label}
                {x.type !== 'period' && <button onClick={() => { const s: DashboardSpec = JSON.parse(JSON.stringify(spec)); s.filters = s.filters.filter((y) => y.id !== x.id); change(s, `Removed ${x.label} filter`); }} aria-label={`Remove ${x.label} filter`}><Trash2 className="h-3 w-3 text-slate-400 hover:text-red-600" /></button>}
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <select className="input py-1 text-xs" value={newFilter} onChange={(e) => setNewFilter(e.target.value)} aria-label="Add filter field"><option value="">Add a filter…</option>{dims.filter((x) => !spec.filters.some((y) => y.field === x.ref)).map((x) => <option key={x.ref} value={x.ref}>{x.label}</option>)}</select>
            <Button size="sm" disabled={!newFilter} onClick={() => { const s: DashboardSpec = JSON.parse(JSON.stringify(spec)); const lbl = fieldLabel(f, newFilter); s.filters.push({ id: uid('flt'), label: lbl, type: 'multi', field: newFilter }); change(s, `Added ${lbl} filter`); setNewFilter(''); }}>Add</Button>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Field label="Default period"><select className="input py-1 text-xs" value={spec.defaultPeriod} onChange={(e) => change({ ...spec, defaultPeriod: e.target.value as PeriodPreset }, `Default period → ${e.target.value}`)}>{(Object.keys(PERIOD_LABELS) as PeriodPreset[]).filter((x) => x !== 'custom').map((x) => <option key={x} value={x}>{PERIOD_LABELS[x]}</option>)}</select></Field>
            <Field label="Trend grain"><select className="input py-1 text-xs" value={spec.timeGrain} onChange={(e) => change({ ...spec, timeGrain: e.target.value as TimeGrain }, `Trend grain → ${e.target.value}`)}>{['week', 'month', 'quarter'].map((x) => <option key={x}>{x}</option>)}</select></Field>
          </div>
        </Card>
      </div>
      </details>
    </>
  );

  const side = (
    <>
      {comp ? (
        <Card title="Component properties" actions={<Button size="xs" variant="ghost" onClick={() => setSel(null)}>Close</Button>}>
          <div className="space-y-2.5">
            <Field label="Title"><input className="input py-1.5 text-sm" key={comp.id + comp.title} defaultValue={comp.title} onBlur={(e) => e.target.value !== comp.title && editComp({ title: e.target.value }, `Renamed visual to "${e.target.value}"`)} /></Field>
            <Field label="Business description"><textarea className="input py-1.5 text-xs" rows={2} key={comp.id + 'd'} defaultValue={comp.description} onBlur={(e) => e.target.value !== comp.description && editComp({ description: e.target.value }, `Updated description of "${comp.title}"`)} /></Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Visual type">
                {TEMPLATE_TYPES.includes(comp.type) ? (
                  <select className="input py-1 text-xs" value={comp.type} disabled title="Built from the ProcDNA FRM template"><option value={comp.type}>{CHART_LABELS[comp.type]}</option></select>
                ) : (
                  <select className="input py-1 text-xs" value={comp.type} onChange={(e) => { const t = e.target.value as ComponentType; if (['bar', 'hbar', 'donut', 'stacked', 'table'].includes(t) && !comp.dimension) { alert('This visual needs a category dimension first.'); return; } editComp({ type: t, ...(t === 'line' || t === 'area' ? { timeGrain: comp.timeGrain ?? spec.timeGrain } : {}), ...(t === 'stacked' && !comp.series ? { series: dims[0]?.ref } : {}) }, `Changed "${comp.title}" to ${CHART_LABELS[t]}`); }}>{(Object.keys(CHART_LABELS) as ComponentType[]).filter((t) => !TEMPLATE_TYPES.includes(t)).map((t) => <option key={t} value={t}>{CHART_LABELS[t]}</option>)}</select>
                )}
              </Field>
              <Field label="Width"><select className="input py-1 text-xs" value={comp.width} onChange={(e) => editComp({ width: Number(e.target.value) as DashComponent['width'] }, `Resized "${comp.title}"`)}>{[3, 4, 6, 8, 12].map((w) => <option key={w} value={w}>{w}/12</option>)}</select></Field>
            </div>
            <Field label="Measure(s)">
              <select multiple className="input h-28 py-1 text-xs" value={comp.measureIds} onChange={(e) => { const v = Array.from(e.target.selectedOptions).map((o) => o.value); if (v.length) editComp({ measureIds: comp.type === 'scatter' ? v.slice(0, 2) : (comp.type === 'kpiGroup' && !comp.dimension) || ['line', 'area', 'table', 'funnel'].includes(comp.type) ? v : v.slice(0, 1) }, `Changed measures of "${comp.title}"`); }}>
                {f.measures.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </Field>
            {!['kpi', 'line', 'area', 'records', 'drilldown', 'funnel'].includes(comp.type) && (comp.type !== 'kpiGroup' || comp.dimension) && (
              <Field label="Category dimension"><select className="input py-1 text-xs" value={comp.dimension ?? ''} onChange={(e) => editComp({ dimension: e.target.value }, `Changed dimension of "${comp.title}"`)}>{dims.map((x) => <option key={x.ref} value={x.ref}>{x.label}</option>)}</select></Field>
            )}
            {comp.type === 'drilldown' && <Field label="Drill levels (outermost first)"><select multiple className="input h-24 py-1 text-xs" value={comp.levels ?? []} onChange={(e) => { const v = Array.from(e.target.selectedOptions).map((o) => o.value); if (v.length) editComp({ levels: v, dimension: v[0] }, `Changed drill levels of "${comp.title}"`); }}>{dims.map((x) => <option key={x.ref} value={x.ref}>{x.label}</option>)}</select></Field>}
            {comp.type === 'records' && <Field label="Columns"><select multiple className="input h-32 py-1 text-xs" value={comp.tableColumns ?? []} onChange={(e) => editComp({ tableColumns: Array.from(e.target.selectedOptions).map((o) => o.value) }, `Changed columns of "${comp.title}"`)}>{allCols.map((x) => <option key={x.ref} value={x.ref}>{x.label}</option>)}</select></Field>}
            {comp.type === 'stacked' && <Field label="Series (stack by)"><select className="input py-1 text-xs" value={comp.series ?? ''} onChange={(e) => editComp({ series: e.target.value }, `Changed series of "${comp.title}"`)}>{dims.map((x) => <option key={x.ref} value={x.ref}>{x.label}</option>)}</select></Field>}
            {(comp.type === 'line' || comp.type === 'area') && <Field label="Time grain"><select className="input py-1 text-xs" value={comp.timeGrain ?? spec.timeGrain} onChange={(e) => editComp({ timeGrain: e.target.value as TimeGrain }, `Changed grain of "${comp.title}"`)}>{['week', 'month', 'quarter'].map((x) => <option key={x}>{x}</option>)}</select></Field>}
            {comp.type === 'kpi' && <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={!!comp.comparison} onChange={(e) => editComp({ comparison: e.target.checked }, `${e.target.checked ? 'Enabled' : 'Disabled'} period comparison on "${comp.title}"`)} />Show current vs previous period</label>}
            {comp.type === 'table' && <Field label="Attribute columns"><select multiple className="input h-24 py-1 text-xs" value={comp.tableColumns ?? []} onChange={(e) => editComp({ tableColumns: Array.from(e.target.selectedOptions).map((o) => o.value) }, `Changed columns of "${comp.title}"`)}>{dims.map((x) => <option key={x.ref} value={x.ref}>{x.label}</option>)}</select></Field>}
            <Field label="Move to page"><select className="input py-1 text-xs" value={spec.pages.find((pg) => pg.components.some((c) => c.id === comp.id))?.id} onChange={(e) => { const s: DashboardSpec = JSON.parse(JSON.stringify(spec)); const from = s.pages.find((pg) => pg.components.some((c) => c.id === comp.id))!; const c = from.components.find((x) => x.id === comp.id)!; from.components = from.components.filter((x) => x.id !== comp.id); const to = s.pages.find((pg) => pg.id === e.target.value)!; to.components.push(c); change(s, `Moved "${c.title}" to ${to.name}`); setPageId(to.id); }}>{spec.pages.map((pg) => <option key={pg.id} value={pg.id}>{pg.name}</option>)}</select></Field>
          </div>
        </Card>
      ) : (
        <Card title="Component palette" subtitle="Click a component in the wireframe to edit it, drag to rearrange, or drop on a page tab to move it.">
          <Button size="sm" variant="subtle" className="w-full" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setAdding(true)}>Add component to “{page.name}”</Button>
        </Card>
      )}
      <Chat title="Design assistant" messages={p.designChat} busy={busy} placeholder="Modify this dashboard design…" onSend={(t) => designCommand(p.id, t, page.id)} suggestions={spec.pages.some((x) => x.template === 'frm') ? ['Add a specialty filter', 'Make Open Case Aging full width', 'Rename Priority Prescribers to Priority HCPs'] : ['Add a weekly comparison', 'Remove the state filter', 'Replace the pie chart with a bar chart']} />
    </>
  );

  return (
    <>
      <StageLayout p={p} agent="design" main={main} side={side} />
      {adding && <AddComponent p={p} onClose={() => setAdding(false)} onAdd={(c) => { const s: DashboardSpec = JSON.parse(JSON.stringify(spec)); s.pages.find((x) => x.id === page.id)!.components.push(c); change(s, `Added ${CHART_LABELS[c.type]} "${c.title}" to ${page.name}`); setSel(c.id); setAdding(false); }} dims={dims} />}
      <Modal open={versions} onClose={() => setVersions(false)} title="Design version history">
        <ul className="space-y-2">
          {[...p.versions.design].reverse().map((v, i) => (
            <li key={i} className="flex items-start justify-between rounded-lg border border-slate-200 p-3 text-sm">
              <div><b>v{v.version}</b> <span className="text-xs text-slate-500">· {fmtDateTime(v.at)} · {v.note}</span><div className="text-xs text-slate-500">{designStats(v.snapshot).pages} pages · {designStats(v.snapshot).kpis} KPIs · {designStats(v.snapshot).charts} charts</div></div>
              <div className="flex flex-col items-end gap-1">
                <Badge tone={v.status === 'approved' ? 'green' : v.status === 'draft' ? 'amber' : 'slate'}>{v.status}</Badge>
                {v.version !== d.version && <Button size="xs" variant="ghost" onClick={() => { if (confirm(`Restore v${v.version} as a new draft?`)) { change(JSON.parse(JSON.stringify(v.snapshot)), `Restored design from v${v.version}`); setVersions(false); } }}>Restore as draft</Button>}
              </div>
            </li>
          ))}
        </ul>
      </Modal>
    </>
  );
}

function AddComponent({ p, onClose, onAdd, dims }: { p: Project; onClose: () => void; onAdd: (c: DashComponent) => void; dims: { ref: string; label: string }[] }) {
  const f = p.foundation!;
  const [type, setType] = useState<ComponentType>('kpi');
  const [mid, setMid] = useState(f.measures[0]?.id ?? '');
  const [dim, setDim] = useState(dims[0]?.ref ?? '');
  const [title, setTitle] = useState('');
  const needsDim = ['bar', 'hbar', 'donut', 'stacked', 'table'].includes(type);
  const m = f.measures.find((x) => x.id === mid);
  const auto = needsDim ? `${m?.name ?? ''} by ${humanize(dim.split('::')[1] ?? '')}` : m?.name ?? '';
  return (
    <Modal open onClose={onClose} title="Add component" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!mid} onClick={() => onAdd({ id: uid('cmp'), type, title: title || auto, description: '', measureIds: [mid], dimension: needsDim ? dim : undefined, series: type === 'stacked' ? dims.find((x) => x.ref !== dim)?.ref : undefined, timeGrain: type === 'line' || type === 'area' ? p.design!.spec.timeGrain : undefined, comparison: type === 'kpi', width: type === 'kpi' ? 3 : type === 'table' ? 12 : 6, tableColumns: type === 'table' ? [] : undefined })}>Add</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Visual type"><select className="input" value={type} onChange={(e) => setType(e.target.value as ComponentType)}>{(Object.keys(CHART_LABELS) as ComponentType[]).filter((t) => !TEMPLATE_TYPES.includes(t)).map((t) => <option key={t} value={t}>{CHART_LABELS[t]}</option>)}</select></Field>
        <Field label="Measure"><select className="input" value={mid} onChange={(e) => setMid(e.target.value)}>{f.measures.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
        {needsDim && <div className="sm:col-span-2"><Field label="Category dimension"><select className="input" value={dim} onChange={(e) => setDim(e.target.value)}>{dims.map((x) => <option key={x.ref} value={x.ref}>{x.label}</option>)}</select></Field></div>}
        <div className="sm:col-span-2"><Field label="Title" hint={`Default: ${auto}`}><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={auto} /></Field></div>
      </div>
    </Modal>
  );
}
