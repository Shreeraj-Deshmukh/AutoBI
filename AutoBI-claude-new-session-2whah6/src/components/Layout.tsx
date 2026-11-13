import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { FolderKanban, PlusCircle, Sparkles, Menu, X, PanelLeftOpen, PanelLeftClose } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cx, Toasts } from './ui';
import { useAI } from '@/agents/llm';
import { useStore } from '@/store/store';

const NAV = [
  { to: '/projects', label: 'Projects', icon: FolderKanban },
  { to: '/new', label: 'New Project', icon: PlusCircle },
  { to: '/settings', label: 'AI Model', icon: Sparkles },
];

export function Logo({ compact, light }: { compact?: boolean; light?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-navy-700 shadow-sm">
        <svg viewBox="0 0 24 24" className="h-4.5 w-4.5 h-[1.125rem] w-[1.125rem]" fill="none">
          <path d="M4 17l5-6 4 3 7-9" stroke="white" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="20" cy="5" r="1.8" fill="#d9b9ff" />
        </svg>
      </div>
      {!compact && (
        <div>
          <div className={cx('text-[0.9375rem] font-semibold tracking-tight', light ? 'text-navy-950' : 'text-white')}>Celestra</div>
          <div className={cx('-mt-0.5 text-[0.625rem] uppercase tracking-[0.14em]', light ? 'text-slate-500' : 'text-brand-200/80')}>Agentic Reporting</div>
        </div>
      )}
    </div>
  );
}

const PREF = 'celestra-sidebar-collapsed';
const readCollapsed = () => {
  try {
    return localStorage.getItem(PREF) !== 'false';
  } catch {
    return true;
  }
};

function AIStatus({ collapsed }: { collapsed?: boolean }) {
  const ai = useAI();
  const on = ai.status === 'ready' && ai.enabled;
  if (collapsed)
    return (
      <NavLink to="/settings" title={on ? `Azure AI Foundry · ${ai.model}` : 'AI model not connected'} className="mx-auto mb-3 flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 hover:bg-white/5">
        <span className={cx('h-2.5 w-2.5 rounded-full', on ? 'bg-emerald-400' : ai.status === 'checking' ? 'bg-slate-400' : 'bg-amber-400')} />
      </NavLink>
    );
  return (
    <NavLink to="/settings" className="mx-3 mb-3 block rounded-lg border border-white/10 px-3 py-2 text-[0.6875rem] hover:bg-white/5">
      <div className="flex items-center gap-1.5 font-medium text-white">
        <span className={cx('h-2 w-2 rounded-full', on ? 'bg-emerald-400' : ai.status === 'checking' ? 'bg-slate-400' : 'bg-amber-400')} />
        {on ? 'Azure AI Foundry' : 'Deterministic mode'}
      </div>
      <div className="mt-0.5 truncate text-slate-400">{on ? ai.model : ai.status === 'ready' ? 'AI disabled' : 'AI model not connected'}</div>
    </NavLink>
  );
}

export default function Layout() {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const loc = useLocation();
  const projects = useStore((s) => s.projects);
  const running = projects.flatMap((p) => p.runs.filter((r) => r.status === 'running').map((r) => ({ p: p.info.name, r })));
  const toggle = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem(PREF, String(!c));
      } catch {
        /* ignore */
      }
      return !c;
    });
  };
  // fixed-position elements (e.g. sticky action bars) align to the sidebar width
  useEffect(() => {
    document.documentElement.style.setProperty('--sidebar-w', collapsed ? '4rem' : '15rem');
  }, [collapsed]);

  const sidebar = (mini: boolean) => (
    <aside className={cx('flex h-full shrink-0 flex-col bg-navy-900 text-slate-300 transition-[width] duration-200', mini ? 'w-16' : 'w-60')}>
      <div className={cx('flex items-center py-4', mini ? 'justify-center px-2' : 'justify-between px-4')}>
        <NavLink to="/" aria-label="Celestra home"><Logo compact={mini} /></NavLink>
        <button className="text-slate-400 lg:hidden" onClick={() => setOpen(false)} aria-label="Close menu">
          <X className="h-5 w-5" />
        </button>
      </div>
      <nav className="mt-2 flex-1 space-y-0.5 px-2">
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            title={mini ? n.label : undefined}
            onClick={() => setOpen(false)}
            className={({ isActive }) => cx('flex items-center gap-2.5 rounded-lg py-2 text-sm transition-colors', mini ? 'justify-center px-0' : 'px-3', isActive || (n.to === '/projects' && loc.pathname.startsWith('/p/')) ? 'bg-white/10 font-medium text-white' : 'hover:bg-white/5 hover:text-white')}
          >
            <n.icon className="h-4 w-4 shrink-0" />
            {!mini && n.label}
          </NavLink>
        ))}
      </nav>
      {running.length > 0 &&
        (mini ? (
          <div className="mx-auto mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-white/5" title={`Agent working: ${running[0].r.steps.find((s) => s.status === 'running')?.label ?? 'Processing'}`}>
            <span className="pulse-dot h-2.5 w-2.5 rounded-full bg-emerald-400" />
            <span className="sr-only">Agent working</span>
          </div>
        ) : (
          <div className="mx-3 mb-3 rounded-lg bg-white/5 p-3 text-xs">
            <div className="mb-1 flex items-center gap-1.5 font-medium text-white">
              <span className="pulse-dot h-2 w-2 rounded-full bg-emerald-400" /> Agent working
            </div>
            {running.slice(0, 2).map(({ p, r }) => (
              <div key={r.id} className="truncate text-slate-400">
                {r.steps.find((s) => s.status === 'running')?.label ?? 'Processing'} · {p}
              </div>
            ))}
          </div>
        ))}
      <AIStatus collapsed={mini} />
      <button onClick={toggle} className={cx('mb-3 hidden items-center gap-2 rounded-lg py-2 text-xs text-slate-400 hover:bg-white/5 hover:text-white lg:flex', mini ? 'mx-auto justify-center px-2.5' : 'mx-3 px-3')} aria-label={mini ? 'Expand sidebar' : 'Collapse sidebar'} title={mini ? 'Expand sidebar' : 'Collapse sidebar'}>
        {mini ? <PanelLeftOpen className="h-4 w-4" /> : <><PanelLeftClose className="h-4 w-4" />Collapse</>}
      </button>
    </aside>
  );
  return (
    <div className="flex h-full">
      <div className="hidden lg:block">{sidebar(collapsed)}</div>
      {open && (
        <div className="fixed inset-0 z-40 flex lg:hidden">
          {sidebar(false)}
          <div className="flex-1 bg-black/40" onClick={() => setOpen(false)} />
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-2 lg:hidden">
          <button onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu className="h-5 w-5 text-slate-600" />
          </button>
          <span className="font-semibold text-navy-900">Celestra</span>
        </div>
        <main className="min-h-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
      <Toasts />
    </div>
  );
}
