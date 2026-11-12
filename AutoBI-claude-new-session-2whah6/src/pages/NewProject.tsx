import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, FileText, Stethoscope, ShoppingBag, Pill, Route } from 'lucide-react';
import { Button, cx } from '@/components/ui';
import PageHeader from '@/components/PageHeader';
import { analyseRequirements, createProject } from '@/store/orchestrator';
import type { ProjectInfo } from '@/types';
import { DEMO_KITS } from '@/lib/demoKits';

const EMPTY: ProjectInfo = { name: '', client: '', domain: '', objective: '', audience: '', problem: '', frequency: '', period: '', keyQuestions: [] };
const STARTS = [
  { id: 'blank', title: 'Blank project', text: 'Your own brief and data', icon: FileText },
  { id: 'access', title: 'Patient access (FRM)', text: 'SP funnel, payer/PBM & HCP data', icon: Route },
  { id: 'brand', title: 'Brand performance', text: 'TRx/NRx, territories & field calls', icon: Pill },
  { id: 'hcp', title: 'HCP engagement', text: 'Pharma calls & email data', icon: Stethoscope },
  { id: 'retail', title: 'Retail sales', text: 'Stores & transactions data', icon: ShoppingBag },
] as const;

function Section({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <div className="grid gap-4 border-t border-slate-200 py-8 first:border-t-0 first:pt-0 md:grid-cols-[15rem_1fr] md:gap-10">
      <div>
        <h2 className="text-sm font-semibold text-navy-950">{title}</h2>
        <p className="mt-1 text-[0.8125rem] leading-relaxed text-slate-500">{hint}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export default function NewProject() {
  const nav = useNavigate();
  const [start, setStart] = useState<(typeof STARTS)[number]['id']>('blank');
  const [info, setInfo] = useState<ProjectInfo>(EMPTY);
  const [narrative, setNarrative] = useState('');
  const set = (k: keyof ProjectInfo) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setInfo({ ...info, [k]: e.target.value });
  const pick = (id: (typeof STARTS)[number]['id']) => {
    setStart(id);
    const kit = DEMO_KITS.find((k) => k.id === id);
    if (kit) {
      setInfo({ ...EMPTY, name: kit.project, domain: kit.domain, client: kit.client });
      setNarrative(kit.narrative);
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
    <div className="min-h-full bg-slate-50 pb-24">
      <PageHeader crumbs={[{ label: 'Projects', to: '/projects' }, { label: 'New project' }]} title="New project" description="Name it, describe the dashboard in plain words, and the agents draft the specification." />
      <div className="mx-auto max-w-6xl px-6 py-8">
        <div className="rounded-xl border border-slate-200 bg-white p-8">
          <Section title="Start from" hint="Begin blank, or start from a dataset in the library — it fills in the brief, and its files can be attached in the Data step.">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" role="radiogroup">
              {STARTS.map((s) => (
                <button key={s.id} role="radio" aria-checked={start === s.id} onClick={() => pick(s.id)} className={cx('flex items-start gap-3 rounded-lg border p-3.5 text-left transition', start === s.id ? 'border-navy-800 bg-navy-900/[0.03] ring-1 ring-navy-800' : 'border-slate-200 hover:border-slate-300')}>
                  <s.icon className={cx('mt-0.5 h-4 w-4', start === s.id ? 'text-navy-900' : 'text-slate-400')} />
                  <span>
                    <span className="block text-sm font-semibold text-navy-950">{s.title}</span>
                    <span className="block text-xs text-slate-500">{s.text}</span>
                  </span>
                </button>
              ))}
            </div>
          </Section>
          <Section title="Project" hint="Shown on the dashboard and in every generated document.">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="sm:col-span-2"><span className="label">Project name</span><input className="input" value={info.name} onChange={set('name')} placeholder="Sales Performance Dashboard" autoFocus /></label>
              <label><span className="label">Client or business unit</span><input className="input" value={info.client} onChange={set('client')} placeholder="Commercial Operations" /></label>
              <label><span className="label">Audience</span><input className="input" value={info.audience} onChange={set('audience')} placeholder="Regional managers" /></label>
              <label><span className="label">Reporting frequency</span>
                <select className="input" value={info.frequency} onChange={set('frequency')}>
                  <option value="">Not decided</option>
                  {['Daily', 'Weekly', 'Monthly', 'Quarterly'].map((x) => <option key={x}>{x}</option>)}
                </select>
              </label>
              <label><span className="label">Domain</span><input className="input" value={info.domain} onChange={set('domain')} placeholder="Sales, HR, supply chain…" /></label>
            </div>
          </Section>
          <Section title="The dashboard" hint="Say what it should monitor, how to break it down, and which filters people need. The assistant asks only about what's unclear.">
            <textarea className="input min-h-[11.25rem] leading-relaxed" value={narrative} onChange={(e) => setNarrative(e.target.value)} placeholder="Track monthly revenue and order volume by region and product line, compare with the previous period, and let managers filter by channel and region." />
            <div className="mt-2 text-xs text-slate-400">{narrative.trim() ? `${narrative.trim().split(/\s+/).length} words` : 'You can also leave this empty and describe it in the chat.'}</div>
          </Section>
        </div>
      </div>
      <div className="fixed bottom-0 left-0 right-0 border-t border-slate-200 bg-white/95 backdrop-blur lg:left-[var(--sidebar-w,15rem)]">
        <div className="mx-auto flex max-w-6xl items-center justify-end gap-2 px-6 py-3">
          <Button variant="ghost" onClick={() => nav('/projects')}>Cancel</Button>
          <Button variant="primary" disabled={!info.name.trim()} onClick={submit}>Create project <ArrowRight className="h-4 w-4" /></Button>
        </div>
      </div>
    </div>
  );
}
