import type { ReactNode } from 'react';
import type { AgentId, Project } from '@/types';
import AgentPanel, { AgentProgress } from './AgentPanel';

/**
 * Two-column stage layout. While the stage's agent runs, a step-by-step loader sits
 * above the main content; the agent log is always the last card in the right column.
 */
export default function StageLayout({ p, agent, next, main, side }: { p: Project; agent: AgentId; next?: string; main: ReactNode; side?: ReactNode }) {
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_21.25rem]">
      <div className="min-w-0 space-y-5">
        <AgentProgress p={p} agent={agent} />
        {main}
      </div>
      <div className="space-y-4 xl:sticky xl:top-4 xl:self-start">
        {side}
        <AgentPanel p={p} agent={agent} next={next} />
      </div>
    </div>
  );
}
