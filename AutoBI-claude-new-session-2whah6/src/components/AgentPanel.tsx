import { CheckCircle2, Circle, Loader2, AlertTriangle, XCircle, ArrowRight, Bot } from 'lucide-react';
import type { AgentId, AgentRun, AgentStep, Project } from '@/types';
import { agentMeta } from '@/agents/registry';
import { cx, Badge } from './ui';
import { fmtDateTime } from '@/lib/util';
import type { ReactNode } from 'react';

export function StepIcon({ s }: { s: AgentStep['status'] }) {
  if (s === 'done') return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
  if (s === 'running') return <Loader2 className="h-3.5 w-3.5 animate-spin text-brand-600" />;
  if (s === 'warning') return <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />;
  if (s === 'error') return <XCircle className="h-3.5 w-3.5 text-red-500" />;
  return <Circle className="h-3.5 w-3.5 text-slate-300" />;
}

export function RunStatus({ r }: { r: AgentRun }) {
  const m = { running: ['Running', 'blue'], completed: ['Completed', 'green'], completed_with_warnings: ['Completed · warnings', 'amber'], failed: ['Failed', 'red'] } as const;
  const [l, t] = m[r.status];
  return <Badge tone={t}>{r.status === 'running' && <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-current" />}{l}</Badge>;
}

export function RunView({ r, compact }: { r: AgentRun; compact?: boolean }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <RunStatus r={r} />
        <span className="text-[0.6875rem] text-slate-400">{fmtDateTime(r.startedAt)}</span>
      </div>
      {r.summary && <div className="text-xs text-slate-700">{r.summary}</div>}
      {!compact && (
        <ul className="space-y-1">
          {r.steps.map((s, i) => (
            <li key={i} className={cx('flex items-start gap-2 text-xs', s.status === 'pending' ? 'text-slate-400' : 'text-slate-600')}>
              <span className="mt-0.5">
                <StepIcon s={s.status} />
              </span>
              {s.label}
            </li>
          ))}
        </ul>
      )}
      {r.warnings.length > 0 && (
        <details className="rounded-md bg-amber-50 px-2 py-1 text-[0.6875rem] text-amber-800">
          <summary className="cursor-pointer font-medium">{r.warnings.length} warning(s)</summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {r.warnings.slice(0, 8).map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </details>
      )}
      {r.errors.map((e, i) => (
        <div key={i} className="rounded-md bg-red-50 px-2 py-1 text-[0.6875rem] text-red-700">
          {e}
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-1 text-[0.625rem] text-slate-500">
        {r.inputs.map((x) => (
          <span key={x} className="rounded bg-slate-100 px-1.5 py-0.5">{x}</span>
        ))}
        {r.outputs.length > 0 && <ArrowRight className="h-3 w-3" />}
        {r.outputs.map((x) => (
          <span key={x} className="rounded bg-brand-50 px-1.5 py-0.5 text-brand-700">{x}</span>
        ))}
      </div>
      <div className="text-[0.625rem] text-slate-400">Engine: {r.engine}</div>
    </div>
  );
}

export default function AgentPanel({ p, agent, next, children }: { p: Project; agent: AgentId; next?: string; children?: ReactNode }) {
  const meta = agentMeta(agent);
  const runs = p.runs.filter((r) => r.agentId === agent);
  const latest = runs[0];
  const running = latest?.status === 'running';
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-2.5 bg-navy-900 px-4 py-2.5 text-white" title={meta.role}>
        <Bot className="h-4 w-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[0.8125rem] font-semibold">{meta.name}</div>
          <div className="truncate text-[0.6875rem] text-brand-100/80">
            {running ? <span className="flex items-center gap-1"><span className="pulse-dot h-1.5 w-1.5 rounded-full bg-emerald-300" />{latest.steps.find((s) => s.status === 'running')?.label ?? 'Working'}…</span> : latest ? latest.engine : 'Not yet run'}
          </div>
        </div>
        {latest && !running && <RunStatus r={latest} />}
      </div>
      <div className="space-y-2.5 px-4 py-3">
        {latest?.summary && <p className="text-xs text-slate-700">{latest.summary}</p>}
        {children}
        {next && <p className="text-xs text-brand-800"><span className="font-semibold">Next: </span>{next}</p>}
        {latest && (
          <details className="text-xs">
            <summary className="cursor-pointer text-slate-500">Run details{runs.length > 1 ? ` · ${runs.length} runs` : ''}</summary>
            <div className="mt-2 space-y-3">
              <RunView r={latest} />
              {runs.slice(1, 6).map((r) => (
                <div key={r.id} className="border-l-2 border-slate-200 pl-2"><RunView r={r} compact /></div>
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}
