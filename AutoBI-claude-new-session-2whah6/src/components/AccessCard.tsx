import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck, Trash2, Plus, Eye, Wand2 } from 'lucide-react';
import type { Project } from '@/types';
import { Button, Card, Badge } from './ui';
import { proposeAccessRoles, updateRelease } from '@/store/orchestrator';
import { useEngine } from '@/store/engineCache';
import { fieldLabel } from '@/lib/fieldLabels';
import { uid } from '@/lib/util';

/** Row-level security: which rows each field user may see (e.g. an FRM sees only their territory). */
export default function AccessCard({ p }: { p: Project }) {
  const nav = useNavigate();
  const engine = useEngine(p);
  const rel = p.release;
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const options = rel?.securityField && engine ? engine.distinct(rel.securityField) : [];
  return (
    <Card
      title={<span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-brand-600" />Row-level security</span>}
      subtitle={rel?.securityField ? `Users see only rows where ${fieldLabel(p.foundation, rel.securityField)} matches their assignment.` : 'Restrict what each field user can see.'}
      actions={<Button size="xs" variant="ghost" icon={<Wand2 className="h-3 w-3" />} onClick={() => proposeAccessRoles(p.id)}>Propose from roster</Button>}
      bodyClass="p-0"
    >
      {rel?.users.length ? (
        <table className="w-full table-fixed">
          <colgroup><col className="w-[34%]" /><col className="w-[30%]" /><col /><col className="w-24" /></colgroup>
          <thead><tr><th className="th">User</th><th className="th">Role</th><th className="th">Can see</th><th className="th" /></tr></thead>
          <tbody>
            {rel.users.map((x) => (
              <tr key={x.id}>
                <td className="td text-sm font-medium text-navy-900">{x.name}</td>
                <td className="td text-xs text-slate-500">{x.role}</td>
                <td className="td text-xs">{x.values.length ? x.values.join(', ') : <Badge tone="green">All data</Badge>}</td>
                <td className="td text-right">
                  {x.values.length > 0 && p.dashboard && <Button size="xs" variant="ghost" icon={<Eye className="h-3 w-3" />} title="View the dashboard as this user" onClick={() => nav(`/p/${p.id}/preview?as=${x.id}`)} />}
                  <Button size="xs" variant="ghost" icon={<Trash2 className="h-3 w-3" />} aria-label={`Remove ${x.name}`} onClick={() => updateRelease(p.id, (r) => (r.users = r.users.filter((y) => y.id !== x.id)), `Removed ${x.name} from row-level security`)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="px-4 py-4 text-sm text-slate-500">No roles yet. Click “Propose from roster” to create one user per FRM from the territory file.</div>
      )}
      {rel?.securityField && (
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 p-3">
          <input className="input w-48 py-1.5 text-xs" placeholder="User name" value={name} onChange={(e) => setName(e.target.value)} aria-label="New user name" />
          <select className="input w-56 py-1.5 text-xs" value={value} onChange={(e) => setValue(e.target.value)} aria-label="Territory">
            <option value="">All data</option>
            {options.map((o) => <option key={o}>{o}</option>)}
          </select>
          <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} disabled={!name.trim()} onClick={() => { updateRelease(p.id, (r) => r.users.push({ id: uid('usr'), name: name.trim(), role: value ? 'Field user' : 'All data', values: value ? [value] : [] }), `Added ${name.trim()} to row-level security`); setName(''); setValue(''); }}>Add user</Button>
        </div>
      )}
    </Card>
  );
}
