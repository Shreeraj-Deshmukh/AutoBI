import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Play, PlayCircle, Plus, CheckCircle2, XCircle, ExternalLink, Paperclip, Trash2, ClipboardCheck, ShieldCheck, Search, RefreshCw, Ban, RotateCcw } from 'lucide-react';
import type { Defect, Priority, Project, TestCase, TestStatus } from '@/types';
import StageLayout from '@/components/StageLayout';
import AgentPanel from '@/components/AgentPanel';
import { Button, Callout, Card, Badge, Tabs, Modal, Field, Empty, Stat, TestBadge, cx } from '@/components/ui';
import { addComment, addTestCase, deleteTestCase, executeTests, isRunning, runTestingAgent, signOffUat, uatGateIssues, updateDefect, updateTest } from '@/store/orchestrator';
import { summarize } from '@/agents/documentationAgent';
import { QC_CATEGORIES, SUITE_LABEL, TEST_CATEGORIES } from '@/agents/testingAgent';
import { fmtDateTime } from '@/lib/util';

type Tab = 'technical' | 'qc' | 'uat' | 'defects';
const STATUSES: TestStatus[] = ['Not Started', 'In Progress', 'Passed', 'Failed', 'Blocked', 'Requires Retesting'];
const PRIORITIES: Priority[] = ['Critical', 'High', 'Medium', 'Low'];
const PAGE_SIZE = 25;

export default function TestingStage({ p }: { p: Project }) {
  const nav = useNavigate();
  const T = p.testing;
  const busy = isRunning(p, 'testing');
  const [tab, setTab] = useState<Tab>('technical');
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState<'technical' | 'qc' | null>(null);

  if (!T)
    return (
      <StageLayout
        main={<Empty icon={<ClipboardCheck className="h-5 w-5" />} title="No test cases yet" action={<Button variant="primary" loading={busy} onClick={() => runTestingAgent(p.id)}>Generate test cases</Button>}>The Testing Agent inspects every filter, chart and table of dashboard v{p.dashboard?.version} and writes Functional Testing cases and Data Validation scenarios.</Empty>}
        side={<AgentPanel p={p} agent="testing" next="Generate tests, run the automated ones, then complete UAT." />}
      />
    );

  const s = summarize(T.cases);
  const failed = T.cases.filter((c) => c.status === 'Failed');
  const testOpen = T.cases.find((c) => c.id === open);
  const stale = p.dashboard && T.dashboardVersion !== p.dashboard.version;
  const count = (suite: 'technical' | 'qc') => T.cases.filter((c) => c.suite === suite).length;

  const main = (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Test cases" value={s.total} sub={`${s.automated} automated · ${s.manual} manual`} />
        <Stat label="Passed" value={s.passed} tone="green" sub={`${s.execPct.toFixed(0)}% executed`} />
        <Stat label="Failed" value={s.failed} tone={s.failed ? 'red' : undefined} sub={s.blocked ? `${s.blocked} blocked` : 'see Defects'} />
        <Stat label="Awaiting UAT" value={T.cases.filter((c) => c.execution === 'Manual' && !['Passed', 'Failed', 'Blocked'].includes(c.status)).length} sub="manual checks" />
      </div>
      {stale && <Callout tone="warning" title={`Tests were written for dashboard v${T.dashboardVersion}; the dashboard is now v${p.dashboard!.version}.`} action={<Button size="sm" variant="primary" onClick={() => runTestingAgent(p.id)}>Regenerate</Button>} />}
      <div className="flex flex-wrap items-center gap-2">
        <Tabs<Tab> className="flex-1" value={tab} onChange={setTab} tabs={[{ id: 'technical', label: SUITE_LABEL.technical, count: count('technical') }, { id: 'qc', label: SUITE_LABEL.qc, count: count('qc') }, { id: 'uat', label: 'UAT', count: s.manual }, { id: 'defects', label: 'Defects', count: failed.length }]} />
        <Button size="sm" variant="primary" icon={<PlayCircle className="h-3.5 w-3.5" />} loading={busy} onClick={() => executeTests(p.id)}>Run automated tests</Button>
        <Button size="sm" variant="ghost" icon={<RefreshCw className="h-3.5 w-3.5" />} disabled={busy} onClick={() => confirm('Regenerate the test suite from the current dashboard?') && runTestingAgent(p.id)}>Regenerate</Button>
      </div>
      {(tab === 'technical' || tab === 'qc') && <CaseTable key={tab} p={p} suite={tab} onOpen={setOpen} onAdd={() => setAdding(tab)} onSwitch={setTab} />}
      {tab === 'uat' && (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <UatTab p={p} onOpen={setOpen} />
          <SignoffCard p={p} onDocs={() => nav(`/p/${p.id}/documentation`)} />
        </div>
      )}
      {tab !== 'uat' && T.signoff.status !== 'approved' && s.execPct === 100 && <Callout tone="info" title="All tests executed">Open the UAT tab to sign off.</Callout>}
      {tab === 'defects' && <DefectTab p={p} onOpenTest={setOpen} />}
    </>
  );

  return (
    <>
      <div className="space-y-5">{main}</div>
      {testOpen && <TestDetail p={p} c={testOpen} onClose={() => setOpen(null)} />}
      {adding && <NewTest p={p} suite={adding} onClose={() => setAdding(null)} />}
    </>
  );
}

function CaseTable({ p, suite, onOpen, onAdd, onSwitch }: { p: Project; suite: 'technical' | 'qc'; onOpen: (id: string) => void; onAdd: () => void; onSwitch: (t: Tab) => void }) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [st, setSt] = useState('');
  const [limit, setLimit] = useState(PAGE_SIZE);
  const busy = isRunning(p, 'testing');
  const all = p.testing!.cases.filter((c) => c.suite === suite);
  const cases = all.filter((c) => (!cat || c.category === cat) && (!st || c.status === st) && (!q || `${c.id} ${c.component} ${c.objective} ${c.page}`.toLowerCase().includes(q.toLowerCase())));
  const cats = [...new Set(all.map((c) => c.category))];
  const qc = suite === 'qc';
  // the header counters span both suites; when this tab has no match, say where the matches are
  const other: 'technical' | 'qc' = qc ? 'technical' : 'qc';
  const elsewhere = cases.length || (!st && !q) ? 0 : p.testing!.cases.filter((c) => c.suite === other && (!st || c.status === st) && (!q || `${c.id} ${c.component} ${c.objective} ${c.page}`.toLowerCase().includes(q.toLowerCase()))).length;
  return (
    <Card bodyClass="p-0">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
        <div className="relative"><Search className="absolute left-2 top-2 h-3.5 w-3.5 text-slate-400" /><input className="input w-56 py-1.5 pl-7 text-xs" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <select className="input w-auto py-1.5 text-xs" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category filter"><option value="">{qc ? 'All QC categories' : 'All test types'}</option>{cats.map((c) => <option key={c}>{c}</option>)}</select>
        <select className="input w-auto py-1.5 text-xs" value={st} onChange={(e) => setSt(e.target.value)} aria-label="Status filter"><option value="">All statuses</option>{STATUSES.map((c) => <option key={c}>{c}</option>)}</select>
        <span className="text-xs text-slate-500">{cases.length} of {all.length}</span>
        <Button size="sm" variant="ghost" className="ml-auto" icon={<Plus className="h-3.5 w-3.5" />} onClick={onAdd}>Add {qc ? 'scenario' : 'test case'}</Button>
      </div>
      <table className="w-full table-fixed">
        <colgroup>
          <col className="w-12" />
          {qc ? <><col className="w-44" /><col className="w-40" /><col /><col className="w-72" /></> : <><col className="w-24" /><col className="w-36" /><col className="w-24" /><col /><col className="w-64" /></>}
          <col className="w-24" />
          <col className="w-12" />
        </colgroup>
        <thead>
          <tr>
            <th className="th">S. No.</th>
            {qc ? <><th className="th">Section</th><th className="th">QC Category</th><th className="th">Business Validation</th><th className="th">Expected Outcome</th></> : <><th className="th">Test Type</th><th className="th">Dashboard Element</th><th className="th">Element Type</th><th className="th">Test Case</th><th className="th">Expected Result</th></>}
            <th className="th">Status</th>
            <th className="th" />
          </tr>
        </thead>
        <tbody>
          {!cases.length && (
            <tr>
              <td className="td py-6 text-center text-xs text-slate-500" colSpan={qc ? 7 : 8} data-testid="no-match">
                No {st ? `"${st}" ` : ''}test cases match in {SUITE_LABEL[suite]}.
                {elsewhere > 0 && (
                  <> {elsewhere} matching case{elsewhere === 1 ? ' is' : 's are'} in {SUITE_LABEL[other]}.{' '}
                    <button className="font-medium text-brand-700 hover:underline" onClick={() => onSwitch(other)}>Show {SUITE_LABEL[other]}</button>
                  </>
                )}
              </td>
            </tr>
          )}
          {cases.slice(0, limit).map((c) => (
            <tr key={c.id} className="cursor-pointer align-top hover:bg-slate-50" onClick={() => onOpen(c.id)} data-testid="test-row">
              <td className="td text-xs text-slate-500" title={c.id}>{all.indexOf(c) + 1}</td>
              {qc ? (
                <>
                  <td className="td text-xs font-medium text-slate-800">{c.component}</td>
                  <td className="td text-xs">{c.category}</td>
                  <td className="td text-xs text-slate-700">{c.objective}</td>
                  <td className="td text-xs text-slate-500">{c.expected}</td>
                </>
              ) : (
                <>
                  <td className="td text-xs">{c.category}</td>
                  <td className="td text-xs font-medium text-slate-800">{c.component}</td>
                  <td className="td text-xs">{c.elementType}</td>
                  <td className="td text-xs text-slate-700">{c.steps.join(' ')}</td>
                  <td className="td text-xs text-slate-500">{c.expected}</td>
                </>
              )}
              <td className="td"><TestBadge status={c.status} /><div className="mt-1 text-[0.625rem] text-slate-400">{c.execution}</div></td>
              <td className="td text-right" onClick={(e) => e.stopPropagation()}>{c.check && <Button size="xs" variant="ghost" icon={<Play className="h-3 w-3" />} disabled={busy} onClick={() => executeTests(p.id, [c.id])} aria-label={`Run ${c.id}`} title="Run" />}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {cases.length > limit && <button className="w-full border-t border-slate-100 py-2.5 text-xs font-medium text-brand-700 hover:bg-slate-50" onClick={() => setLimit(limit + PAGE_SIZE)}>Show {Math.min(PAGE_SIZE, cases.length - limit)} more</button>}
    </Card>
  );
}

function UatTab({ p, onOpen }: { p: Project; onOpen: (id: string) => void }) {
  const manual = p.testing!.cases.filter((c) => c.execution === 'Manual');
  const [sel, setSel] = useState(manual.find((c) => c.status !== 'Passed')?.id ?? manual[0]?.id);
  const c = manual.find((x) => x.id === sel);
  const [actual, setActual] = useState('');
  const [comment, setComment] = useState('');
  const [who, setWho] = useState('UAT Analyst');
  return (
    <div className="grid gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
      <Card title={`Manual scenarios (${manual.filter((x) => ['Passed', 'Failed', 'Blocked'].includes(x.status)).length}/${manual.length} done)`} bodyClass="p-0">
        <ul className="divide-y divide-slate-100">
          {manual.map((x) => (
            <li key={x.id}>
              <button onClick={() => { setSel(x.id); setActual(x.actual); }} className={cx('w-full px-3 py-2 text-left hover:bg-slate-50', sel === x.id && 'bg-brand-50')}>
                <div className="flex items-center justify-between"><span className="font-mono text-[0.6875rem] text-slate-500">{x.id}</span><TestBadge status={x.status} /></div>
                <div className="mt-0.5 line-clamp-2 text-xs text-slate-700">{x.objective}</div>
                <div className="text-[0.625rem] text-slate-400">{x.page} · {x.component}</div>
              </button>
            </li>
          ))}
        </ul>
      </Card>
      {c ? (
        <Card title={<span className="flex items-center gap-2"><span className="font-mono text-xs text-slate-500">{c.id}</span>{c.objective}</span>} subtitle={`${c.category} · ${c.page} · ${c.component}`} actions={<Button size="sm" icon={<ExternalLink className="h-3.5 w-3.5" />} onClick={() => window.open(`#/p/${p.id}/preview`, '_blank')}>Open dashboard</Button>}>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <div className="label">Preconditions</div><div className="text-sm text-slate-600">{c.preconditions || '—'}</div>
              <div className="label mt-3">Test steps</div><ol className="list-decimal pl-5 text-sm text-slate-700">{c.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
              <div className="label mt-3">Expected result</div><div className="text-sm text-slate-700">{c.expected}</div>
            </div>
            <div className="space-y-3">
              <Field label="Analyst"><input className="input" value={who} onChange={(e) => setWho(e.target.value)} /></Field>
              <Field label="Actual result"><textarea className="input" rows={3} value={actual} onChange={(e) => setActual(e.target.value)} placeholder="What did you observe?" /></Field>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="success" icon={<CheckCircle2 className="h-3.5 w-3.5" />} onClick={() => updateTest(p.id, c.id, { status: 'Passed', actual: actual || 'As expected.' }, who)}>Pass</Button>
                <Button size="sm" variant="danger" icon={<XCircle className="h-3.5 w-3.5" />} onClick={() => { if (!actual.trim()) { alert('Record what you observed before failing a check.'); return; } updateTest(p.id, c.id, { status: 'Failed', actual }, who); }}>Fail</Button>
                <Button size="sm" icon={<Ban className="h-3.5 w-3.5" />} onClick={() => updateTest(p.id, c.id, { status: 'Blocked', actual: actual || 'Blocked' }, who)}>Blocked</Button>
                <Button size="sm" variant="ghost" onClick={() => updateTest(p.id, c.id, { status: 'In Progress' }, who)}>In progress</Button>
              </div>
              <div>
                <div className="label">Comments</div>
                <ul className="mb-2 space-y-1">{c.comments.map((m) => <li key={m.id} className="rounded bg-slate-50 px-2 py-1 text-xs"><b>{m.by}</b> <span className="text-slate-400">{fmtDateTime(m.at)}</span><div>{m.text}</div></li>)}</ul>
                <div className="flex gap-2"><input className="input py-1 text-xs" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Add analyst comment…" /><Button size="sm" disabled={!comment.trim()} onClick={() => { addComment(p.id, c.id, comment, who); setComment(''); }}>Add</Button></div>
              </div>
              <Button size="xs" variant="ghost" onClick={() => onOpen(c.id)}>Full details, evidence & attachments →</Button>
            </div>
          </div>
        </Card>
      ) : <Empty title="No manual tests" />}
    </div>
  );
}

function DefectTab({ p, onOpenTest }: { p: Project; onOpenTest: (id: string) => void }) {
  const T = p.testing!;
  const busy = isRunning(p, 'testing');
  const failed = T.cases.filter((c) => c.status === 'Failed' || T.defects.some((d) => d.testId === c.id && (d.status === 'Open' || d.status === 'In Progress')));
  if (!failed.length) return <Card><div className="flex items-center gap-2 py-4 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4" />No failed test cases.</div></Card>;
  return (
    <Card bodyClass="p-0">
      <table className="w-full table-fixed">
        <colgroup><col className="w-20" /><col className="w-[22%]" /><col /><col className="w-24" /><col className="w-36" /><col className="w-24" /></colgroup>
        <thead><tr><th className="th">Defect</th><th className="th">Test case</th><th className="th">What failed</th><th className="th">Severity</th><th className="th">Status</th><th className="th" /></tr></thead>
        <tbody>
          {failed.map((c) => {
            const d = [...T.defects].reverse().find((x) => x.testId === c.id);
            return (
              <tr key={c.id} className="align-top">
                <td className="td font-mono text-xs">{d?.id ?? '—'}</td>
                <td className="td text-xs"><button className="text-left font-medium text-brand-700 hover:underline" onClick={() => onOpenTest(c.id)}>{c.component}</button><div className="text-[0.625rem] text-slate-400">{SUITE_LABEL[c.suite]} · {c.category}</div></td>
                <td className="td text-xs text-slate-700">{c.actual || c.objective}<div className="mt-0.5 text-[0.6875rem] text-slate-400">Expected: {c.expected}</div></td>
                <td className="td"><Badge tone={c.priority === 'Critical' ? 'red' : c.priority === 'High' ? 'amber' : 'slate'}>{d?.severity ?? c.priority}</Badge></td>
                <td className="td">{d ? <select className="input py-1 text-xs" value={d.status} onChange={(e) => updateDefect(p.id, d.id, { status: e.target.value as Defect['status'] })} aria-label={`Status of ${d.id}`}>{['Open', 'In Progress', 'Resolved', 'Closed'].map((x) => <option key={x}>{x}</option>)}</select> : <TestBadge status={c.status} />}</td>
                <td className="td text-right">{c.check ? <Button size="xs" variant="ghost" icon={<RotateCcw className="h-3 w-3" />} disabled={busy} onClick={() => executeTests(p.id, [c.id])}>Retest</Button> : <Button size="xs" variant="ghost" onClick={() => onOpenTest(c.id)}>Open</Button>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}

function SignoffCard({ p, onDocs }: { p: Project; onDocs: () => void }) {
  const T = p.testing!;
  const issues = uatGateIssues(p);
  const [by, setBy] = useState(T.signoff.by ?? '');
  const [role, setRole] = useState(T.signoff.role ?? 'Business Analyst Lead');
  const [comments, setComments] = useState(T.signoff.comments ?? '');
  const [risks, setRisks] = useState(T.signoff.acceptedRisks ?? '');
  if (T.signoff.status === 'approved')
    return (
      <Card title={<span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-emerald-600" />UAT signed off</span>}>
        <div className="text-sm text-slate-700">By <b>{T.signoff.by}</b> ({T.signoff.role}) · {fmtDateTime(T.signoff.at)}</div>
        {T.signoff.comments && <div className="mt-1 text-xs text-slate-500">{T.signoff.comments}</div>}
        {T.signoff.acceptedRisks && <div className="mt-1 text-xs text-amber-700">Accepted risks: {T.signoff.acceptedRisks}</div>}
        <Button size="sm" variant="primary" className="mt-3 w-full" onClick={onDocs}>Generate final documentation →</Button>
      </Card>
    );
  const onlyDefects = issues.length > 0 && issues.every((i) => i.includes('Critical/High'));
  return (
    <Card title={<span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-brand-600" />UAT approval gate</span>} subtitle="Required before the project is ready for release">
      {issues.length ? <ul className="mb-3 space-y-1 text-xs text-amber-800">{issues.map((i) => <li key={i} className="flex gap-1.5"><XCircle className="mt-0.5 h-3 w-3 shrink-0" />{i}</li>)}</ul> : <div className="mb-3 flex items-center gap-1.5 text-xs text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" />All gate conditions met.</div>}
      <div className="space-y-2">
        <input className="input py-1.5 text-xs" placeholder="Approver name" value={by} onChange={(e) => setBy(e.target.value)} aria-label="Approver name" />
        <input className="input py-1.5 text-xs" placeholder="Role" value={role} onChange={(e) => setRole(e.target.value)} aria-label="Approver role" />
        <textarea className="input py-1.5 text-xs" rows={2} placeholder="Sign-off comments" value={comments} onChange={(e) => setComments(e.target.value)} aria-label="Sign-off comments" />
        {onlyDefects && <textarea className="input py-1.5 text-xs" rows={2} placeholder="Accepted risks for open defects (required to approve with open Critical/High defects)" value={risks} onChange={(e) => setRisks(e.target.value)} aria-label="Accepted risks" />}
        <div className="flex gap-2">
          <Button size="sm" variant="success" className="flex-1" disabled={!by.trim() || (issues.length > 0 && !(onlyDefects && risks.trim()))} onClick={() => signOffUat(p.id, { status: 'approved', by, role, comments, acceptedRisks: risks || undefined })}>Approve UAT</Button>
          <Button size="sm" variant="danger" disabled={!by.trim()} onClick={() => signOffUat(p.id, { status: 'rejected', by, role, comments })}>Reject</Button>
        </div>
        {T.signoff.status === 'rejected' && <div className="text-xs text-red-600">UAT rejected by {T.signoff.by} on {fmtDateTime(T.signoff.at)}.</div>}
      </div>
    </Card>
  );
}

function TestDetail({ p, c, onClose }: { p: Project; c: TestCase; onClose: () => void }) {
  const [d, setD] = useState(c);
  const [comment, setComment] = useState('');
  const busy = isRunning(p, 'testing');
  const save = () => {
    updateTest(p.id, c.id, { objective: d.objective, preconditions: d.preconditions, steps: d.steps, testData: d.testData, expected: d.expected, priority: d.priority, actual: d.actual, category: d.category, component: d.component, page: d.page, execution: c.check ? c.execution : d.execution });
    onClose();
  };
  const attach = (file?: File) => {
    if (!file) return;
    const add = (dataUrl?: string) => updateTest(p.id, c.id, { attachments: [...c.attachments, { name: file.name, size: file.size, dataUrl }] });
    if (file.size < 300_000) {
      const r = new FileReader();
      r.onload = () => add(String(r.result));
      r.readAsDataURL(file);
    } else add();
  };
  return (
    <Modal open onClose={onClose} wide title={<span className="flex items-center gap-2"><span className="text-sm text-slate-500">{SUITE_LABEL[c.suite]}</span>· {c.category}<TestBadge status={c.status} /></span>} footer={<>
      <Button variant="danger" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => { if (confirm(`Delete ${c.id}?`)) { deleteTestCase(p.id, c.id); onClose(); } }} className="mr-auto">Delete</Button>
      {c.check && <Button icon={<Play className="h-3.5 w-3.5" />} loading={busy} onClick={() => executeTests(p.id, [c.id])}>{c.status === 'Failed' ? 'Retest' : 'Execute'}</Button>}
      <Button variant="primary" onClick={save}>Save</Button>
    </>}>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Dashboard page"><input className="input" value={d.page} onChange={(e) => setD({ ...d, page: e.target.value })} /></Field>
        <Field label="Dashboard component"><input className="input" value={d.component} onChange={(e) => setD({ ...d, component: e.target.value })} /></Field>
        <div className="md:col-span-2"><Field label="Test objective"><input className="input" value={d.objective} onChange={(e) => setD({ ...d, objective: e.target.value })} /></Field></div>
        <Field label="Preconditions"><textarea className="input" rows={2} value={d.preconditions} onChange={(e) => setD({ ...d, preconditions: e.target.value })} /></Field>
        <Field label="Test data"><textarea className="input" rows={2} value={d.testData} onChange={(e) => setD({ ...d, testData: e.target.value })} /></Field>
        <Field label="Test steps (one per line)"><textarea className="input" rows={3} value={d.steps.join('\n')} onChange={(e) => setD({ ...d, steps: e.target.value.split('\n') })} /></Field>
        <Field label="Expected result"><textarea className="input" rows={3} value={d.expected} onChange={(e) => setD({ ...d, expected: e.target.value })} /></Field>
        <Field label="Priority"><select className="input" value={d.priority} onChange={(e) => setD({ ...d, priority: e.target.value as Priority })}>{PRIORITIES.map((x) => <option key={x}>{x}</option>)}</select></Field>
        <Field label="Execution type">{c.check ? <div className="py-2 text-sm"><Badge tone="blue">Automated</Badge> <span className="text-xs text-slate-500">validator: {c.check.kind}</span></div> : <select className="input" value={d.execution} onChange={(e) => setD({ ...d, execution: e.target.value as TestCase['execution'] })}><option>Manual</option></select>}</Field>
        <div className="md:col-span-2"><Field label="Actual result"><textarea className="input" rows={2} value={d.actual} onChange={(e) => setD({ ...d, actual: e.target.value })} disabled={!!c.check} /></Field></div>
        {c.evidence && <div className="md:col-span-2"><div className="label">Evidence / validation notes</div><pre className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 font-mono text-[0.6875rem] text-slate-700">{c.evidence}</pre></div>}
        <div className="md:col-span-2 text-xs text-slate-500">Runs: {c.runCount} · Last executed: {c.lastRunAt ? `${fmtDateTime(c.lastRunAt)} by ${c.executedBy}` : 'never'}</div>
        {!c.check && (
          <div className="md:col-span-2 flex gap-2">
            {(['Passed', 'Failed', 'Blocked', 'In Progress'] as TestStatus[]).map((s) => <Button key={s} size="sm" variant={s === 'Passed' ? 'success' : s === 'Failed' ? 'danger' : 'secondary'} onClick={() => updateTest(p.id, c.id, { status: s, actual: d.actual })}>Mark {s}</Button>)}
          </div>
        )}
        <div className="md:col-span-2">
          <div className="label">Attachments</div>
          <ul className="mb-2 space-y-1">{c.attachments.map((a, i) => <li key={i} className="flex items-center gap-2 text-xs"><Paperclip className="h-3 w-3" />{a.dataUrl ? <a href={a.dataUrl} download={a.name} className="text-brand-700 hover:underline">{a.name}</a> : a.name} <span className="text-slate-400">({Math.round(a.size / 1024)} KB{!a.dataUrl && ', metadata only'})</span></li>)}</ul>
          <input type="file" className="text-xs" onChange={(e) => attach(e.target.files?.[0])} aria-label="Attach evidence" />
        </div>
        <div className="md:col-span-2">
          <div className="label">Analyst comments</div>
          <ul className="mb-2 space-y-1">{c.comments.map((m) => <li key={m.id} className="rounded bg-slate-50 px-2 py-1 text-xs"><b>{m.by}</b> <span className="text-slate-400">{fmtDateTime(m.at)}</span> — {m.text}</li>)}</ul>
          <div className="flex gap-2"><input className="input py-1 text-xs" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Add comment…" /><Button size="sm" disabled={!comment.trim()} onClick={() => { addComment(p.id, c.id, comment); setComment(''); }}>Add</Button></div>
        </div>
      </div>
    </Modal>
  );
}

function NewTest({ p, suite, onClose }: { p: Project; suite: 'technical' | 'qc'; onClose: () => void }) {
  const [d, setD] = useState({ category: suite === 'qc' ? QC_CATEGORIES[0] : TEST_CATEGORIES[0], page: p.dashboard?.spec.pages[0]?.name ?? '', component: '', objective: '', steps: '', expected: '', priority: 'Medium' as Priority });
  return (
    <Modal open onClose={onClose} title={`Add ${suite === 'qc' ? 'business QC scenario' : 'test case'}`} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!d.objective.trim()} onClick={() => { addTestCase(p.id, { suite, category: d.category, page: d.page, component: d.component, objective: d.objective, steps: d.steps.split('\n').filter(Boolean), expected: d.expected, priority: d.priority, execution: 'Manual', elementType: 'Custom' }); onClose(); }}>Add</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Category"><select className="input" value={d.category} onChange={(e) => setD({ ...d, category: e.target.value })}>{(suite === 'qc' ? QC_CATEGORIES : TEST_CATEGORIES).map((x) => <option key={x}>{x}</option>)}</select></Field>
        <Field label="Priority"><select className="input" value={d.priority} onChange={(e) => setD({ ...d, priority: e.target.value as Priority })}>{PRIORITIES.map((x) => <option key={x}>{x}</option>)}</select></Field>
        <Field label="Page"><select className="input" value={d.page} onChange={(e) => setD({ ...d, page: e.target.value })}>{p.dashboard?.spec.pages.map((pg) => <option key={pg.id}>{pg.name}</option>)}</select></Field>
        <Field label="Component"><input className="input" value={d.component} onChange={(e) => setD({ ...d, component: e.target.value })} /></Field>
        <div className="sm:col-span-2"><Field label="Objective"><input className="input" value={d.objective} onChange={(e) => setD({ ...d, objective: e.target.value })} /></Field></div>
        <Field label="Steps (one per line)"><textarea className="input" rows={3} value={d.steps} onChange={(e) => setD({ ...d, steps: e.target.value })} /></Field>
        <Field label="Expected result"><textarea className="input" rows={3} value={d.expected} onChange={(e) => setD({ ...d, expected: e.target.value })} /></Field>
      </div>
      <div className="mt-2 text-xs text-slate-500">User-added tests are executed manually and are preserved when the suite is regenerated.</div>
    </Modal>
  );
}
