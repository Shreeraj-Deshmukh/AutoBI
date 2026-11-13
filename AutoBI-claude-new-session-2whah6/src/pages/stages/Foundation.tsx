import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Plus, Pencil, Trash2, RefreshCw, AlertTriangle, Sparkles } from 'lucide-react';
import type { MeasureDef, Project } from '@/types';
import StageLayout from '@/components/StageLayout';
import { Button, Callout, Card, Badge, Tabs, Modal, Field, Empty, cx } from '@/components/ui';
import { approveFoundation, defineKpiFromText, deleteMeasure, isRunning, runFoundationAgent, updateFieldMap, updateMeasure } from '@/store/orchestrator';
import { useEngine } from '@/store/engineCache';
import { emptyFilters } from '@/lib/engine';
import { fmtNumber, uid } from '@/lib/util';
import { prettify } from '@/lib/fieldLabels';
import { KPI_CATALOGUE } from '@/config/kpiCatalogue';

type Tab = 'model' | 'mapping' | 'kpis' | 'catalogue';

export default function FoundationStage({ p }: { p: Project }) {
  const nav = useNavigate();
  const [tab, setTab] = useState<Tab>('model');
  const [editing, setEditing] = useState<MeasureDef | null>(null);
  const busy = isRunning(p, 'foundation');
  const f = p.foundation;
  const u = p.understanding!;
  const engine = useEngine(p);
  const label = (id: string) => u.profiles.find((x) => x.datasetId === id)?.label ?? id;
  const approved = p.stages.foundation.status === 'approved';

  const main = !f ? (
    <Empty title="No reporting foundation yet" action={<Button variant="primary" loading={busy} onClick={() => runFoundationAgent(p.id)}>Run Reporting Foundation Agent</Button>}>The agent proposes a logical reporting model from the confirmed data understanding.</Empty>
  ) : (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Tabs<Tab> className="flex-1" value={tab} onChange={setTab} tabs={[{ id: 'model', label: 'Data model' }, { id: 'kpis', label: 'KPI Definitions', count: f.measures.length }, { id: 'mapping', label: 'Field Mapping', count: f.fieldMaps.length }, ...(f.catalogue?.length ? [{ id: 'catalogue' as const, label: 'ProcDNA KPI Catalogue', count: f.catalogue.filter((c) => c.status !== 'needs_data').length }] : [])]} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" icon={<RefreshCw className="h-3.5 w-3.5" />} loading={busy} onClick={() => confirm('Regenerate the foundation? User edits to KPIs will be replaced by a new proposal (previous versions are kept in history).') && runFoundationAgent(p.id)}>Regenerate</Button>
        <span className="self-center text-xs text-slate-500">v{p.foundationVersion} · logical model only — no data mart is built; joins run at query time</span>
        <div className="ml-auto">
          {approved ? <Button size="sm" variant="primary" onClick={() => nav(`/p/${p.id}/design`)}>Continue to Design Studio →</Button> : <Button size="sm" variant="success" icon={<CheckCircle2 className="h-3.5 w-3.5" />} onClick={() => { approveFoundation(p.id); nav(`/p/${p.id}/design`); }}>Approve Reporting Foundation</Button>}
        </div>
      </div>

      {tab === 'model' && (
        <Card title="Data model" subtitle="Facts, dimensions and relationships. Drag tables to rearrange."><ModelDiagram p={p} /></Card>
      )}

      {tab === 'mapping' && (
        <Card title="Field mapping" subtitle="The reporting name is the label people see on filters, axes, legends, table headers and exports. Untick a field to keep it out of dashboards." bodyClass="p-0">
          <table className="w-full table-fixed">
            <colgroup><col className="w-[22%]" /><col className="w-[26%]" /><col /><col className="w-24" /><col className="w-28" /><col className="w-20" /></colgroup>
            <thead><tr><th className="th">Source field</th><th className="th">Reporting name</th><th className="th">Reporting table</th><th className="th">Type</th><th className="th">Used in design</th><th className="th text-center">Include</th></tr></thead>
            <tbody>
              {f.fieldMaps.filter((m) => m.reportingTable !== 'Dim_Date').map((m) => {
                const r = `${m.sourceDataset}::${m.sourceField}`;
                const uses = (p.design?.spec.pages.flatMap((pg) => pg.components).filter((c) => [c.dimension, c.series, ...(c.tableColumns ?? [])].includes(r)).length ?? 0) + (p.design?.spec.filters.filter((x) => x.field === r).length ?? 0);
                return (
                  <tr key={m.id} className={cx(!m.included && 'bg-slate-50 text-slate-400')}>
                    <td className="td"><div className="font-mono text-xs text-slate-700">{m.sourceField}</div><div className="text-[0.6875rem] text-slate-400">{label(m.sourceDataset)}</div></td>
                    <td className="td"><input key={m.reportingField} className="input py-1 text-sm" defaultValue={prettify(m.reportingField)} disabled={!m.included} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== prettify(m.reportingField)) updateFieldMap(p.id, m.id, { reportingField: v }); }} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} aria-label={`Reporting name for ${m.sourceField}`} /></td>
                    <td className="td font-mono text-xs">{m.reportingTable}</td>
                    <td className="td"><Badge>{m.dataType}</Badge></td>
                    <td className="td text-xs">{uses ? <span className={cx(!m.included && 'font-medium text-red-600')}>{uses} visual{uses > 1 ? 's' : ''}/filter{uses > 1 ? 's' : ''}</span> : <span className="text-slate-300">—</span>}</td>
                    <td className="td text-center"><input type="checkbox" checked={m.included} onChange={(e) => { if (!e.target.checked && uses && !confirm(`${prettify(m.reportingField)} is used in ${uses} visual(s)/filter(s). Exclude it anyway? The design will show which visuals need changing.`)) return; updateFieldMap(p.id, m.id, { included: e.target.checked }); }} aria-label={`Include ${m.sourceField}`} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      {tab === 'catalogue' && <CatalogueTab p={p} />}
      {tab === 'kpis' && <DescribeKpi pid={p.id} />}
      {tab === 'kpis' && f.gaps.length > 0 && <Callout tone="warning" title="Data gaps">{f.gaps.join(' · ')}</Callout>}
      {tab === 'kpis' && (
        <Card title="KPI definition workspace" subtitle="Calculation logic inferred from the data. Values shown use all available data." actions={<Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setEditing({ id: uid('m'), name: '', description: '', kind: 'count', datasetId: u.profiles.find((x) => x.kind === 'activity')?.datasetId, field: undefined, format: 'number', logic: '', assumptions: [] })}>Add KPI</Button>} bodyClass="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr><th className="th">KPI</th><th className="th">Suggested logic</th><th className="th text-right">Live value</th><th className="th">Requirement</th><th className="th">Assumptions</th><th className="th" /></tr></thead>
              <tbody>
                {f.measures.map((m) => {
                  const v = engine?.value(m.id, emptyFilters(), null);
                  return (
                    <tr key={m.id}>
                      <td className="td"><div className="font-medium text-navy-900">{m.name}{m.catalogueRef && <span title={`ProcDNA KPI Catalogue: ${m.catalogueRef}`}><Badge tone="blue" className="ml-1.5">catalogue</Badge></span>}{m.userModified && <Badge tone="violet" className="ml-1.5">edited</Badge>}</div><div className="text-[0.6875rem] text-slate-500">{m.description}</div></td>
                      <td className="td font-mono text-[0.6875rem] text-slate-700">{m.logic}</td>
                      <td className="td text-right tabular-nums">{v == null ? <span className="text-red-600">n/a</span> : m.format === 'percent' ? `${v.toFixed(1)}%` : fmtNumber(v, m.format === 'decimal' ? 2 : 0)}</td>
                      <td className="td text-xs">{m.requirementRef ? <Badge tone="green">{m.requirementRef}</Badge> : <span className="text-slate-400">Derived</span>}</td>
                      <td className="td text-[0.6875rem] text-amber-700">{m.assumptions.map((a) => <div key={a} className="flex gap-1"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />{a}</div>)}</td>
                      <td className="td whitespace-nowrap"><Button size="xs" variant="ghost" icon={<Pencil className="h-3 w-3" />} onClick={() => setEditing(m)} aria-label={`Edit ${m.name}`} /><Button size="xs" variant="ghost" icon={<Trash2 className="h-3 w-3" />} onClick={() => confirm(`Delete KPI "${m.name}"?`) && deleteMeasure(p.id, m.id)} aria-label={`Delete ${m.name}`} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

    </>
  );

  return (
    <>
      <StageLayout p={p} agent="foundation" main={main} next={approved ? 'The approved foundation (tables, relationships and KPI logic) feeds the Dashboard Design Agent.' : 'Review the model, mappings and KPI logic. Approve to unlock design approval.'} />
      {editing && <MeasureEditor p={p} m={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

/** How the ProcDNA KPI catalogue (Case and FRM Management) maps onto this project's data. */
function CatalogueTab({ p }: { p: Project }) {
  const f = p.foundation!;
  const engine = useEngine(p);
  const [cat, setCat] = useState<'all' | 'Case Management' | 'FRM Management'>('all');
  const [onlyKpi, setOnlyKpi] = useState(false);
  const rows = (f.catalogue ?? []).filter((c) => (cat === 'all' || c.category === cat) && (!onlyKpi || c.isKpi));
  const meta = (name: string) => KPI_CATALOGUE.find((m) => m.name === name);
  const counts = { computed: rows.filter((c) => c.status === 'computed').length, same: rows.filter((c) => c.status === 'same_as').length, needs: rows.filter((c) => c.status === 'needs_data').length };
  return (
    <Card
      title="ProcDNA KPI Catalogue — Case and FRM Management"
      subtitle={`${counts.computed} computed from the data · ${counts.same} answered by another KPI · ${counts.needs} need another source. Catalogue KPIs keep the catalogue's definition and computation.`}
      actions={
        <div className="flex items-center gap-2">
          <select className="input py-1 text-xs" value={cat} onChange={(e) => setCat(e.target.value as typeof cat)} aria-label="Catalogue category"><option value="all">All categories</option><option>Case Management</option><option>FRM Management</option></select>
          <label className="flex items-center gap-1 text-xs text-slate-600"><input type="checkbox" checked={onlyKpi} onChange={(e) => setOnlyKpi(e.target.checked)} />KPIs only</label>
        </div>
      }
      bodyClass="p-0"
    >
      <div className="overflow-x-auto">
        <table className="w-full" data-testid="catalogue-table">
          <thead><tr><th className="th">Catalogue metric</th><th className="th">Status</th><th className="th">Computed as</th><th className="th text-right">Live value</th><th className="th">Catalogue computation / note</th></tr></thead>
          <tbody>
            {rows.map((c) => {
              const m = f.measures.find((x) => x.id === c.measureId);
              const v = m ? engine?.value(m.id, emptyFilters(), null) : null;
              return (
                <tr key={c.metric} className={cx(c.status === 'needs_data' && 'text-slate-400')}>
                  <td className="td"><div className={cx('font-medium', c.status === 'needs_data' ? 'text-slate-500' : 'text-navy-900')}>{c.metric}{c.isKpi && <Badge tone="green" className="ml-1.5">KPI</Badge>}</div><div className="text-[0.6875rem] text-slate-500">{meta(c.metric)?.definition}</div></td>
                  <td className="td whitespace-nowrap">{c.status === 'computed' ? <Badge tone="green">Computed</Badge> : c.status === 'same_as' ? <Badge tone="blue">Same as</Badge> : <Badge tone="slate">Needs data</Badge>}</td>
                  <td className="td text-xs">{m ? <><div className="font-medium text-slate-700">{m.name}</div><div className="font-mono text-[0.625rem] text-slate-500">{m.logic}</div></> : '—'}</td>
                  <td className="td text-right tabular-nums">{v == null ? '—' : m!.format === 'percent' ? `${v.toFixed(1)}%` : fmtNumber(v, m!.format === 'decimal' ? 1 : 0)}</td>
                  <td className="td text-[0.6875rem]">{c.status === 'same_as' ? c.note : <span className="font-mono">{meta(c.metric)?.computation}</span>}{c.status === 'needs_data' && <div className="mt-0.5 font-sans text-amber-700">{c.note}</div>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function DescribeKpi({ pid }: { pid: string }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!text.trim()) return;
    setBusy(true);
    const m = await defineKpiFromText(pid, text.trim());
    setBusy(false);
    if (m) setText('');
  };
  return (
    <div className="card flex flex-wrap items-center gap-2 p-3">
      <Sparkles className="h-4 w-4 text-brand-600" />
      <input className="input min-w-[17.5rem] flex-1" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} placeholder="Describe a KPI, e.g. “patients with PA pending for more than 14 days”" aria-label="Describe a KPI" />
      <Button variant="primary" size="sm" loading={busy} disabled={!text.trim()} onClick={submit}>Create KPI</Button>
    </div>
  );
}

function MeasureEditor({ p, m, onClose }: { p: Project; m: MeasureDef; onClose: () => void }) {
  const [d, setD] = useState<MeasureDef>(m);
  const u = p.understanding!;
  const ds = u.profiles.find((x) => x.datasetId === d.datasetId);
  const others = p.foundation!.measures.filter((x) => x.id !== d.id);
  const valid = d.name.trim() && (d.kind === 'ratio' ? d.numeratorId && d.denominatorId : d.datasetId && (d.kind === 'count' || d.field));
  return (
    <Modal open onClose={onClose} title={p.foundation!.measures.some((x) => x.id === m.id) ? `Edit KPI — ${m.name}` : 'Add KPI'} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!valid} onClick={() => { updateMeasure(p.id, d); onClose(); }}>Save KPI</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="KPI name"><input className="input" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} /></Field>
        <Field label="Format">
          <select className="input" value={d.format} onChange={(e) => setD({ ...d, format: e.target.value as MeasureDef['format'] })}>{['number', 'percent', 'decimal', 'currency'].map((x) => <option key={x}>{x}</option>)}</select>
        </Field>
        <div className="sm:col-span-2"><Field label="Business definition"><input className="input" value={d.description} onChange={(e) => setD({ ...d, description: e.target.value })} /></Field></div>
        <Field label="Aggregation">
          <select className="input" value={d.kind} onChange={(e) => setD({ ...d, kind: e.target.value as MeasureDef['kind'] })}>
            <option value="count">COUNT</option><option value="countDistinct">COUNT DISTINCT</option><option value="sum">SUM</option><option value="avg">AVERAGE</option><option value="median">MEDIAN</option><option value="ratio">RATIO (A / B)</option>
          </select>
        </Field>
        {d.kind === 'ratio' ? (
          <>
            <Field label="Numerator"><select className="input" value={d.numeratorId ?? ''} onChange={(e) => setD({ ...d, numeratorId: e.target.value })}><option value="">Select…</option>{others.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
            <Field label="Denominator"><select className="input" value={d.denominatorId ?? ''} onChange={(e) => setD({ ...d, denominatorId: e.target.value })}><option value="">Select…</option>{others.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
          </>
        ) : (
          <>
            <Field label="Source dataset"><select className="input" value={d.datasetId ?? ''} onChange={(e) => setD({ ...d, datasetId: e.target.value, field: undefined, condition: undefined })}>{u.profiles.map((x) => <option key={x.datasetId} value={x.datasetId}>{x.label}</option>)}</select></Field>
            <Field label="Field"><select className="input" value={d.field ?? ''} onChange={(e) => setD({ ...d, field: e.target.value || undefined })}><option value="">(all rows)</option>{ds?.columns.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}</select></Field>
            <Field label="Condition field (optional)"><select className="input" value={d.condition?.field ?? ''} onChange={(e) => setD({ ...d, condition: e.target.value ? { field: e.target.value, op: 'eq', values: [] } : undefined })}><option value="">No condition</option>{ds?.columns.filter((c) => c.distinct <= 30).map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}</select></Field>
            {d.condition && (
              <Field label="Equals value(s)">
                <select multiple className="input h-24" value={d.condition.values} onChange={(e) => setD({ ...d, condition: { ...d.condition!, values: Array.from(e.target.selectedOptions).map((o) => o.value) } })}>
                  {ds?.columns.find((c) => c.name === d.condition!.field)?.topValues.map((v) => <option key={v.value} value={v.value}>{v.value}</option>)}
                </select>
              </Field>
            )}
          </>
        )}
        <div className="sm:col-span-2"><Field label="Assumptions (one per line)"><textarea className="input" rows={2} value={d.assumptions.join('\n')} onChange={(e) => setD({ ...d, assumptions: e.target.value.split('\n').filter(Boolean) })} /></Field></div>
      </div>
    </Modal>
  );
}

function ModelDiagram({ p }: { p: Project }) {
  const f = p.foundation!;
  const u = p.understanding!;
  const tables = f.tables.filter((t) => t.sourceDatasetId && t.name !== 'Dim_Geography');
  const derived = f.tables.filter((t) => !t.sourceDatasetId || t.name === 'Dim_Geography');
  const W = 860;
  const H = 360;
  const init = useMemo(() => {
    const pos: Record<string, { x: number; y: number }> = {};
    const facts = tables.filter((t) => t.kind === 'fact');
    const dims = tables.filter((t) => t.kind === 'dimension');
    facts.forEach((t, i) => (pos[t.id] = { x: 300 + i * 260 - ((facts.length - 1) * 130 - 130), y: 200 }));
    dims.forEach((t, i) => (pos[t.id] = { x: 70 + i * ((W - 260) / Math.max(1, dims.length - 1)), y: 40 }));
    derived.forEach((t, i) => (pos[t.id] = { x: 120 + i * 300, y: 300 }));
    return pos;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.generatedAt]);
  const [pos, setPos] = useState(init);
  const [hover, setHover] = useState<string | null>(null);
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const tableOf = (dsId: string) => tables.find((t) => t.sourceDatasetId === dsId);
  const pt = (e: React.PointerEvent) => {
    const r = svg.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };
  const BW = 180;
  const BH = 46;
  return (
    <svg ref={svg} viewBox={`0 0 ${W} ${H}`} className="h-auto w-full select-none rounded-lg bg-slate-50" onPointerMove={(e) => { if (!drag.current) return; const q = pt(e); setPos({ ...pos, [drag.current.id]: { x: q.x - drag.current.dx, y: q.y - drag.current.dy } }); }} onPointerUp={() => (drag.current = null)} onPointerLeave={() => (drag.current = null)}>
      <defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#94a3b8" /></marker></defs>
      {u.relationships.filter((r) => r.status !== 'rejected').map((r) => {
        const a = tableOf(r.fromDataset);
        const b = tableOf(r.toDataset);
        if (!a || !b || !pos[a.id] || !pos[b.id]) return null;
        const hl = hover === a.id || hover === b.id;
        const x1 = pos[a.id].x + BW / 2, y1 = pos[a.id].y, x2 = pos[b.id].x + BW / 2, y2 = pos[b.id].y + BH;
        return (
          <g key={r.id}>
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={hl ? '#7a00e6' : '#94a3b8'} strokeWidth={hl ? 2.5 : 1.5} strokeDasharray={r.status === 'suggested' ? '5 4' : undefined} markerEnd="url(#arrow)" />
            <text x={(x1 + x2) / 2 + 6} y={(y1 + y2) / 2} fontSize="10" fill={hl ? '#6400bd' : '#64748b'} fontFamily="ui-monospace,monospace">{r.fromField} ∞:1</text>
          </g>
        );
      })}
      {[...tables, ...derived].map((t) => pos[t.id] && (
        <g key={t.id} transform={`translate(${pos[t.id].x},${pos[t.id].y})`} onPointerDown={(e) => { const q = pt(e); drag.current = { id: t.id, dx: q.x - pos[t.id].x, dy: q.y - pos[t.id].y }; (e.target as Element).setPointerCapture?.(e.pointerId); }} onPointerEnter={() => setHover(t.id)} onPointerLeave={() => setHover(null)} className="cursor-move">
          <rect width={BW} height={BH} rx="8" fill={t.kind === 'fact' ? '#f6efff' : '#f5f3ff'} stroke={hover === t.id ? '#7a00e6' : t.kind === 'fact' ? '#bd8bff' : '#c4b5fd'} strokeWidth={hover === t.id ? 2 : 1} strokeDasharray={t.sourceDatasetId && t.name !== 'Dim_Geography' ? undefined : '4 3'} />
          <text x="10" y="19" fontSize="12" fontWeight="600" fill="#171717" fontFamily="ui-monospace,monospace">{t.name}</text>
          <text x="10" y="35" fontSize="10" fill="#64748b">{t.kind === 'fact' ? 'Fact' : 'Dimension'} · {t.fields.length} fields{!t.sourceDatasetId || t.name === 'Dim_Geography' ? ' · derived' : ''}</text>
        </g>
      ))}
      <g transform={`translate(${W - 200},${H - 40})`} fontSize="10" fill="#64748b">
        <text x="0" y="10">— confirmed  - - suggested relationship</text>
        <text x="0" y="26">dashed box = derived logical table</text>
      </g>
    </svg>
  );
}

