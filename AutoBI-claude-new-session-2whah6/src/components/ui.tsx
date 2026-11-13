import { clsx } from 'clsx';
import { X, Loader2, CheckCircle2, AlertTriangle, Info, XCircle } from 'lucide-react';
import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import type { StageStatus, TestStatus, MappingStatus } from '@/types';
import { useStore } from '@/store/store';

export const cx = clsx;

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'subtle';
export function Button({ variant = 'secondary', size = 'md', icon, loading, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'xs'; icon?: ReactNode; loading?: boolean }) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap',
        size === 'md' && 'px-3.5 py-2 text-sm',
        size === 'sm' && 'px-2.5 py-1.5 text-xs',
        size === 'xs' && 'px-2 py-1 text-[0.6875rem]',
        variant === 'primary' && 'bg-navy-800 text-white hover:bg-navy-700 shadow-sm',
        variant === 'secondary' && 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50',
        variant === 'ghost' && 'text-slate-600 hover:bg-slate-100',
        variant === 'subtle' && 'bg-brand-50 text-brand-700 hover:bg-brand-100',
        variant === 'danger' && 'bg-white text-red-600 border border-red-200 hover:bg-red-50',
        variant === 'success' && 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm',
        className,
      )}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

export function Card({ title, subtitle, actions, children, className, bodyClass }: { title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClass?: string }) {
  return (
    <div className={cx('card', className)}>
      {(title || actions) && (
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div className="min-w-0">
            {title && <div className="section-title">{title}</div>}
            {subtitle && <div className="muted mt-0.5">{subtitle}</div>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={cx(/(^|\s)p-\d/.test(bodyClass ?? '') ? '' : 'p-4', bodyClass)}>{children}</div>
    </div>
  );
}

const STAGE_STYLE: Record<StageStatus, [string, string]> = {
  not_started: ['Not Started', 'bg-slate-100 text-slate-600'],
  in_progress: ['In Progress', 'bg-brand-50 text-brand-700'],
  pending_approval: ['Pending Approval', 'bg-amber-50 text-amber-700'],
  approved: ['Approved', 'bg-emerald-50 text-emerald-700'],
  completed: ['Completed', 'bg-emerald-50 text-emerald-700'],
  blocked: ['Blocked', 'bg-red-50 text-red-700'],
};
export function StageBadge({ status }: { status: StageStatus }) {
  const [l, c] = STAGE_STYLE[status];
  return <span className={cx('chip', c)}>{l}</span>;
}

const TEST_STYLE: Record<TestStatus, string> = {
  'Not Started': 'bg-slate-100 text-slate-600',
  'In Progress': 'bg-brand-50 text-brand-700',
  Passed: 'bg-emerald-50 text-emerald-700',
  Failed: 'bg-red-50 text-red-700',
  Blocked: 'bg-orange-50 text-orange-700',
  'Requires Retesting': 'bg-amber-50 text-amber-700',
};
export const TestBadge = ({ status }: { status: TestStatus }) => <span className={cx('chip', TEST_STYLE[status])}>{status}</span>;

const MAP_STYLE: Record<MappingStatus, [string, string]> = {
  available: ['Available', 'bg-emerald-50 text-emerald-700'],
  join_required: ['Join Required', 'bg-brand-50 text-brand-700'],
  calculation_required: ['Calculation Required', 'bg-violet-50 text-violet-700'],
  missing: ['Missing Data', 'bg-red-50 text-red-700'],
  clarification: ['Requires Clarification', 'bg-amber-50 text-amber-700'],
};
export const MapBadge = ({ status }: { status: MappingStatus }) => <span className={cx('chip', MAP_STYLE[status][1])}>{MAP_STYLE[status][0]}</span>;

export function Badge({ children, tone = 'slate', className }: { children: ReactNode; tone?: 'slate' | 'blue' | 'green' | 'amber' | 'red' | 'violet' | 'navy'; className?: string }) {
  const t = { slate: 'bg-slate-100 text-slate-600', blue: 'bg-brand-50 text-brand-700', green: 'bg-emerald-50 text-emerald-700', amber: 'bg-amber-50 text-amber-700', red: 'bg-red-50 text-red-700', violet: 'bg-violet-50 text-violet-700', navy: 'bg-navy-800 text-white' }[tone];
  return <span className={cx('chip', t, className)}>{children}</span>;
}

export function Tabs<T extends string>({ tabs, value, onChange, className }: { tabs: { id: T; label: ReactNode; count?: number }[]; value: T; onChange: (t: T) => void; className?: string }) {
  return (
    <div className={cx('flex flex-wrap gap-x-1 border-b border-slate-200', className)} role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cx('-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors', value === t.id ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-800')}
        >
          {t.label}
          {t.count != null && <span className={cx('rounded-full px-1.5 text-[0.625rem]', value === t.id ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-slate-500')}>{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy-950/40 p-4" onMouseDown={onClose}>
      <div className={cx('card flex max-h-[90vh] w-full flex-col', wide ? 'max-w-4xl' : 'max-w-xl')} onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <div className="section-title text-base">{title}</div>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Empty({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
      {icon && <div className="mb-3 rounded-full bg-slate-100 p-3 text-slate-500">{icon}</div>}
      <div className="text-sm font-semibold text-slate-800">{title}</div>
      {children && <div className="mt-1 max-w-md text-sm text-slate-500">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'green' | 'red' | 'amber' | 'blue' }) {
  return (
    <div className="card px-4 py-3">
      <div className="text-[0.6875rem] font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={cx('mt-1 text-2xl font-semibold', tone === 'green' ? 'text-emerald-600' : tone === 'red' ? 'text-red-600' : tone === 'amber' ? 'text-amber-600' : tone === 'blue' ? 'text-brand-700' : 'text-navy-900')}>{value}</div>
      {sub && <div className="muted mt-0.5">{sub}</div>}
    </div>
  );
}

export function Progress({ value, className, tone = 'brand' }: { value: number; className?: string; tone?: 'brand' | 'green' }) {
  return (
    <div className={cx('h-1.5 w-full overflow-hidden rounded-full bg-slate-200', className)}>
      <div className={cx('h-full rounded-full transition-all', tone === 'green' ? 'bg-emerald-500' : 'bg-brand-600')} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

export function Callout({ tone = 'info', title, children, action, dismissible = true }: { tone?: 'info' | 'warning' | 'error' | 'success'; title?: ReactNode; children?: ReactNode; action?: ReactNode; dismissible?: boolean }) {
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;
  const Icon = { info: Info, warning: AlertTriangle, error: XCircle, success: CheckCircle2 }[tone];
  const c = { info: 'border-brand-200 bg-brand-50/60 text-brand-900', warning: 'border-amber-200 bg-amber-50/70 text-amber-900', error: 'border-red-200 bg-red-50/70 text-red-900', success: 'border-emerald-200 bg-emerald-50/70 text-emerald-900' }[tone];
  return (
    <div className={cx('flex items-start gap-3 rounded-lg border px-3.5 py-2.5 text-sm', c)} role={tone === 'error' || tone === 'warning' ? 'alert' : 'status'}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1">
        {title && <div className="font-medium">{title}</div>}
        {children && <div className="text-[0.8125rem] opacity-90">{children}</div>}
      </div>
      {action}
      {dismissible && (
        <button onClick={() => setHidden(true)} className="-mr-1 shrink-0 rounded p-0.5 opacity-60 hover:bg-black/5 hover:opacity-100" aria-label="Dismiss">
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismiss);
  return (
    <div className="fixed bottom-4 right-4 z-[60] flex w-96 flex-col gap-2">
      {toasts.map((t) => (
        <div key={t.id} className={cx('card flex items-start gap-2 px-3 py-2.5 text-sm', t.kind === 'error' && 'border-red-200', t.kind === 'success' && 'border-emerald-200')}>
          {t.kind === 'error' ? <XCircle className="mt-0.5 h-4 w-4 text-red-500" /> : t.kind === 'success' ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-500" /> : <Info className="mt-0.5 h-4 w-4 text-brand-500" />}
          <div className="flex-1 text-slate-700">{t.text}</div>
          <button onClick={() => dismiss(t.id)} className="text-slate-400 hover:text-slate-600" aria-label="Dismiss">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="muted mt-1 block">{hint}</span>}
    </label>
  );
}

export function ConfidenceBar({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-2">
      <Progress value={value * 100} className="w-16" tone={value > 0.8 ? 'green' : 'brand'} />
      <span className="text-[0.6875rem] text-slate-500">{Math.round(value * 100)}%</span>
    </div>
  );
}
