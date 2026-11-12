import { ArrowRight, Bot, CheckCircle2, Circle, Loader2, User, AlertTriangle, Flag } from 'lucide-react';
import type { AgentId, Project } from '@/types';
import { AGENTS, ARTIFACT_FLOW } from '@/agents/registry';
import { Card, cx, Badge } from '@/components/ui';
import { fmtDateTime } from '@/lib/util';


function agentState(p: Project, id: AgentId) {
  const runs = p.runs.filter((r) => r.agentId === id);
  if (runs[0]?.status === 'running') return 'running';
  if (runs.length) return runs[0].status === 'failed' ? 'failed' : 'done';
  return 'idle';
}

export function WorkflowGraph({ p }: { p: Project }) {
  return (
    <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
      {AGENTS.map((a, i) => {
        const s = agentState(p, a.id);
        const flow = ARTIFACT_FLOW.find((f) => f.from === a.id);
        return (
          <li key={a.id} className={cx('flex flex-col rounded-xl border p-3', s === 'running' ? 'border-brand-400 bg-brand-50 ring-2 ring-brand-100' : s === 'done' ? 'border-emerald-200 bg-emerald-50/40' : s === 'failed' ? 'border-red-200 bg-red-50' : 'border-slate-200 bg-white')}>
            <div className="flex items-center justify-between">
              <span className="font-mono text-[0.625rem] text-slate-400">{String(i + 1).padStart(2, '0')}</span>
              {s === 'running' ? <Loader2 className="h-3.5 w-3.5 animate-spin text-brand-600" /> : s === 'done' ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : <Circle className="h-3.5 w-3.5 text-slate-300" />}
            </div>
            <div className="mt-1.5 text-xs font-semibold leading-tight text-navy-900">{a.name}</div>
            <div className="mt-auto pt-2 text-[0.625rem] leading-snug text-slate-500">{flow ? <span className="flex items-center gap-1"><ArrowRight className="h-3 w-3 shrink-0" />{flow.artifact}</span> : 'Final package'}</div>
          </li>
        );
      })}
    </ol>
  );
}

export default function ProjectAgents({ p }: { p: Project }) {
  return (
    <div className="space-y-5">
      <Card title="Agent workflow" subtitle="Each agent consumes the previous agent's artifact. Approval gates sit between stages.">
        <WorkflowGraph p={p} />
      </Card>
      <Card title="Activity" subtitle="Agent runs, approvals and warnings" >
        <ol className="relative space-y-3 border-l border-slate-200 pl-5">
          {p.history.map((h) => (
            <li key={h.id} className="relative">
              <span className={cx('absolute -left-[1.6875rem] top-0.5 flex h-4 w-4 items-center justify-center rounded-full', h.kind === 'agent' ? 'bg-brand-100 text-brand-700' : h.kind === 'gate' ? 'bg-emerald-100 text-emerald-700' : h.kind === 'warning' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500')}>
                {h.kind === 'agent' ? <Bot className="h-2.5 w-2.5" /> : h.kind === 'gate' ? <Flag className="h-2.5 w-2.5" /> : h.kind === 'warning' ? <AlertTriangle className="h-2.5 w-2.5" /> : <User className="h-2.5 w-2.5" />}
              </span>
              <div className="flex flex-wrap items-center gap-2 text-[0.6875rem] text-slate-500">
                <span className="font-medium text-slate-700">{h.actor}</span>
                {h.kind === 'gate' && <Badge tone="green">Approval</Badge>}
                <span>{fmtDateTime(h.at)}</span>
              </div>
              <div className="text-xs text-slate-600">{h.message}</div>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
