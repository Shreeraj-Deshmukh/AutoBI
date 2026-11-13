import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Upload, Trash2, CheckCircle2, XCircle, ArrowRight, AlertTriangle, RefreshCw, FlaskConical, Cable, Pencil, Plus, RotateCcw, SlidersHorizontal, Loader2 } from 'lucide-react';
import ConnectSource from '@/components/ConnectSource';
import type { ColumnRole, DatasetKind, DatasetProfile, MappingStatus, Project, ReqMapping, Relationship } from '@/types';
import StageLayout from '@/components/StageLayout';
import { Button, Callout, Card, Badge, Tabs, MapBadge, Modal, Field, cx } from '@/components/ui';
import { confirmUnderstanding, deleteRelationship, isRunning, removeDataset, resetMapping, runDataIntelligenceAgent, saveRelationship, setRelationshipStatus, toggleIssue, updateColumn, updateDatasetProfile, updateMapping, uploadFiles, type LinkInput } from '@/store/orchestrator';
import { getRows } from '@/lib/rowStore';
import { linkStats } from '@/lib/profile';
import { useRowsVersion } from '@/store/engineCache';
import { SHOWN_KITS as DEMO_KITS, fetchKitFiles } from '@/lib/demoKits';
import { fmtNumber } from '@/lib/util';
import { useStore } from '@/store/store';
import { FEATURES } from '@/config/features';

type Tab = 'datasets' | 'links' | 'mapping';

/** Plain-language names for what the agent infers. */
const ROLE_LABEL: Record<ColumnRole, string> = { identifier: 'Unique ID', foreign_key: 'Link to another table', date: 'Date', measure: 'Number to add up', dimension: 'Category', status: 'Status', attribute: 'Detail / text' };
const KIND_LABEL: Record<DatasetKind, string> = { activity: 'Activity (events with dates)', master: 'Master (list of things)', reference: 'Reference (lookup)', unknown: 'Not sure' };
const KIND_SHORT: Record<DatasetKind, string> = { activity: 'Activity', master: 'Master', reference: 'Reference', unknown: 'Other' };
const STATUS_LABEL: Record<MappingStatus, string> = { available: 'Available', join_required: 'Join Required', calculation_required: 'Calculation Required', missing: 'Missing Data', clarification: 'Requires Clarification' };

export default function DataStage({ p }: { p: Project }) {
  const nav = useNavigate();
  useRowsVersion();
  const [tab, setTab] = useState<Tab>('datasets');
  const [drag, setDrag] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [link, setLink] = useState<Relationship | 'new' | null>(null);
  const [mapping, setMapping] = useState<ReqMapping | null>(null);
  const [attaching, setAttaching] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const busy = isRunning(p, 'data');
  const u = p.understanding;
  const label = (id: string) => u?.profiles.find((x) => x.datasetId === id)?.label ?? p.datasets.find((d) => d.id === id)?.name ?? id;
  const onFiles = (files: FileList | File[] | null) => files && files.length && uploadFiles(p.id, Array.from(files));
  const done = p.stages.data.status === 'completed';
  const openIssues = u?.issues.filter((i) => i.severity !== 'info' && !i.resolved) ?? [];
  const mappings = u?.mappings.filter((m, i, a) => a.findIndex((x) => x.requirement.toLowerCase() === m.requirement.toLowerCase()) === i) ?? [];
  const attention = mappings.filter((m) => m.status === 'missing' || m.status === 'clarification');
  const attachKit = async (k: (typeof DEMO_KITS)[number]) => {
    setAttaching(true);
    try {
      await uploadFiles(p.id, await fetchKitFiles(k));
    } catch (e) {
      useStore.getState().toast('error', (e as Error).message);
    } finally {
      setAttaching(false);
    }
  };

  const main = (
    <>
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); onFiles(e.dataTransfer.files); }}
        className={cx('flex flex-wrap items-center gap-3 rounded-xl border-2 border-dashed px-4 py-3', drag ? 'border-brand-500 bg-brand-50' : 'border-slate-300 bg-white')}
      >
        <Upload className="h-5 w-5 text-brand-600" />
        <div className="min-w-0 flex-1 text-sm">
          <span className="font-medium text-slate-800">Drop CSV, Excel or JSON files</span>
          <span className="text-slate-500"> — or </span>
          <button className="font-medium text-brand-700 hover:underline" onClick={() => fileRef.current?.click()}>browse</button>
        </div>
        <Button size="sm" icon={<Cable className="h-3.5 w-3.5" />} onClick={() => setConnecting(true)}>Databricks / Snowflake</Button>
        {FEATURES.datasetLibrary && (
          <label className={cx('flex h-8 items-center gap-1.5 rounded-lg border border-slate-300 bg-white pl-2.5 pr-1 text-xs text-slate-700 hover:bg-slate-50', (busy || attaching) ? 'cursor-not-allowed opacity-50' : 'cursor-pointer')}>
            {attaching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="h-3.5 w-3.5" />}
            <select
              aria-label="Dataset library"
              value=""
              disabled={busy || attaching}
              onChange={(e) => { const k = DEMO_KITS.find((x) => x.id === e.target.value); if (k) attachKit(k); }}
              className="cursor-pointer bg-transparent pr-1 font-medium focus:outline-none disabled:cursor-not-allowed"
            >
              <option value="">{attaching ? 'Loading…' : 'Load from dataset library…'}</option>
              {DEMO_KITS.map((k) => <option key={k.id} value={k.id}>{k.title} ({k.files.length} files)</option>)}
            </select>
          </label>
        )}
        <input ref={fileRef} type="file" multiple accept=".csv,.txt,.xlsx,.xls,.json" className="hidden" data-testid="file-input" onChange={(e) => { onFiles(e.target.files); e.target.value = ''; }} />
      </div>

      {u && (
        <div className="flex flex-wrap items-center gap-2">
          <Tabs<Tab> className="flex-1" value={tab} onChange={setTab} tabs={[{ id: 'datasets', label: 'Datasets', count: p.datasets.length }, { id: 'links', label: 'Links & quality', count: openIssues.length || undefined }, { id: 'mapping', label: 'Requirement mapping', count: attention.length || undefined }]} />
          <Button size="sm" variant="ghost" icon={<RefreshCw className="h-3.5 w-3.5" />} loading={busy} onClick={() => runDataIntelligenceAgent(p.id)} title="Re-profile the data. Your edits are kept.">Re-run</Button>
          {done ? (
            <Button size="sm" variant="primary" onClick={() => nav(`/p/${p.id}/foundation`)}>Continue →</Button>
          ) : (
            <Button size="sm" variant="success" icon={<CheckCircle2 className="h-3.5 w-3.5" />} disabled={busy || p.requirementsStatus !== 'approved'} title={p.requirementsStatus !== 'approved' ? 'Approve the requirements first' : ''} onClick={() => confirmUnderstanding(p.id) && nav(`/p/${p.id}/foundation`)}>Confirm data understanding</Button>
          )}
        </div>
      )}

      {tab === 'datasets' && (
        <>
          {u && p.datasets.length > 0 && <p className="text-xs text-slate-500">This is what the agent thinks each file contains. Open one to rename it, change its type, or correct how each column is read.</p>}
          <div className="grid gap-3 md:grid-cols-2">
            {p.datasets.map((d) => {
              const prof = u?.profiles.find((x) => x.datasetId === d.id);
              const dc = prof?.columns.find((c) => c.name === prof.dateField);
              return (
                <div key={d.id} className="card p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2"><span className="font-semibold text-navy-900">{prof?.label ?? d.name}</span>{prof && <Badge tone={prof.kind === 'activity' ? 'blue' : prof.kind === 'master' ? 'violet' : 'slate'}>{KIND_SHORT[prof.kind]}</Badge>}</div>
                      <div className="text-[0.6875rem] text-slate-500">{d.format === 'databricks' ? 'Databricks · ' : d.format === 'snowflake' ? 'Snowflake · ' : ''}{d.fileName} · {fmtNumber(d.rowCount)} rows · {d.columnCount} columns{d.status === 'profiling' && ' · profiling…'}</div>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button size="xs" variant="ghost" icon={<Pencil className="h-3 w-3" />} onClick={() => setOpen(d.id)} aria-label="Review & edit dataset" title="Review & edit" />
                      <Button size="xs" variant="ghost" icon={<Trash2 className="h-3 w-3" />} onClick={() => confirm(`Remove ${d.fileName}?`) && removeDataset(p.id, d.id)} aria-label="Remove dataset" />
                    </div>
                  </div>
                  {prof && <p className="mt-2 text-sm text-slate-600">{prof.inference}</p>}
                  {dc && <div className="mt-1 text-[0.6875rem] text-slate-400">Dates: {dc.dateMin} → {dc.dateMax}</div>}
                </div>
              );
            })}
            {!p.datasets.length && <div className="card col-span-full p-8 text-center text-sm text-slate-500">No datasets yet. Upload files or connect Databricks or Snowflake{FEATURES.datasetLibrary ? ', or attach a dataset from the library' : ''}.</div>}
          </div>
        </>
      )}

      {tab === 'links' && u && (
        <>
          <Card title="How the tables connect" subtitle="Links the agent found between your tables. Confirm them, fix the columns, or add your own." actions={<Button size="xs" variant="subtle" icon={<Plus className="h-3 w-3" />} onClick={() => setLink('new')} disabled={u.profiles.length < 2}>Add link</Button>} bodyClass="p-0">
            {u.relationships.length ? (
              <ul className="divide-y divide-slate-100">
                {u.relationships.map((r) => (
                  <li key={r.id} className={cx('flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm', r.status === 'rejected' && 'opacity-55')}>
                    <span className="min-w-0">
                      <span className="font-medium text-navy-900">{label(r.fromDataset)}</span>
                      <span className="font-mono text-xs text-slate-500"> .{r.fromField}</span>
                      <ArrowRight className="mx-1.5 inline h-3.5 w-3.5 text-slate-400" />
                      <span className="font-medium text-navy-900">{label(r.toDataset)}</span>
                      <span className="font-mono text-xs text-slate-500"> .{r.toField}</span>
                    </span>
                    <span className={cx('text-xs', r.matchRate < 0.95 ? 'text-amber-600' : 'text-slate-500')} title={r.unmatched ? `${r.unmatched} value(s) have no match` : 'Every value has a match'}>{(r.matchRate * 100).toFixed(1)}% matched</span>
                    <span className="ml-auto flex items-center gap-1">
                      <Badge tone={r.status === 'confirmed' ? 'green' : r.status === 'rejected' ? 'red' : 'amber'}>{r.status === 'suggested' ? 'Suggested' : r.status === 'confirmed' ? (r.manual ? 'Yours' : 'Confirmed') : 'Ignored'}</Badge>
                      {r.status !== 'confirmed' && <Button size="xs" variant="ghost" icon={<CheckCircle2 className="h-3 w-3" />} onClick={() => setRelationshipStatus(p.id, r.id, 'confirmed')}>Confirm</Button>}
                      {r.status !== 'rejected' && !r.manual && <Button size="xs" variant="ghost" icon={<XCircle className="h-3 w-3" />} onClick={() => setRelationshipStatus(p.id, r.id, 'rejected')}>Ignore</Button>}
                      <Button size="xs" variant="ghost" icon={<Pencil className="h-3 w-3" />} onClick={() => setLink(r)} aria-label="Edit link" />
                      {r.manual && <Button size="xs" variant="ghost" icon={<Trash2 className="h-3 w-3" />} onClick={() => deleteRelationship(p.id, r.id)} aria-label="Delete link" />}
                    </span>
                  </li>
                ))}
              </ul>
            ) : <div className="p-4 text-sm text-slate-500">No links found between the tables. Use “Add link” to connect them.</div>}
          </Card>
          <Card title="Data quality" subtitle="Problems the agent spotted. Acknowledge the ones you accept." bodyClass="p-0">
            {u.issues.filter((i) => i.severity !== 'info').length ? (
              <ul className="divide-y divide-slate-100">
                {u.issues.filter((i) => i.severity !== 'info').map((i) => (
                  <li key={i.id} className={cx('flex gap-3 px-4 py-2.5', i.resolved && 'opacity-50')}>
                    <AlertTriangle className={cx('mt-0.5 h-4 w-4 shrink-0', i.severity === 'error' ? 'text-red-500' : 'text-amber-500')} />
                    <div className="min-w-0 flex-1 text-sm"><div className="text-slate-700">{i.message}</div><div className="text-xs text-slate-500">{i.suggestion}</div></div>
                    <Button size="xs" variant="ghost" onClick={() => toggleIssue(p.id, i.id)}>{i.resolved ? 'Re-open' : 'Acknowledge'}</Button>
                  </li>
                ))}
              </ul>
            ) : <div className="p-4 text-sm text-emerald-700">No data-quality warnings.</div>}
          </Card>
        </>
      )}

      {tab === 'mapping' && u && (
        mappings.length ? (
          <Card title="Where each requirement comes from" subtitle="The agent matched each KPI, breakdown and filter to columns in your data. Edit any row to point it somewhere else." bodyClass="p-0">
            <table className="w-full">
              <thead><tr><th className="th">Requirement</th><th className="th">Table</th><th className="th">Column(s)</th><th className="th">Status</th><th className="th w-10" /></tr></thead>
              <tbody>
                {mappings.map((m) => (
                  <tr key={m.id} className="group">
                    <td className="td">
                      <div className="flex items-center gap-1.5 font-medium text-navy-900">{m.requirement}{m.userEdited && <Badge tone="violet">Edited</Badge>}</div>
                      <div className="text-[0.6875rem] text-slate-400">{m.kind === 'kpi' ? 'KPI' : m.kind === 'dimension' ? 'Breakdown' : 'Filter'}{m.note ? ` · ${m.note}` : ''}</div>
                    </td>
                    <td className="td text-sm">{m.sources.join(' + ') || '—'}</td>
                    <td className="td font-mono text-xs">{m.fields.join(', ') || '—'}</td>
                    <td className="td whitespace-nowrap"><MapBadge status={m.status} /></td>
                    <td className="td text-right"><Button size="xs" variant="ghost" icon={<SlidersHorizontal className="h-3 w-3" />} onClick={() => setMapping(m)} aria-label={`Edit mapping for ${m.requirement}`}>Edit</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        ) : <Callout tone="info">Approve the requirements, then re-run the agent to map them to the data.</Callout>
      )}
    </>
  );

  const ds = p.datasets.find((d) => d.id === open);
  const prof = u?.profiles.find((x) => x.datasetId === open);
  return (
    <>
      <StageLayout p={p} agent="data" main={main} next={done ? 'The Reporting Foundation Agent proposes the reporting model.' : p.requirementsStatus !== 'approved' ? 'Approve the requirements, then confirm the data understanding.' : 'Review, then confirm the data understanding.'} />
      {connecting && <ConnectSource pid={p.id} onClose={() => setConnecting(false)} />}
      {ds && <DatasetEditor pid={p.id} id={ds.id} columns={ds.columns} name={ds.name} prof={prof} onClose={() => setOpen(null)} />}
      {link && u && <LinkEditor profiles={u.profiles} rel={link === 'new' ? null : link} onClose={() => setLink(null)} onSave={(l) => { saveRelationship(p.id, l, link === 'new' ? undefined : link.id); setLink(null); }} />}
      {mapping && u && <MappingEditor pid={p.id} m={mapping} profiles={u.profiles} onClose={() => setMapping(null)} />}
    </>
  );
}

/** Rename a dataset, change its type and correct how each column is read. */
function DatasetEditor({ pid, id, columns, name, prof, onClose }: { pid: string; id: string; columns: string[]; name: string; prof?: DatasetProfile; onClose: () => void }) {
  const [view, setView] = useState<'columns' | 'preview'>(prof ? 'columns' : 'preview');
  const [title, setTitle] = useState(prof?.label ?? name);
  const rows = getRows(id).slice(0, 30);
  return (
    <Modal open onClose={onClose} title="Review & edit dataset" wide footer={<Button variant="primary" onClick={() => { if (prof && title.trim() !== prof.label) updateDatasetProfile(pid, id, { label: title }); onClose(); }}>Done</Button>}>
      {prof && (
        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          <Field label="Name"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => title.trim() && title.trim() !== prof.label && updateDatasetProfile(pid, id, { label: title })} /></Field>
          <Field label="What kind of table is this?"><select className="input" value={prof.kind} onChange={(e) => updateDatasetProfile(pid, id, { kind: e.target.value as DatasetKind })}>{(Object.keys(KIND_LABEL) as DatasetKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select></Field>
        </div>
      )}
      <Tabs<'columns' | 'preview'> className="mb-3" value={view} onChange={setView} tabs={[...(prof ? [{ id: 'columns' as const, label: 'Columns' }] : []), { id: 'preview', label: 'Data preview' }]} />
      {view === 'columns' && prof ? (
        <table className="w-full">
          <thead><tr><th className="th">Column</th><th className="th">Read as</th><th className="th text-right">Missing</th><th className="th">Meaning</th></tr></thead>
          <tbody>
            {prof.columns.map((c) => (
              <tr key={c.name}>
                <td className="td whitespace-nowrap font-medium text-navy-900">{c.name}{c.name === prof.primaryKey && <Badge tone="navy" className="ml-1.5">Key</Badge>}{c.edited && <Badge tone="violet" className="ml-1.5">Edited</Badge>}</td>
                <td className="td"><select className="input w-44 py-1 text-xs" value={c.role} onChange={(e) => updateColumn(pid, id, c.name, { role: e.target.value as ColumnRole })} aria-label={`How ${c.name} is read`}>{(Object.keys(ROLE_LABEL) as ColumnRole[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></td>
                <td className={cx('td text-right tabular-nums', c.missing > 0 && 'text-amber-600')}>{c.missing ? fmtNumber(c.missing) : '—'}</td>
                <td className="td"><input key={c.businessDefinition} className="input py-1 text-xs" defaultValue={c.businessDefinition} onBlur={(e) => updateColumn(pid, id, c.name, { businessDefinition: e.target.value.trim() })} aria-label={`Meaning of ${c.name}`} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="overflow-auto">
          <table className="w-full">
            <thead><tr>{columns.map((c) => <th key={c} className="th">{c}</th>)}</tr></thead>
            <tbody>{rows.map((r, i) => <tr key={i}>{columns.map((c) => <td key={c} className="td whitespace-nowrap text-xs">{r[c] == null ? <span className="text-slate-300">null</span> : String(r[c])}</td>)}</tr>)}</tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

/** Add or change a link: many rows in one table point to one row in another. */
function LinkEditor({ profiles, rel, onClose, onSave }: { profiles: DatasetProfile[]; rel: Relationship | null; onClose: () => void; onSave: (l: LinkInput) => void }) {
  const first = profiles.find((x) => x.kind === 'activity') ?? profiles[0];
  const keyOf = (id: string) => profiles.find((x) => x.datasetId === id)?.primaryKey ?? profiles.find((x) => x.datasetId === id)?.columns[0]?.name ?? '';
  const [l, setL] = useState<LinkInput>(() => {
    if (rel) return { fromDataset: rel.fromDataset, fromField: rel.fromField, toDataset: rel.toDataset, toField: rel.toField };
    const to = profiles.find((x) => x.datasetId !== first.datasetId)!;
    return { fromDataset: first.datasetId, fromField: first.columns[0]?.name ?? '', toDataset: to.datasetId, toField: keyOf(to.datasetId) };
  });
  const cols = (id: string) => profiles.find((x) => x.datasetId === id)?.columns ?? [];
  const stats = useMemo(() => (l.fromField && l.toField ? linkStats(getRows(l.fromDataset), l.fromField, getRows(l.toDataset), l.toField) : null), [l]);
  const same = l.fromDataset === l.toDataset;
  return (
    <Modal open onClose={onClose} title={rel ? 'Edit link' : 'Add link'} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={same || !l.fromField || !l.toField} onClick={() => onSave(l)}>Save link</Button></>}>
      <p className="mb-3 text-xs text-slate-500">Pick the column in each table that holds the same value, e.g. Account_ID in the call log and Account_ID in the account list.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Table (many rows)"><select className="input" value={l.fromDataset} onChange={(e) => setL({ ...l, fromDataset: e.target.value, fromField: cols(e.target.value)[0]?.name ?? '' })}>{profiles.map((x) => <option key={x.datasetId} value={x.datasetId}>{x.label}</option>)}</select></Field>
        <Field label="Column"><select className="input" value={l.fromField} onChange={(e) => setL({ ...l, fromField: e.target.value })}>{cols(l.fromDataset).map((c) => <option key={c.name}>{c.name}</option>)}</select></Field>
        <Field label="Links to table (one row each)"><select className="input" value={l.toDataset} onChange={(e) => setL({ ...l, toDataset: e.target.value, toField: keyOf(e.target.value) })}>{profiles.map((x) => <option key={x.datasetId} value={x.datasetId}>{x.label}</option>)}</select></Field>
        <Field label="Column"><select className="input" value={l.toField} onChange={(e) => setL({ ...l, toField: e.target.value })}>{cols(l.toDataset).map((c) => <option key={c.name}>{c.name}</option>)}</select></Field>
      </div>
      <div className="mt-3 text-sm">
        {same ? <span className="text-red-600">Pick two different tables.</span> : stats && (
          <span className={stats.matchRate >= 0.95 ? 'text-emerald-700' : stats.matchRate >= 0.5 ? 'text-amber-700' : 'text-red-600'}>
            {(stats.matchRate * 100).toFixed(1)}% of values match{stats.unmatched ? ` · ${fmtNumber(stats.unmatched)} have no match` : ''}{stats.matchRate < 0.5 ? ' — these columns probably don’t belong together.' : ''}
          </span>
        )}
      </div>
    </Modal>
  );
}

/** Point a requirement at different columns, or change its status. */
function MappingEditor({ pid, m, profiles, onClose }: { pid: string; m: ReqMapping; profiles: DatasetProfile[]; onClose: () => void }) {
  const ref = (p: DatasetProfile, c: string) => `${p.datasetId}::${c}`;
  const wanted = new Set(m.fields.flatMap((f) => f.split(',').map((x) => x.trim())));
  const [sel, setSel] = useState<string[]>(() => profiles.filter((p) => m.sources.includes(p.label)).flatMap((p) => p.columns.filter((c) => wanted.has(c.name)).map((c) => ref(p, c.name))));
  const [status, setStatus] = useState<MappingStatus>(m.status);
  const [note, setNote] = useState(m.note);
  const [q, setQ] = useState('');
  const toggle = (r: string) => setSel(sel.includes(r) ? sel.filter((x) => x !== r) : [...sel, r]);
  // tables the requirement already uses are listed first
  const [order] = useState(() => [...profiles].sort((a, b) => Number(m.sources.includes(b.label)) - Number(m.sources.includes(a.label))));
  const save = () => {
    const picked = profiles.flatMap((p) => p.columns.filter((c) => sel.includes(ref(p, c.name))).map((c) => ({ p, c })));
    updateMapping(pid, m.id, { sources: [...new Set(picked.map((x) => x.p.label))], fields: picked.map((x) => x.c.name), status, note: note.trim() });
    onClose();
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={`Map “${m.requirement}”`}
      footer={
        <>
          {m.userEdited && <Button variant="ghost" className="mr-auto" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={() => { resetMapping(pid, m.id); onClose(); }}>Use agent suggestion</Button>}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save}>Save</Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label={`Columns used (${sel.length} selected)`}>
          <input className="input mb-1.5 py-1 text-xs" placeholder="Search columns…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="max-h-60 overflow-y-auto rounded-lg border border-slate-200">
            {order.map((p) => {
              const cs = p.columns.filter((c) => !q || c.name.toLowerCase().includes(q.toLowerCase()));
              if (!cs.length) return null;
              return (
                <div key={p.datasetId}>
                  <div className="sticky top-0 bg-slate-50 px-3 py-1 text-[0.6875rem] font-semibold uppercase tracking-wide text-slate-500">{p.label}</div>
                  {cs.map((c) => (
                    <label key={c.name} className="flex cursor-pointer items-center gap-2 px-3 py-1 text-sm hover:bg-slate-50">
                      <input type="checkbox" checked={sel.includes(ref(p, c.name))} onChange={() => toggle(ref(p, c.name))} />
                      <span className="font-mono text-xs text-slate-800">{c.name}</span>
                      <span className="ml-auto text-[0.6875rem] text-slate-400">{ROLE_LABEL[c.role]}</span>
                    </label>
                  ))}
                </div>
              );
            })}
          </div>
        </Field>
        <Field label="Status"><select className="input" value={status} onChange={(e) => setStatus(e.target.value as MappingStatus)}>{(Object.keys(STATUS_LABEL) as MappingStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select></Field>
        <Field label="Note" hint="How it is worked out, or what is missing."><textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
