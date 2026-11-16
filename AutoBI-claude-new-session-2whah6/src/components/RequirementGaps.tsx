import type { Project } from '@/types';
import { Callout } from './ui';
import { missingRequirements } from '@/lib/obtainable';

/**
 * Requirements the uploaded data cannot support (KPIs, filters, breakdowns): listed as a warning in Design Studio
 * and Development. They are left out of the dashboard and the Power BI file, never shown as a similar measure.
 */
export default function RequirementGaps({ p, where }: { p: Project; where: 'design' | 'dashboard' }) {
  const byText = new Map<string, { kinds: Set<string>; note: string }>();
  for (const m of missingRequirements(p.understanding?.mappings)) {
    const k = m.requirement.trim();
    if (!byText.has(k)) byText.set(k, { kinds: new Set(), note: m.note });
    byText.get(k)!.kinds.add(m.kind === 'kpi' ? 'KPI' : m.kind);
  }
  if (!byText.size) return null;
  return (
    <Callout tone="warning" dismissible={false} title={`${byText.size} requirement${byText.size === 1 ? '' : 's'} not in the ${where}: the uploaded data cannot support ${byText.size === 1 ? 'it' : 'them'}`}>
      <ul className="mt-1 space-y-0.5 text-xs" data-testid="requirement-gaps">
        {[...byText].map(([text, g]) => (
          <li key={text} data-testid="requirement-gap">
            <b>{text}</b> <span className="opacity-70">({[...g.kinds].join(', ')})</span> — {g.note.replace(/ It is left out of the dashboard\.$/, '')}
          </li>
        ))}
      </ul>
      <div className="mt-1.5 text-xs opacity-80">They are left out of the dashboard and the Power BI file rather than shown as a similar measure. Upload data that covers them, or remove them from the requirements.</div>
    </Callout>
  );
}
