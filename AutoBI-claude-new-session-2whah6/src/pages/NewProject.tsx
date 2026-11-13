import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, FileText, FlaskConical } from 'lucide-react';
import { Button, cx } from '@/components/ui';
import PageHeader from '@/components/PageHeader';
import { analyseRequirements, createProject } from '@/store/orchestrator';
import type { ProjectInfo } from '@/types';
import { SHOWN_KITS as DEMO_KITS } from '@/lib/demoKits';

const EMPTY: ProjectInfo = { name: '', client: '', domain: '', objective: '', audience: '', problem: '', frequency: '', period: '', keyQuestions: [] };

function Section({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <div className="grid gap-3 border-t border-slate-200 py-5 first:border-t-0 first:pt-0 md:grid-cols-[12rem_1fr] md:gap-8">
      <div>
        <h2 className="text-sm font-semibold text-navy-950">{title}</h2>
        <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{hint}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

const option = (active: boolean) => cx('flex h-10 items-center gap-2 rounded-lg border px-3 text-sm font-medium transition', active ? 'border-navy-800 bg-navy-900/[0.03] text-navy-950 ring-1 ring-navy-800' : 'border-slate-200 text-slate-600 hover:border-slate-300');

export default function NewProject() {
  const nav = useNavigate();
  /** 'blank' or a sample kit id. */
  const [start, setStart] = useState<string>('blank');
  const [info, setInfo] = useState<ProjectInfo>(EMPTY);
  const [narrative, setNarrative] = useState('');
  const set = (k: keyof ProjectInfo) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setInfo({ ...info, [k]: e.target.value });
  const kit = DEMO_KITS.find((k) => k.id === start);
  const pick = (id: string) => {
    setStart(id);
    const k = DEMO_KITS.find((x) => x.id === id);
    if (k) {
      setInfo({ ...EMPTY, name: k.project, domain: k.domain, client: k.client });
      setNarrative(k.narrative);
    } else {
      setInfo(EMPTY);
      setNarrative('');
    }
  };
  const submit = async () => {
    const id = createProject({ ...info, name: info.name.trim() || 'Untitled reporting project' }, narrative);
    nav(`/p/${id}/requirements`);
    if (narrative.trim()) await analyseRequirements(id, narrative.trim());
  };
  return (
    <div className="min-h-full bg-slate-50">
      <PageHeader crumbs={[{ label: 'Projects', to: '/projects' }, { label: 'New project' }]} title="New project" description="Name it, describe the dashboard in plain words, and the agents draft the specification." />
      <div className="mx-auto max-w-6xl px-6 py-5">
        <div className="rounded-xl border border-slate-200 bg-white">
          <div className="p-6">
            <Section title="Start from" hint="Blank, or a sample project that fills in the brief.">
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" aria-pressed={start === 'blank'} onClick={() => pick('blank')} className={option(start === 'blank')}>
                  <FileText className="h-4 w-4" /> Blank project
                </button>
                <label className={cx(option(!!kit), 'cursor-pointer pr-1')}>
                  <FlaskConical className="h-4 w-4" />
                  <select aria-label="Sample project" value={kit?.id ?? ''} onChange={(e) => pick(e.target.value || 'blank')} className="cursor-pointer bg-transparent pr-1 text-sm font-medium focus:outline-none">
                    <option value="">Sample project…</option>
                    {DEMO_KITS.map((k) => <option key={k.id} value={k.id}>{k.title}</option>)}
                  </select>
                </label>
                {kit && <span className="text-xs text-slate-500">Upload its files in the Data step ·{kit.note}</span>}
              </div>
            </Section>
            <Section title="Project" hint="Shown on the dashboard and in every generated document.">
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="sm:col-span-2"><span className="label">Project name</span><input className="input" value={info.name} onChange={set('name')} placeholder="Sales Performance Dashboard" autoFocus /></label>
                <label><span className="label">Domain</span><input className="input" value={info.domain} onChange={set('domain')} placeholder="Sales, HR, supply chain…" /></label>
                <label><span className="label">Client or business unit</span><input className="input" value={info.client} onChange={set('client')} placeholder="Commercial Operations" /></label>
                <label><span className="label">Audience</span><input className="input" value={info.audience} onChange={set('audience')} placeholder="Regional managers" /></label>
                <label><span className="label">Reporting frequency</span>
                  <select className="input" value={info.frequency} onChange={set('frequency')}>
                    <option value="">Not decided</option>
                    {['Daily', 'Weekly', 'Monthly', 'Quarterly'].map((x) => <option key={x}>{x}</option>)}
                  </select>
                </label>
              </div>
            </Section>
            <Section title="The dashboard" hint="What it should monitor, how to break it down, and which filters people need.">
              <textarea className="input min-h-[7.5rem] leading-relaxed" rows={5} value={narrative} onChange={(e) => setNarrative(e.target.value)} placeholder="Track monthly revenue and order volume by region and product line, compare with the previous period, and let managers filter by channel and region." />
              <div className="mt-1 text-xs text-slate-400">{narrative.trim() ? `${narrative.trim().split(/\s+/).length} words` : 'You can also leave this empty and describe it in the chat.'}</div>
            </Section>
          </div>
          <div className="flex items-center justify-end gap-2 rounded-b-xl border-t border-slate-200 bg-slate-50/60 px-6 py-3">
            <Button variant="ghost" onClick={() => nav('/projects')}>Cancel</Button>
            <Button variant="primary" disabled={!info.name.trim()} onClick={submit}>Create project <ArrowRight className="h-4 w-4" /></Button>
          </div>
        </div>
      </div>
    </div>
  );
}
