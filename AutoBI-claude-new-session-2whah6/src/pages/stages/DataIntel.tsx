import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Upload, Trash2, CheckCircle2, XCircle, Link2, AlertTriangle, RefreshCw, FlaskConical, Table2, Cable } from 'lucide-react';
import ConnectSource from '@/components/ConnectSource';
import type { Project } from '@/types';
import StageLayout from '@/components/StageLayout';
import AgentPanel from '@/components/AgentPanel';
import { Button, Callout, Card, Badge, Tabs, MapBadge, Modal, cx } from '@/components/ui';
import { confirmUnderstanding, isRunning, removeDataset, runDataIntelligenceAgent, setRelationshipStatus, toggleIssue, uploadFiles } from '@/store/orchestrator';
import { getRows } from '@/lib/rowStore';
import { useRowsVersion } from '@/store/engineCache';
import { DEMO_KITS, fetchKitFiles } from '@/lib/demoKits';
import { fmtNumber, humanize } from '@/lib/util';
import { useStore } from '@/store/store';

type Tab = 'datasets' | 'links' | 'mapping';

export default function DataStage({ p }: { p: Project }) {
  const nav = useNavigate();
  useRowsVersion();
  const [tab, setTab] = useState<Tab>('datasets');
  const [drag, setDrag] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [attaching, setAttaching] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const busy = isRunning(p, 'data');
  const u = p.understanding;
  const label = (id: string) => u?.profiles.find((x) => x.datasetId === id)?.label ?? p.datasets.find((d) => d.id === id)?.name ?? id;
  const onFiles = (files: FileList | File[] | null) => files && files.length && uploadFiles(p.id, Array.from(files));
  const done = p.stages.data.status === 'completed';
  const openIssues = u?.issues.filter((i) => i.severity !== 'info' && !i.resolved) ?? [];
  const missing = u?.mappings.filter((m) => m.status === 'missing') ?? [];
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
        <span className="flex items-center gap-1.5 text-xs text-slate-500">
          <FlaskConical className="h-3.5 w-3.5" /> Dataset library:
          {DEMO_KITS.map((k) => <Button key={k.id} size="xs" disabled={busy || attaching} onClick={() => attachKit(k)}>{k.title}</Button>)}
        </span>
        <input ref={fileRef} type="file" multiple accept=".csv,.txt,.xlsx,.xls,.json" className="hidden" data-testid="file-input" onChange={(e) => { onFiles(e.target.files); e.target.value = ''; }} />
      </div>

      {u && (
        <div className="flex flex-wrap items-center gap-2">
          <Tabs<Tab> className="flex-1" value={tab} onChange={setTab} tabs={[{ id: 'datasets', label: 'Datasets', count: p.datasets.length }, { id: 'links', label: 'Relationships & quality', count: openIssues.length || undefined }, { id: 'mapping', label: 'Requirement mapping', count: missing.length || undefined }]} />
          <Button size="sm" variant="ghost" icon={<RefreshCw className="h-3.5 w-3.5" />} loading={busy} onClick={() => runDataIntelligenceAgent(p.id)}>Re-run</Button>
          {done ? (
            <Button size="sm" variant="primary" onClick={() => nav(`/p/${p.id}/foundation`)}>Continue →</Button>
          ) : (
            <Button size="sm" variant="success" icon={<CheckCircle2 className="h-3.5 w-3.5" />} disabled={busy || p.requirementsStatus !== 'approved'} title={p.requirementsStatus !== 'approved' ? 'Approve the requirements first' : ''} onClick={() => confirmUnderstanding(p.id) && nav(`/p/${p.id}/foundation`)}>Confirm data understanding</Button>
          )}
        </div>
      )}

      {tab === 'datasets' && (
        <div className="grid gap-3 md:grid-cols-2">
          {p.datasets.map((d) => {
            const prof = u?.profiles.find((x) => x.datasetId === d.id);
            return (
              <div key={d.id} className="card p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2"><span className="font-semibold text-navy-900">{prof?.label ?? d.name}</span>{prof && <Badge tone={prof.kind === 'activity' ? 'blue' : prof.kind === 'master' ? 'violet' : 'slate'}>{prof.kind === 'activity' ? 'Activity' : prof.kind === 'master' ? 'Master' : humanize(prof.kind)}</Badge>}</div>
                    <div className="text-[0.6875rem] text-slate-500">{d.format === 'databricks' ? 'Databricks · ' : d.format === 'snowflake' ? 'Snowflake · ' : ''}{d.fileName} · {fmtNumber(d.rowCount)} rows · {d.columnCount} columns{d.status === 'profiling' && ' · profiling…'}</div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button size="xs" variant="ghost" icon={<Table2 className="h-3 w-3" />} onClick={() => setOpen(d.id)}>Details</Button>
                    <Button size="xs" variant="ghost" icon={<Trash2 className="h-3 w-3" />} onClick={() => confirm(`Remove ${d.fileName}?`) && removeDataset(p.id, d.id)} aria-label="Remove dataset" />
                  </div>
                </div>
                {prof && <p className="mt-2 text-sm text-slate-600">{prof.inference}</p>}
                {prof?.dateField && <div className="mt-1 text-[0.6875rem] text-slate-400">{prof.columns.find((c) => c.name === prof.dateField)?.dateMin} → {prof.columns.find((c) => c.name === prof.dateField)?.dateMax}</div>}
              </div>
            );
          })}
          {!p.datasets.length && <div className="card col-span-full p-8 text-center text-sm text-slate-500">No datasets yet. Upload files, connect Databricks or Snowflake, or attach a dataset from the library.</div>}
        </div>
      )}

      {tab === 'links' && u && (
        <>
          <Card title="Relationships" bodyClass="p-0">
            {u.relationships.length ? (
              <ul className="divide-y divide-slate-100">
                {u.relationships.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                    <span className="font-medium">{label(r.fromDataset)}</span><Link2 className="h-3.5 w-3.5 text-slate-400" /><span className="font-medium">{label(r.toDataset)}</span>
                    <span className="font-mono text-xs text-slate-500">on {r.fromField}</span>
                    <span className={cx('text-xs', r.unmatched ? 'text-amber-600' : 'text-slate-500')}>{(r.matchRate * 100).toFixed(1)}% matched</span>
                    <span className="ml-auto flex items-center gap-1">
                      <Badge tone={r.status === 'confirmed' ? 'green' : r.status === 'rejected' ? 'red' : 'amber'}>{humanize(r.status)}</Badge>
                      <Button size="xs" variant="ghost" icon={<CheckCircle2 className="h-3 w-3" />} onClick={() => setRelationshipStatus(p.id, r.id, 'confirmed')} aria-label="Confirm" />
                      <Button size="xs" variant="ghost" icon={<XCircle className="h-3 w-3" />} onClick={() => setRelationshipStatus(p.id, r.id, 'rejected')} aria-label="Reject" />
                    </span>
                  </li>
                ))}
              </ul>
            ) : <div className="p-4 text-sm text-slate-500">No relationships detected between the datasets.</div>}
          </Card>
          <Card title="Data quality" bodyClass="p-0">
            {u.issues.filter((i) => i.severity !== 'info').length ? (
              <ul className="divide-y divide-slate-100">
                {u.issues.filter((i) => i.severity !== 'info').map((i) => (
                  <li key={i.id} className={cx('flex gap-3 px-4 py-2.5', i.resolved && 'opacity-50')}>
                    <AlertTriangle className={cx('mt-0.5 h-4 w-4 shrink-0', i.severity === 'error' ? 'text-red-500' : 'text-amber-500')} />
                    <div className="min-w-0 flex-1 text-sm"><div className="text-slate-700">{i.message}</div><div className="text-xs text-slate-500">{i.impact} {i.suggestion}</div></div>
                    <Button size="xs" variant="ghost" onClick={() => toggleIssue(p.id, i.id)}>{i.resolved ? 'Re-open' : 'Acknowledge'}</Button>
                  </li>
                ))}
              </ul>
            ) : <div className="p-4 text-sm text-emerald-700">No data-quality warnings.</div>}
          </Card>
        </>
      )}

      {tab === 'mapping' && u && (
        u.mappings.length ? (
          <Card bodyClass="p-0">
            <table className="w-full">
              <thead><tr><th className="th">Requirement</th><th className="th">Source</th><th className="th">Field(s)</th><th className="th">Status</th></tr></thead>
              <tbody>
                {u.mappings.filter((m, i, a) => a.findIndex((x) => x.requirement.toLowerCase() === m.requirement.toLowerCase()) === i).map((m) => (
                  <tr key={m.id} title={m.note}>
                    <td className="td font-medium text-navy-900">{m.requirement}</td>
                    <td className="td text-sm">{m.sources.join(' + ') || '—'}</td>
                    <td className="td font-mono text-xs">{m.fields.join(', ') || '—'}</td>
                    <td className="td"><MapBadge status={m.status} />{m.status === 'missing' && <div className="mt-0.5 text-[0.6875rem] text-red-600">{m.note}</div>}</td>
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
      <StageLayout main={main} side={<AgentPanel p={p} agent="data" next={done ? 'The Reporting Foundation Agent proposes the reporting model.' : p.requirementsStatus !== 'approved' ? 'Approve the requirements, then confirm the data understanding.' : 'Review, then confirm the data understanding.'} />} />
      {connecting && <ConnectSource pid={p.id} onClose={() => setConnecting(false)} />}
      <Modal open={!!ds} onClose={() => setOpen(null)} title={prof?.label ?? ds?.name ?? ''} wide>
        {ds && <DatasetDetails id={ds.id} columns={ds.columns} prof={prof} />}
      </Modal>
    </>
  );
}

function DatasetDetails({ id, columns, prof }: { id: string; columns: string[]; prof?: NonNullable<Project['understanding']>['profiles'][number] }) {
  const [view, setView] = useState<'columns' | 'preview'>(prof ? 'columns' : 'preview');
  const rows = getRows(id).slice(0, 30);
  return (
    <>
      <Tabs<'columns' | 'preview'> className="mb-3" value={view} onChange={setView} tabs={[...(prof ? [{ id: 'columns' as const, label: 'Columns' }] : []), { id: 'preview', label: 'Data preview' }]} />
      {view === 'columns' && prof ? (
        <table className="w-full">
          <thead><tr><th className="th">Column</th><th className="th">Type</th><th className="th text-right">Missing</th><th className="th text-right">Distinct</th><th className="th">Meaning</th></tr></thead>
          <tbody>
            {prof.columns.map((c) => (
              <tr key={c.name}>
                <td className="td font-medium text-navy-900">{c.name}{c.name === prof.primaryKey && <Badge tone="navy" className="ml-1.5">Key</Badge>}</td>
                <td className="td text-xs">{humanize(c.role)} · {c.type}</td>
                <td className={cx('td text-right tabular-nums', c.missing > 0 && 'text-amber-600')}>{c.missing}</td>
                <td className="td text-right tabular-nums">{fmtNumber(c.distinct)}</td>
                <td className="td text-xs text-slate-500">{c.businessDefinition}</td>
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
    </>
  );
}
