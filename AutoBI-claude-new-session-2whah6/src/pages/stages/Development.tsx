import { useNavigate } from 'react-router-dom';
import { Hammer, ExternalLink, CheckCircle2, XCircle, RefreshCw, Code2 } from 'lucide-react';
import type { Project } from '@/types';
import StageLayout from '@/components/StageLayout';
import AgentPanel, { RunView } from '@/components/AgentPanel';
import { Button, Callout, Card, Empty } from '@/components/ui';
import DashboardView from '@/dashboard/DashboardView';
import AccessCard from '@/components/AccessCard';
import { FEATURES } from '@/config/features';
import { isRunning, runDevelopmentAgent } from '@/store/orchestrator';
import { useEngine } from '@/store/engineCache';
import { fmtDateTime } from '@/lib/util';

export default function DevelopmentStage({ p }: { p: Project }) {
  const nav = useNavigate();
  const engine = useEngine(p);
  const busy = isRunning(p, 'development');
  const b = p.dashboard;
  const run = p.runs.find((r) => r.agentId === 'development');
  const stale = b && p.design && b.designVersion !== p.design.version;

  const main = (
    <>
      {busy && run && (
        <Card title={<span className="flex items-center gap-2"><Hammer className="h-4 w-4 text-brand-600" />Dashboard Development Agent is building your dashboard</span>}>
          <RunView r={run} />
        </Card>
      )}
      {!b && !busy && (
        <Empty icon={<Hammer className="h-5 w-5" />} title="Dashboard not generated yet" action={<Button variant="primary" onClick={() => runDevelopmentAgent(p.id)}>Start development</Button>}>The approved design v{p.design?.version} will be compiled into a working dashboard connected to the ingested data.</Empty>
      )}
      {b && (
        <>
          {stale && <Callout tone="warning" title={`Dashboard was built from design v${b.designVersion}; the current design is v${p.design!.version} (${p.design!.status}).`} action={p.design!.status === 'approved' ? <Button size="sm" variant="primary" onClick={() => runDevelopmentAgent(p.id)}>Rebuild from v{p.design!.version}</Button> : <Button size="sm" onClick={() => nav(`/p/${p.id}/design`)}>Approve new design</Button>}>The current dashboard is preserved until a new approved design is developed.</Callout>}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-slate-600">Dashboard <b>v{b.version}</b> · built {fmtDateTime(b.generatedAt)} from design v{b.designVersion} · {b.summary.pages} pages, {b.summary.kpis} KPIs, {b.summary.charts} charts</span>
            <div className="ml-auto flex gap-2">
              <Button size="sm" icon={<RefreshCw className="h-3.5 w-3.5" />} loading={busy} disabled={p.design?.status !== 'approved'} onClick={() => runDevelopmentAgent(p.id)}>Rebuild</Button>
              <Button size="sm" icon={<ExternalLink className="h-3.5 w-3.5" />} onClick={() => nav(`/p/${p.id}/preview`)}>Open full-screen</Button>
              <Button size="sm" variant="primary" onClick={() => nav(`/p/${p.id}/testing`)}>Continue to Testing →</Button>
            </div>
          </div>
          {b.warnings.length > 0 && <Callout tone="warning" title={`${b.warnings.length} build warning(s)`}>{b.warnings.join(' ')}</Callout>}
          {engine && p.foundation && <DashboardView spec={b.spec} engine={engine} foundation={p.foundation} />}
          {FEATURES.rowLevelSecurity && <AccessCard p={p} />}
          <details className="card px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium text-slate-700">Build details — {b.validations.filter((v) => v.ok).length}/{b.validations.length} components validated, {b.transformations.length} transformations</summary>
          <div className="mt-3 grid gap-4 lg:grid-cols-2">
            <Card title="Component validation" subtitle={`${b.validations.filter((v) => v.ok).length}/${b.validations.length} components rendered with data`} bodyClass="p-0">
              <table className="w-full">
                <tbody>
                  {b.validations.map((v) => (
                    <tr key={v.componentId}>
                      <td className="td w-6">{v.ok ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <XCircle className="h-4 w-4 text-red-500" />}</td>
                      <td className="td"><div className="text-sm font-medium text-navy-900">{v.title}</div><div className="text-[0.6875rem] text-slate-500">{v.page}</div></td>
                      <td className="td text-xs text-slate-500">{v.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
              <Card title={<span className="flex items-center gap-2"><Code2 className="h-4 w-4" />Transformations & generated logic</span>} bodyClass="">
                <ul className="space-y-1 font-mono text-[0.6875rem] text-slate-600">{b.transformations.map((t) => <li key={t}>{t}</li>)}</ul>
              </Card>
          </div>
          </details>
        </>
      )}
    </>
  );
  return <StageLayout main={main} side={<AgentPanel p={p} agent="development" next={b ? 'The generated dashboard is handed to the Testing & UAT Agent, which inspects every component to generate test cases.' : 'The agent compiles the approved design specification into a working dashboard.'} />} />;
}
