import { useNavigate } from 'react-router-dom';
import { PlusCircle, RotateCcw, Trash2, Download, ExternalLink } from 'lucide-react';
import { useStore } from '@/store/store';
import { Button, Card, Progress, StageBadge } from '@/components/ui';
import { currentStage, deleteProject, progress } from '@/store/orchestrator';
import { ensureDemo } from '@/store/seed';
import { STAGES } from '@/agents/registry';
import { DEMO_KITS, downloadKit } from '@/lib/demoKits';
import PageHeader from '@/components/PageHeader';
import { fmtDateTime } from '@/lib/util';

export default function Home() {
  const nav = useNavigate();
  const projects = useStore((s) => s.projects);
  return (
    <div className="min-h-full bg-slate-50">
      <PageHeader title="Projects" description="Each project moves from business brief to a tested, documented dashboard." actions={<Button variant="primary" icon={<PlusCircle className="h-4 w-4" />} onClick={() => nav('/new')}>New project</Button>} />
      <div className="mx-auto max-w-6xl space-y-6 px-6 py-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {projects.map((p) => {
          const cs = currentStage(p);
          return (
            <div key={p.id} className="card flex cursor-pointer flex-col p-4 transition hover:border-brand-300" onClick={() => nav(`/p/${p.id}/${cs}`)}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-semibold text-navy-900">{p.info.name}</div>
                  <div className="truncate text-xs text-slate-500">{p.info.client || p.info.domain || 'Reporting project'}</div>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between text-xs">
                <span className="text-slate-600">{STAGES.find((s) => s.id === cs)?.label}</span>
                <StageBadge status={p.stages[cs].status} />
              </div>
              <div className="mt-2 flex items-center gap-2">
                <Progress value={progress(p)} tone={progress(p) === 100 ? 'green' : 'brand'} />
                <span className="text-xs font-medium text-slate-600">{progress(p)}%</span>
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2 text-[0.6875rem] text-slate-500" onClick={(e) => e.stopPropagation()}>
                <span>Updated {fmtDateTime(p.updatedAt)}</span>
                <span className="flex gap-1">
                  {p.dashboard && <Button size="xs" variant="ghost" icon={<ExternalLink className="h-3 w-3" />} onClick={() => nav(`/p/${p.id}/preview`)}>Dashboard</Button>}
                  {p.isDemo ? (
                    <Button size="xs" variant="ghost" icon={<RotateCcw className="h-3 w-3" />} title="Reset to original state" onClick={() => confirm(`Reset "${p.info.name}" to its original state?`) && ensureDemo(true)} />
                  ) : (
                    <Button size="xs" variant="ghost" icon={<Trash2 className="h-3 w-3" />} title="Delete project" onClick={() => confirm(`Delete "${p.info.name}"?`) && deleteProject(p.id)} />
                  )}
                </span>
              </div>
            </div>
          );
        })}
        <button onClick={() => nav('/new')} className="flex min-h-[9.375rem] flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 text-sm text-slate-500 hover:border-brand-400 hover:text-brand-700">
          <PlusCircle className="mb-1 h-5 w-5" /> New project
        </button>
      </div>

      <Card title="Dataset library" subtitle="Ready-made datasets. Download the files, or attach them in one click in a project's Data step.">
        <div className="grid gap-3 md:grid-cols-2">
          {DEMO_KITS.map((k) => (
            <div key={k.id} className="rounded-lg border border-slate-200 p-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-navy-900">{k.title}</div>
                <Button size="xs" icon={<Download className="h-3 w-3" />} onClick={() => downloadKit(k)}>Download files</Button>
              </div>
              <div className="mt-0.5 text-[0.6875rem] text-slate-500">{k.note}</div>
              <div className="mt-2 flex flex-wrap gap-1">{k.files.map((f) => <span key={f} className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[0.625rem] text-slate-600">{f}</span>)}</div>
            </div>
          ))}
        </div>
      </Card>
      </div>
    </div>
  );
}
