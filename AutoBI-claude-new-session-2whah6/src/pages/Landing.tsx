import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ResponsiveContainer, BarChart, Bar, XAxis, Cell, AreaChart, Area } from 'recharts';
import { ArrowRight, Check, ShieldCheck, GitBranch, Database, FileSpreadsheet, Snowflake, Sparkles, FileText, MessageSquareText } from 'lucide-react';
import { useStore } from '@/store/store';
import { engineFor } from '@/store/engineCache';
import { emptyFilters } from '@/lib/engine';
import { fmtNumber } from '@/lib/util';
import { STAGES } from '@/agents/registry';
import { Logo } from '@/components/Layout';
import { cx } from '@/components/ui';

const ARTIFACTS = ['Requirements specification', 'Data understanding report', 'Logical model & KPI logic', 'Approved wireframe', 'Working dashboard', 'Test results & UAT sign-off', 'Documentation package'];
const STEP_COPY = [
  'A conversation turns the brief into objectives, KPIs, breakdowns and filters.',
  'Every dataset is profiled; keys, joins and quality issues are found automatically.',
  'Facts, dimensions and calculation logic are proposed and editable.',
  'A multi-page wireframe you edit directly or by asking the design agent.',
  'The approved design is built against the real data, with filters and drill-down.',
  'Functional and data-validation tests are generated, run and reconciled to source.',
  'Eight delivery documents are written from the actual project artifacts.',
];

function useDemoNumbers() {
  const demo = useStore((s) => s.projects.find((p) => p.isDemo));
  return useMemo(() => {
    if (!demo?.foundation || !demo.understanding || !demo.dashboard) return null;
    const e = engineFor(demo);
    if (!e) return null;
    const f = emptyFilters(demo.dashboard.spec.defaultPeriod);
    const m = (name: string) => demo.foundation!.measures.find((x) => x.name === name)?.id;
    const kpi = (name: string) => (m(name) ? e.kpi(m(name)!, f) : null);
    const segComp = demo.dashboard.spec.pages[0]?.components.find((c) => c.type === 'bar');
    const calls = m('Total Calls');
    return {
      id: demo.id,
      kpis: [
        { label: 'Total calls', k: kpi('Total Calls'), pct: false },
        { label: 'Emails delivered', k: kpi('Delivered Emails'), pct: false },
        { label: 'Email open rate', k: kpi('Email Open Rate'), pct: true },
      ],
      bars: segComp?.dimension ? e.group(segComp.measureIds[0], segComp.dimension, f).map((g) => ({ name: g.key, value: g.value })) : [],
      trend: calls ? e.series(calls, 'week', { ...f, period: 'last6m' }).map((s) => ({ v: s.value })) : [],
      tests: demo.testing ? { total: demo.testing.cases.length, passed: demo.testing.cases.filter((c) => c.status === 'Passed').length, failed: demo.testing.cases.filter((c) => c.status === 'Failed').length } : null,
    };
  }, [demo]);
}

function ProductFrame() {
  const d = useDemoNumbers();
  return (
    <div className="relative">
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1.875rem_5rem_-1.875rem_rgba(15,31,66,0.35)]">
        <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
          <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
          <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
          <span className="ml-3 text-[0.6875rem] font-medium text-slate-500">HCP Engagement & Performance Analytics</span>
        </div>
        <div className="grid grid-cols-[9.375rem_1fr]">
          <ol className="space-y-0.5 border-r border-slate-100 p-3">
            {STAGES.map((s, i) => (
              <li key={s.id} className={cx('flex items-center gap-2 rounded-md px-2 py-1.5 text-[0.6875rem]', i === 5 ? 'bg-brand-50 font-semibold text-brand-800' : 'text-slate-600')}>
                <span className={cx('flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[0.5625rem]', i < 5 ? 'bg-emerald-500 text-white' : i === 5 ? 'bg-brand-600 text-white' : 'bg-slate-200 text-slate-500')}>{i < 5 ? <Check className="h-2.5 w-2.5" /> : i + 1}</span>
                <span className="truncate">{s.label}</span>
              </li>
            ))}
          </ol>
          <div className="space-y-3 p-4">
            <div className="grid grid-cols-3 gap-2">
              {(d?.kpis ?? []).map(({ label, k, pct }) => (
                <div key={label} className="rounded-lg border border-slate-200 px-3 py-2">
                  <div className="text-[0.625rem] font-medium uppercase tracking-wide text-slate-500">{label}</div>
                  <div className="text-lg font-semibold tabular-nums text-navy-900">{k?.current == null ? '—' : pct ? `${k.current.toFixed(1)}%` : fmtNumber(k.current)}</div>
                  {k?.delta != null && <div className={cx('text-[0.625rem] font-medium', k.delta >= 0 ? 'text-emerald-600' : 'text-red-600')}>{k.delta >= 0 ? '▲' : '▼'} {Math.abs(k.delta).toFixed(1)}{pct ? ' pts' : '%'} vs prev.</div>}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-5 gap-2">
              <div className="col-span-3 rounded-lg border border-slate-200 p-2">
                <div className="px-1 text-[0.6875rem] font-semibold text-navy-900">Calls by segment</div>
                <div className="h-28">
                  <ResponsiveContainer>
                    <BarChart data={d?.bars ?? []} margin={{ top: 6, right: 4, left: 4, bottom: 0 }}>
                      <XAxis dataKey="name" tick={{ fontSize: 9 }} interval={0} axisLine={false} tickLine={false} tickFormatter={(v: string) => (v.length > 9 ? `${v.split(" ")[0]}` : v)} />
                      <Bar dataKey="value" radius={[3, 3, 0, 0]} isAnimationActive={false}>{(d?.bars ?? []).map((b, i) => <Cell key={b.name} fill={i === 0 ? '#7a00e6' : '#bd8bff'} />)}</Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div className="col-span-2 rounded-lg border border-slate-200 p-2">
                <div className="px-1 text-[0.6875rem] font-semibold text-navy-900">Weekly calls</div>
                <div className="h-28">
                  <ResponsiveContainer>
                    <AreaChart data={d?.trend ?? []} margin={{ top: 8, right: 2, left: 2, bottom: 0 }}>
                      <Area dataKey="v" stroke="#7a00e6" fill="#ecdcff" strokeWidth={1.5} isAnimationActive={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
            {d?.tests && (
              <div className="flex items-center gap-3 rounded-lg bg-slate-50 px-3 py-2 text-[0.6875rem]">
                <ShieldCheck className="h-4 w-4 text-emerald-600" />
                <span className="font-medium text-slate-700">{d.tests.total} test cases</span>
                <span className="text-emerald-700">{d.tests.passed} passed</span>
                <span className="text-red-600">{d.tests.failed} failed → defects</span>
                <div className="ml-auto h-1.5 w-28 overflow-hidden rounded-full bg-slate-200">
                  <div className="h-full bg-emerald-500" style={{ width: `${(d.tests.passed / d.tests.total) * 100}%` }} />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="absolute -left-10 -top-12 hidden w-64 rounded-xl border border-slate-200 bg-white p-3 shadow-xl xl:block">
        <div className="mb-1.5 flex items-center gap-1.5 text-[0.6875rem] font-semibold text-navy-900"><MessageSquareText className="h-3.5 w-3.5 text-brand-600" />Requirement assistant</div>
        <div className="rounded-lg bg-slate-50 px-2.5 py-1.5 text-[0.6875rem] leading-snug text-slate-600">You asked to track changes over time. Should trends be weekly, monthly or quarterly?</div>
        <div className="mt-1.5 flex gap-1">
          {['Weekly', 'Monthly', 'Quarterly'].map((o, i) => <span key={o} className={cx('rounded-full border px-2 py-0.5 text-[0.625rem]', i === 0 ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-200 text-slate-600')}>{o}</span>)}
        </div>
      </div>
    </div>
  );
}

const TEST_ROWS = [
  ['Interactivity', 'Time Period', 'Filter', "1. Select the 'R13W' option from the Time Period filter. 2. Verify that the dashboard updates.", 'Passed'],
  ['Functional', 'Calls by Segment', 'Bar Chart', '1. Verify that the bar chart displays data for different segments. 2. Check bars are colored and labeled.', 'Passed'],
  ['UI/UX', 'Account Table', 'Table', '1. Inspect the table for alignment, font size and contrast. 2. Verify that it scrolls.', 'UAT'],
];
const QC_ROWS = [
  ['Calls by Segment', 'Data Integrity', 'Validate segment counts against the call log', 'Passed'],
  ['Account Table', 'HCP Matching', 'Match every call to an account in the account master', 'Failed'],
];

export default function Landing() {
  const nav = useNavigate();
  const demo = useStore((s) => s.projects.find((p) => p.isDemo));
  const demoLink = demo ? `/p/${demo.id}/testing` : '/projects';
  return (
    <div className="h-full overflow-y-auto bg-white text-slate-800">
      {/* Nav */}
      <header className="sticky top-0 z-30 border-b border-slate-200/70 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-8 px-6 py-3.5">
          <Link to="/" aria-label="Celestra home"><Logo light /></Link>
          <nav className="hidden items-center gap-6 text-sm text-slate-600 md:flex">
            <a href="#workflow" onClick={(e) => { e.preventDefault(); document.getElementById('workflow')?.scrollIntoView({ behavior: 'smooth' }); }} className="hover:text-navy-900">Workflow</a>
            <a href="#testing" onClick={(e) => { e.preventDefault(); document.getElementById('testing')?.scrollIntoView({ behavior: 'smooth' }); }} className="hover:text-navy-900">Testing</a>
            <a href="#sources" onClick={(e) => { e.preventDefault(); document.getElementById('sources')?.scrollIntoView({ behavior: 'smooth' }); }} className="hover:text-navy-900">Data & AI</a>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={() => nav('/projects')} className="rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">Projects</button>
            <button onClick={() => nav('/new')} className="rounded-lg bg-navy-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-navy-800">New project</button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,#eef2f7_1px,transparent_1px),linear-gradient(to_bottom,#eef2f7_1px,transparent_1px)] bg-[size:3rem_3rem] [mask-image:linear-gradient(to_bottom,black,transparent_85%)]" />
        <div className="relative mx-auto grid max-w-6xl items-center gap-14 px-6 pb-24 pt-20 lg:grid-cols-[1fr_1.1fr]">
          <div>
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Reporting delivery, end to end
            </div>
            <h1 className="text-[2.75rem] font-semibold leading-[1.05] tracking-[-0.025em] text-navy-950 sm:text-[3.5rem]">
              From a business brief to a <span className="text-brand-600">tested</span> dashboard.
            </h1>
            <p className="mt-5 max-w-lg text-[1.0625rem] leading-relaxed text-slate-600">
              Celestra runs the reporting lifecycle — requirements, data understanding, design, build, testing and documentation — with specialised agents and a human approval at every gate.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <button onClick={() => nav(demo ? `/p/${demo.id}/requirements` : '/projects')} className="group inline-flex items-center gap-2 rounded-lg bg-navy-900 px-5 py-3 text-sm font-semibold text-white hover:bg-navy-800">
                Explore a live project <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
              </button>
              <button onClick={() => nav('/new')} className="rounded-lg border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-navy-900 hover:border-slate-400">Start a project</button>
            </div>
            <dl className="mt-10 grid max-w-md grid-cols-3 gap-6 border-t border-slate-200 pt-6">
              {[['7', 'stages, one workflow'], ['100%', 'of numbers reconciled to source'], ['8', 'delivery documents']].map(([n, l]) => (
                <div key={l}>
                  <dt className="text-2xl font-semibold tracking-tight text-navy-950">{n}</dt>
                  <dd className="mt-0.5 text-xs leading-snug text-slate-500">{l}</dd>
                </div>
              ))}
            </dl>
          </div>
          <ProductFrame />
        </div>
      </section>

      {/* Workflow */}
      <section id="workflow" className="bg-navy-950 py-24 text-white">
        <div className="mx-auto max-w-6xl px-6">
          <div className="max-w-2xl">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-300">The workflow</div>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Each stage hands a reviewed artifact to the next.</h2>
            <p className="mt-4 text-brand-100/70">Nothing moves forward without approval. Change something upstream and every affected stage is flagged for review — approved work is never silently overwritten.</p>
          </div>
          <ol className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10 sm:grid-cols-2 lg:grid-cols-4">
            {STAGES.map((s, i) => (
              <li key={s.id} className="bg-navy-950 p-6">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-brand-300">{String(i + 1).padStart(2, '0')}</span>
                  <span className="rounded-full border border-white/15 px-2 py-0.5 text-[0.625rem] text-brand-100/70">{ARTIFACTS[i]}</span>
                </div>
                <div className="mt-6 text-lg font-semibold">{s.label}</div>
                <p className="mt-2 text-sm leading-relaxed text-brand-100/60">{STEP_COPY[i]}</p>
              </li>
            ))}
            <li className="flex flex-col justify-between bg-brand-600 p-6">
              <GitBranch className="h-5 w-5" />
              <div>
                <div className="text-lg font-semibold">Every change is versioned</div>
                <p className="mt-2 text-sm text-brand-50/85">Requirements, model, design, dashboard, tests and documents all keep their history.</p>
              </div>
            </li>
          </ol>
        </div>
      </section>

      {/* Testing */}
      <section id="testing" className="py-24">
        <div className="mx-auto grid max-w-6xl gap-14 px-6 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-600">Testing & UAT</div>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-navy-950">Test cases your QA team would write — then actually run.</h2>
            <p className="mt-4 text-slate-600">Every filter, chart and table gets functional and UI/UX cases. Business data-validation scenarios check counts, mappings, roll-ups and periods against the source. A test only passes when an independent recalculation matches.</p>
            <ul className="mt-6 space-y-2.5 text-sm text-slate-700">
              {['Functional testing — interactivity, functional and UI/UX', 'Data validation — integrity, mapping, period and roll-up checks', 'UAT from the analyst’s point of view, with sign-off', 'Failures become defects automatically, and retest in one click'].map((t) => (
                <li key={t} className="flex gap-2.5"><Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />{t}</li>
              ))}
            </ul>
            <Link to={demoLink} className="mt-8 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 hover:gap-2.5 hover:text-brand-800">See a full test suite <ArrowRight className="h-4 w-4 transition-all" /></Link>
          </div>
          <div className="space-y-4">
            <div className="overflow-hidden rounded-xl border border-slate-200 shadow-card">
              <div className="bg-navy-800 px-4 py-2 text-xs font-semibold text-white">Functional Testing</div>
              <table className="w-full table-fixed text-left text-[0.7188rem]">
                <colgroup><col className="w-24" /><col className="w-28" /><col className="w-20" /><col /><col className="w-16" /></colgroup>
                <thead className="bg-slate-50 text-[0.625rem] uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-2">Test type</th><th className="px-3 py-2">Element</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Test case</th><th className="px-3 py-2" /></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {TEST_ROWS.map((r) => (
                    <tr key={r[1]} className="align-top"><td className="px-3 py-2.5 font-medium text-slate-700">{r[0]}</td><td className="px-3 py-2.5">{r[1]}</td><td className="px-3 py-2.5 text-slate-500">{r[2]}</td><td className="px-3 py-2.5 text-slate-600">{r[3]}</td><td className="px-3 py-2.5"><span className={cx('rounded px-1.5 py-0.5 text-[0.625rem] font-medium', r[4] === 'Passed' ? 'bg-emerald-50 text-emerald-700' : 'bg-violet-50 text-violet-700')}>{r[4]}</span></td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="overflow-hidden rounded-xl border border-slate-200 shadow-card">
              <div className="bg-navy-800 px-4 py-2 text-xs font-semibold text-white">Data Validation Testing</div>
              <table className="w-full table-fixed text-left text-[0.7188rem]">
                <colgroup><col className="w-32" /><col className="w-28" /><col /><col className="w-16" /></colgroup>
                <tbody className="divide-y divide-slate-100">
                  {QC_ROWS.map((r) => (
                    <tr key={r[1]}><td className="px-3 py-2.5 font-medium text-slate-700">{r[0]}</td><td className="px-3 py-2.5 text-slate-500">{r[1]}</td><td className="px-3 py-2.5 text-slate-600">{r[2]}</td><td className="px-3 py-2.5"><span className={cx('rounded px-1.5 py-0.5 text-[0.625rem] font-medium', r[3] === 'Passed' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700')}>{r[3]}</span></td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      {/* Sources & AI */}
      <section id="sources" className="border-y border-slate-200 bg-slate-50 py-20">
        <div className="mx-auto grid max-w-6xl gap-10 px-6 md:grid-cols-3">
          {[
            { icon: FileSpreadsheet, title: 'Files', text: 'CSV, Excel workbooks (one dataset per sheet) and JSON. Data stays in the browser.' },
            { icon: Database, title: 'Databricks & Snowflake', text: 'Browse a catalog or schema and import tables through the server — tokens never reach the browser.', extra: <Snowflake className="h-4 w-4 text-brand-600" /> },
            { icon: Sparkles, title: 'Azure AI Foundry', text: 'Language tasks use your Azure model. Calculations, mapping and test validation stay deterministic and auditable.' },
          ].map((c) => (
            <div key={c.title}>
              <div className="flex items-center gap-2"><c.icon className="h-5 w-5 text-brand-600" />{c.extra}</div>
              <div className="mt-4 text-base font-semibold text-navy-950">{c.title}</div>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{c.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="py-24">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-8 px-6 md:flex-row md:items-center">
          <div>
            <h2 className="text-3xl font-semibold tracking-tight text-navy-950">See a finished project in two minutes.</h2>
            <p className="mt-2 text-slate-600">HCP Engagement & Performance Analytics is fully built — open it, change a filter, run the tests.</p>
          </div>
          <div className="flex gap-3">
            <button onClick={() => nav(demo ? `/p/${demo.id}/preview` : '/projects')} className="inline-flex items-center gap-2 rounded-lg bg-navy-900 px-5 py-3 text-sm font-semibold text-white hover:bg-navy-800">Open the dashboard <ArrowRight className="h-4 w-4" /></button>
            <button onClick={() => nav('/projects')} className="rounded-lg border border-slate-300 px-5 py-3 text-sm font-semibold text-navy-900 hover:border-slate-400">Go to projects</button>
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-200">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-6 text-xs text-slate-500">
          <span className="flex items-center gap-2"><FileText className="h-3.5 w-3.5" />Celestra · agentic reporting delivery</span>
        </div>
      </footer>
    </div>
  );
}
