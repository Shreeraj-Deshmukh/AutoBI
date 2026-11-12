import { Link, NavLink, useNavigate, useParams } from 'react-router-dom';
import { useEffect } from 'react';
import { Lock, AlertTriangle, ExternalLink, Bot, CheckCircle2 } from 'lucide-react';
import type { Project, StageId } from '@/types';
import { useProject, mutate } from '@/store/store';
import { STAGES } from '@/agents/registry';
import { progress, stageGate, log } from '@/store/orchestrator';
import { loadRows } from '@/lib/rowStore';
import { Button, Callout, Empty, Progress, StageBadge, cx } from './ui';
import RequirementsStage from '@/pages/stages/Requirements';
import DataStage from '@/pages/stages/DataIntel';
import FoundationStage from '@/pages/stages/Foundation';
import DesignStage from '@/pages/stages/DesignStudio';
import DevelopmentStage from '@/pages/stages/Development';
import TestingStage from '@/pages/stages/Testing';
import DocumentationStage from '@/pages/stages/Documentation';
import ProjectAgents from '@/pages/ProjectAgents';

const VIEWS: Record<StageId, (props: { p: Project }) => JSX.Element> = {
  requirements: RequirementsStage,
  data: DataStage,
  foundation: FoundationStage,
  design: DesignStage,
  development: DevelopmentStage,
  testing: TestingStage,
  documentation: DocumentationStage,
};

export default function ProjectShell() {
  const { pid, stage } = useParams();
  const p = useProject(pid);
  const nav = useNavigate();
  useEffect(() => {
    if (p) loadRows(p.datasets.map((d) => d.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p?.id, p?.datasets.length]);
  if (!p) return <div className="p-8"><Empty title="Project not found" action={<Button onClick={() => nav('/projects')}>Back to projects</Button>}>It may have been deleted.</Empty></div>;
  const isAgents = stage === 'agents';
  const sid = (isAgents ? 'requirements' : stage) as StageId;
  const meta = STAGES.find((s) => s.id === sid);
  if (!meta && !isAgents) return <div className="p-8"><Empty title="Unknown stage" /></div>;
  const gate = stageGate(p, sid);
  const st = p.stages[sid];
  const View = VIEWS[sid];
  const pct = progress(p);

  return (
    <div className="flex min-h-full flex-col">
      {/* Project header */}
      <div className="border-b border-slate-200 bg-white">
        <div className="flex flex-wrap items-start justify-between gap-3 px-6 pt-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Link to="/projects" className="hover:text-slate-700">Projects</Link>
              <span>/</span>
              <span className="truncate">{p.info.client || 'Project'}</span>
            </div>
            <h1 className="mt-0.5 truncate text-xl font-semibold text-navy-900">{p.info.name}</h1>
            <div className="mt-0.5 text-xs text-slate-500">{[p.info.domain, p.info.audience && `Audience: ${p.info.audience}`, p.info.frequency && `${p.info.frequency} reporting`].filter(Boolean).join(' · ')}</div>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-40">
              <div className="mb-1 flex justify-between text-[0.6875rem] text-slate-500"><span>Overall progress</span><span className="font-semibold text-slate-700">{pct}%</span></div>
              <Progress value={pct} tone={pct === 100 ? 'green' : 'brand'} />
            </div>
            <Button size="sm" variant={isAgents ? 'subtle' : 'secondary'} icon={<Bot className="h-3.5 w-3.5" />} onClick={() => nav(`/p/${p.id}/agents`)}>Agents</Button>
            {p.dashboard && (
              <Button size="sm" variant="primary" icon={<ExternalLink className="h-3.5 w-3.5" />} onClick={() => nav(`/p/${p.id}/preview`)}>Open dashboard</Button>
            )}
          </div>
        </div>
        {/* Stepper */}
        <nav className="mt-3 flex overflow-x-auto px-4" aria-label="Workflow stages">
          {STAGES.map((s, i) => {
            const g = stageGate(p, s.id);
            const status = p.stages[s.id];
            const done = ['approved', 'completed'].includes(status.status);
            return (
              <NavLink
                key={s.id}
                to={g.open ? `/p/${p.id}/${s.id}` : '#'}
                onClick={(e) => !g.open && e.preventDefault()}
                title={g.open ? `${s.label}: ${status.status.replace('_', ' ')}` : g.reason}
                className={({ isActive }) => cx('group relative flex min-w-[8.75rem] flex-1 items-center gap-2 border-b-2 px-2 py-2.5', isActive && !isAgents ? 'border-brand-600' : 'border-transparent', !g.open && 'cursor-not-allowed opacity-50')}
              >
                <span className={cx('flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[0.6875rem] font-semibold', done ? 'bg-emerald-500 text-white' : status.status === 'pending_approval' ? 'bg-amber-400 text-white' : status.status === 'in_progress' ? 'bg-brand-600 text-white' : status.status === 'blocked' ? 'bg-red-500 text-white' : 'bg-slate-200 text-slate-500')}>
                  {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : !g.open ? <Lock className="h-3 w-3" /> : i + 1}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[0.8125rem] font-medium text-slate-800">{s.label}</span>
                  <span className="flex items-center gap-1 text-[0.625rem] text-slate-500">
                    {status.needsReview ? <span className="flex items-center gap-0.5 text-amber-600"><AlertTriangle className="h-3 w-3" />Needs review</span> : status.status.replace(/_/g, ' ')}
                  </span>
                </span>
              </NavLink>
            );
          })}
        </nav>
      </div>

      <div className="flex-1 px-6 py-5">
        {isAgents ? (
          <ProjectAgents p={p} />
        ) : !gate.open ? (
          <Empty icon={<Lock className="h-5 w-5" />} title={`${meta!.label} is locked`} action={<Button onClick={() => nav(-1)}>Go back</Button>}>
            {gate.reason}
          </Empty>
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <h2 className="text-lg font-semibold text-navy-900">{meta!.label}</h2>
              <StageBadge status={st.status} />
            </div>
            {st.needsReview && (
              <div className="mb-4">
                <Callout
                  tone="warning"
                  title="Upstream change detected — this stage needs review"
                  action={
                    <Button size="sm" onClick={() => mutate(p.id, (pp) => { pp.stages[sid].needsReview = undefined; log(pp, 'User', 'user', `Reviewed impact of upstream change and kept current ${meta!.label} artifact`, sid); })}>
                      Keep current artifact
                    </Button>
                  }
                >
                  {st.needsReview}. Previously approved artifacts are preserved — regenerate this stage to incorporate the change, or confirm the current artifact is still valid.
                </Callout>
              </div>
            )}
            <View p={p} />
          </>
        )}
      </div>
    </div>
  );
}
