import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';

/** Consistent page header used by every workspace page. */
export default function PageHeader({ crumbs, title, description, actions }: { crumbs?: { label: string; to?: string }[]; title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-end justify-between gap-4 px-6 py-6">
        <div className="min-w-0">
          {crumbs && (
            <nav className="mb-1.5 flex items-center gap-1 text-xs text-slate-500" aria-label="Breadcrumb">
              {crumbs.map((c, i) => (
                <span key={c.label} className="flex items-center gap-1">
                  {i > 0 && <ChevronRight className="h-3 w-3" />}
                  {c.to ? <Link to={c.to} className="hover:text-slate-800">{c.label}</Link> : <span>{c.label}</span>}
                </span>
              ))}
            </nav>
          )}
          <h1 className="text-2xl font-semibold tracking-tight text-navy-950">{title}</h1>
          {description && <p className="mt-1 max-w-2xl text-sm text-slate-500">{description}</p>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
