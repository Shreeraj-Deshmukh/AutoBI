import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, Target, Gauge, Layers3, Filter, LayoutGrid, FileCheck2, CheckCircle2, RefreshCw, Pencil } from 'lucide-react';
import type { Project, RequirementSection } from '@/types';
import StageLayout from '@/components/StageLayout';
import Chat from '@/components/Chat';
import EditableList from '@/components/EditableList';
import AgentPanel from '@/components/AgentPanel';
import { Button, Badge, Modal, Field, Empty } from '@/components/ui';
import { analyseRequirements, answerClarification, approveRequirements, chat, editRequirementItems, generateRequirementSpec, isRunning, updateInfo } from '@/store/orchestrator';

const MAIN: { key: RequirementSection; title: string; icon: JSX.Element; ph: string }[] = [
  { key: 'objectives', title: 'Objectives', icon: <Target className="h-4 w-4 text-brand-600" />, ph: 'Add objective…' },
  { key: 'stories', title: 'User stories', icon: <BookOpen className="h-4 w-4 text-brand-600" />, ph: 'As a … I want to … so that …' },
  { key: 'kpis', title: 'KPIs', icon: <Gauge className="h-4 w-4 text-brand-600" />, ph: 'e.g. Calls by specialty' },
  { key: 'dimensions', title: 'Breakdowns', icon: <Layers3 className="h-4 w-4 text-brand-600" />, ph: 'e.g. Specialty' },
  { key: 'filters', title: 'Filters', icon: <Filter className="h-4 w-4 text-brand-600" />, ph: 'e.g. State' },
  { key: 'pages', title: 'Dashboard pages', icon: <LayoutGrid className="h-4 w-4 text-brand-600" />, ph: 'e.g. Territory Deep Dive' },
];
const MORE: { key: RequirementSection; title: string }[] = [
  { key: 'rules', title: 'Business rules' },
  { key: 'visuals', title: 'Visual ideas' },
  { key: 'datasets', title: 'Data needed' },
];

export default function RequirementsStage({ p }: { p: Project }) {
  const nav = useNavigate();
  const busy = isRunning(p, 'requirement');
  const r = p.requirements;
  const [editInfo, setEditInfo] = useState(false);
  const [info, setInfo] = useState(p.info);
  const st = p.stages.requirements.status;

  const main = !r ? (
    <Empty icon={<FileCheck2 className="h-5 w-5" />} title="No requirements yet">Describe the dashboard in the assistant on the right.</Empty>
  ) : (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={p.requirementsStatus === 'approved' ? 'green' : st === 'pending_approval' ? 'amber' : 'blue'}>
          {p.requirementsStatus === 'approved' ? `Specification v${p.requirementsVersion} approved` : st === 'pending_approval' ? `v${p.requirementsVersion} awaiting approval` : 'Draft'}
        </Badge>
        <Button size="sm" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => { setInfo(p.info); setEditInfo(true); }}>Project details</Button>
        <Button size="sm" variant="ghost" icon={<RefreshCw className="h-3.5 w-3.5" />} loading={busy} onClick={() => analyseRequirements(p.id, p.narrative)} disabled={!p.narrative}>Re-analyse</Button>
        <div className="ml-auto">
          {p.requirementsStatus === 'approved' ? (
            <Button size="sm" variant="primary" onClick={() => nav(`/p/${p.id}/data`)}>Continue to Data →</Button>
          ) : st === 'pending_approval' ? (
            <Button size="sm" variant="success" icon={<CheckCircle2 className="h-3.5 w-3.5" />} onClick={() => approveRequirements(p.id)}>Approve Specification</Button>
          ) : (
            <Button size="sm" variant="primary" icon={<FileCheck2 className="h-3.5 w-3.5" />} disabled={busy} onClick={() => generateRequirementSpec(p.id)}>Generate Requirements Specification</Button>
          )}
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {MAIN.map((s) => (
          <EditableList key={s.key} title={s.title} icon={s.icon} items={r[s.key] ?? []} placeholder={s.ph} onChange={(items) => editRequirementItems(p.id, s.key, items)} />
        ))}
      </div>
      <details className="card px-4 py-3">
        <summary className="cursor-pointer text-sm font-medium text-slate-700">More details <span className="text-xs font-normal text-slate-400">— business rules, visual ideas, data needed{r.missing.length ? `, ${r.missing.length} assumption(s)` : ''}</span></summary>
        <div className="mt-3 grid gap-4 md:grid-cols-3">
          {MORE.map((s) => <EditableList key={s.key} title={s.title} items={r[s.key]} onChange={(items) => editRequirementItems(p.id, s.key, items)} />)}
        </div>
        {r.missing.length > 0 && <ul className="mt-3 list-disc pl-5 text-xs text-slate-500">{r.missing.map((m) => <li key={m}>{m}</li>)}</ul>}
      </details>
    </>
  );

  const side = (
    <>
      <Chat
        title="Requirement assistant"
        messages={p.chat}
        busy={busy}
        placeholder={r ? 'Reply or ask for a change…' : 'Describe the dashboard…'}
        onSend={(t) => chat(p.id, t)}
        onOption={(m, o) => {
          const c = r?.ambiguities.find((a) => a.id === m.clarificationId);
          if (c && !c.answer) answerClarification(p.id, c, o);
          else chat(p.id, o);
        }}
      />
      <AgentPanel p={p} agent="requirement" />
    </>
  );

  return (
    <>
      <StageLayout main={main} side={side} />
      <Modal open={editInfo} onClose={() => setEditInfo(false)} title="Project details" footer={<><Button onClick={() => setEditInfo(false)}>Cancel</Button><Button variant="primary" onClick={() => { updateInfo(p.id, info); setEditInfo(false); }}>Save</Button></>}>
        <div className="grid gap-3 sm:grid-cols-2">
          {(['name', 'client', 'domain', 'audience', 'frequency', 'period'] as const).map((k) => (
            <Field key={k} label={k[0].toUpperCase() + k.slice(1)}><input className="input" value={info[k]} onChange={(e) => setInfo({ ...info, [k]: e.target.value })} /></Field>
          ))}
          <div className="sm:col-span-2"><Field label="Objective"><input className="input" value={info.objective} onChange={(e) => setInfo({ ...info, objective: e.target.value })} /></Field></div>
          <div className="sm:col-span-2"><Field label="Key questions (one per line)"><textarea className="input" rows={3} value={info.keyQuestions.join('\n')} onChange={(e) => setInfo({ ...info, keyQuestions: e.target.value.split('\n').filter(Boolean) })} /></Field></div>
        </div>
      </Modal>
    </>
  );
}
