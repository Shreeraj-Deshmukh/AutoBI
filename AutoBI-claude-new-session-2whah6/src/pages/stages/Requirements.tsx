import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, Target, Gauge, Layers3, Filter, LayoutGrid, FileCheck2, CheckCircle2, RefreshCw, Scale, BarChart3, Database } from 'lucide-react';
import type { Project, RequirementSection } from '@/types';
import StageLayout from '@/components/StageLayout';
import Chat from '@/components/Chat';
import EditableList from '@/components/EditableList';
import { Button, Badge, Empty } from '@/components/ui';
import { analyseRequirements, answerClarification, approveRequirements, chat, editRequirementItems, generateRequirementSpec, isRunning } from '@/store/orchestrator';

const ic = 'h-4 w-4 text-brand-600';
const SECTIONS: { key: RequirementSection; title: string; icon: JSX.Element; ph: string }[] = [
  { key: 'objectives', title: 'Objectives', icon: <Target className={ic} />, ph: 'Add objective…' },
  { key: 'stories', title: 'User stories', icon: <BookOpen className={ic} />, ph: 'As a … I want to … so that …' },
  { key: 'kpis', title: 'KPIs', icon: <Gauge className={ic} />, ph: 'e.g. Calls by specialty' },
  { key: 'dimensions', title: 'Breakdowns', icon: <Layers3 className={ic} />, ph: 'e.g. Specialty' },
  { key: 'filters', title: 'Filters', icon: <Filter className={ic} />, ph: 'e.g. State' },
  { key: 'pages', title: 'Dashboard pages', icon: <LayoutGrid className={ic} />, ph: 'e.g. Territory Deep Dive' },
  { key: 'rules', title: 'Business rules', icon: <Scale className={ic} />, ph: 'e.g. Exclude test accounts' },
  { key: 'visuals', title: 'Visual ideas', icon: <BarChart3 className={ic} />, ph: 'e.g. Trend line of calls' },
  { key: 'datasets', title: 'Data needed', icon: <Database className={ic} />, ph: 'e.g. Call activity' },
];

export default function RequirementsStage({ p }: { p: Project }) {
  const nav = useNavigate();
  const busy = isRunning(p, 'requirement');
  const r = p.requirements;
  // one section open at a time keeps the page readable
  const [openKey, setOpenKey] = useState<RequirementSection | null>('objectives');
  const st = p.stages.requirements.status;

  const main = !r ? (
    busy ? null : <Empty icon={<FileCheck2 className="h-5 w-5" />} title="No requirements yet">Describe the dashboard in the assistant on the right.</Empty>
  ) : (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={p.requirementsStatus === 'approved' ? 'green' : st === 'pending_approval' ? 'amber' : 'blue'}>
          {p.requirementsStatus === 'approved' ? `Specification v${p.requirementsVersion} approved` : st === 'pending_approval' ? `v${p.requirementsVersion} awaiting approval` : 'Draft'}
        </Badge>
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
      <div className="space-y-2.5">
        {SECTIONS.map((s) => (
          <EditableList
            key={s.key}
            collapsible
            open={openKey === s.key}
            onToggle={() => setOpenKey(openKey === s.key ? null : s.key)}
            title={s.title}
            icon={s.icon}
            items={r[s.key] ?? []}
            placeholder={s.ph}
            onChange={(items) => editRequirementItems(p.id, s.key, items)}
          />
        ))}
      </div>
      {r.missing.length > 0 && (
        <details className="card px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium text-slate-700">Assumptions <span className="text-xs font-normal text-slate-400">({r.missing.length})</span></summary>
          <ul className="mt-2 list-disc pl-5 text-xs text-slate-500">{r.missing.map((m) => <li key={m}>{m}</li>)}</ul>
        </details>
      )}
    </>
  );

  const side = (
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
  );

  return <StageLayout p={p} agent="requirement" main={main} side={side} />;
}
