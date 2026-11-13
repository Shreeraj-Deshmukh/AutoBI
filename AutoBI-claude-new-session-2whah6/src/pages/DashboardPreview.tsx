import { useEffect } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Printer, ShieldCheck } from 'lucide-react';
import { useProject } from '@/store/store';
import { useEngine } from '@/store/engineCache';
import { loadRows } from '@/lib/rowStore';
import DashboardView from '@/dashboard/DashboardView';
import { Logo } from '@/components/Layout';
import { Empty } from '@/components/ui';
import { fmtDateTime } from '@/lib/util';
import { FEATURES } from '@/config/features';

export default function DashboardPreview() {
  const { pid } = useParams();
  const p = useProject(pid);
  const engine = useEngine(p);
  const [params, setParams] = useSearchParams();
  const viewer = FEATURES.rowLevelSecurity ? p?.release?.users.find((x) => x.id === params.get('as')) : undefined;
  useEffect(() => {
    if (p) loadRows(p.datasets.map((d) => d.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p?.id]);
  if (!p?.dashboard || !engine || !p.foundation) return <div className="p-10"><Empty title="Dashboard not available">Generate the dashboard in the Development stage first. <Link to="/" className="text-brand-700 underline">Home</Link></Empty></div>;
  return (
    <DashboardView
      fullscreen
      spec={p.dashboard.spec}
      engine={engine}
      foundation={p.foundation}
      locked={viewer && p.release?.securityField && viewer.values.length ? { field: p.release.securityField, values: viewer.values, user: viewer.name } : undefined}
      header={
        <div className="flex flex-wrap items-center gap-3 bg-navy-900 px-4 py-2 text-white no-print">
          <Link to={`/p/${p.id}/development`} className="flex items-center gap-1 text-xs text-brand-100 hover:text-white"><ArrowLeft className="h-3.5 w-3.5" />Back to Celestra</Link>
          <div className="h-5 w-px bg-white/20" />
          <Logo compact />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{p.info.name}</div>
            <div className="text-[0.625rem] text-brand-200/80">Dashboard v{p.dashboard.version} · design v{p.dashboard.designVersion} · generated {fmtDateTime(p.dashboard.generatedAt)}</div>
          </div>
          {FEATURES.rowLevelSecurity && p.release?.users.length ? (
            <label className="ml-auto flex items-center gap-1.5 text-xs text-brand-100">
              <ShieldCheck className="h-3.5 w-3.5" /> View as
              <select className="rounded-md border border-white/20 bg-navy-800 px-2 py-1 text-xs text-white" value={viewer?.id ?? ''} onChange={(e) => setParams(e.target.value ? { as: e.target.value } : {})} aria-label="View as user">
                <option value="">Full access</option>
                {p.release.users.filter((x) => x.values.length).map((x) => <option key={x.id} value={x.id}>{x.name} — {x.values.join(', ')}</option>)}
              </select>
            </label>
          ) : null}
          <button onClick={() => window.print()} className={`${FEATURES.rowLevelSecurity && p.release?.users.length ? "" : "ml-auto "}flex items-center gap-1 rounded-md bg-white/10 px-2.5 py-1 text-xs hover:bg-white/20`}><Printer className="h-3.5 w-3.5" />Print / PDF</button>
        </div>
      }
    />
  );
}
