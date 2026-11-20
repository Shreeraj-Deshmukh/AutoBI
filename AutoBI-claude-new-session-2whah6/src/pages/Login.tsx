import { Navigate, useNavigate } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { Logo } from '@/components/Layout';
import BrandLogo from '@/components/BrandLogo';
import { STAGES } from '@/agents/registry';
import { useAuth } from '@/store/auth';

/** Microsoft's four-square mark, as its sign-in button guidelines require. */
function MicrosoftMark() {
  return (
    <svg viewBox="0 0 21 21" className="h-[1.3125rem] w-[1.3125rem] shrink-0" aria-hidden>
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}

export default function Login() {
  const nav = useNavigate();
  const user = useAuth((s) => s.user);
  const signIn = useAuth((s) => s.signIn);
  // signing in always lands on the AutoBI homepage, whatever page was asked for
  if (user) return <Navigate to="/" replace />;

  const go = () => {
    signIn();
    nav('/', { replace: true });
  };

  return (
    <div className="flex h-full overflow-y-auto bg-white">
      {/* Brand panel */}
      <aside className="relative hidden w-[46%] max-w-[40rem] shrink-0 flex-col justify-between overflow-hidden bg-navy-950 p-10 text-white lg:flex">
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.05)_1px,transparent_1px)] bg-[size:3rem_3rem] [mask-image:linear-gradient(to_bottom,black,transparent_90%)]" />
        <div className="pointer-events-none absolute -bottom-40 -right-40 h-[28rem] w-[28rem] rounded-full bg-brand-600/25 blur-3xl" />
        <div className="relative"><Logo /></div>
        <div className="relative">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-300">Reporting delivery, end to end</div>
          <h1 className="mt-3 max-w-md text-[2.25rem] font-semibold leading-[1.1] tracking-[-0.02em]">From a business brief to a tested dashboard.</h1>
          <ol className="mt-8 grid max-w-md grid-cols-2 gap-x-6 gap-y-2.5">
            {STAGES.map((s, i) => (
              <li key={s.id} className="flex items-center gap-2.5 text-sm text-brand-100/75">
                <span className="font-mono text-[0.6875rem] text-brand-300">{String(i + 1).padStart(2, '0')}</span>
                {s.label}
              </li>
            ))}
          </ol>
        </div>
        <div className="relative text-xs text-brand-100/50">Celestra · agentic reporting delivery by ProcDNA</div>
      </aside>

      {/* Sign-in */}
      <main className="flex min-h-full flex-1 flex-col px-6 py-8 sm:px-10">
        <div className="lg:hidden"><Logo light /></div>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">
          <BrandLogo className="h-9 self-start" />
          <h2 className="mt-8 text-2xl font-semibold tracking-tight text-navy-950">Sign in to Celestra</h2>
          <p className="mt-1.5 text-sm text-slate-600">Use your Sanofi Microsoft account.</p>

          <button
            type="button"
            onClick={go}
            className="mt-7 flex h-[2.5625rem] w-full items-center justify-center gap-3 border border-[#8c8c8c] bg-white px-3 font-['Segoe_UI',system-ui,sans-serif] text-[0.9375rem] font-semibold text-[#5e5e5e] transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
          >
            <MicrosoftMark />
            Sign in with Microsoft
          </button>

          <div className="mt-10 flex items-center gap-2 border-t border-slate-200 pt-5 text-xs text-slate-500">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            For authorised Sanofi and ProcDNA users only.
          </div>
        </div>
      </main>
    </div>
  );
}
