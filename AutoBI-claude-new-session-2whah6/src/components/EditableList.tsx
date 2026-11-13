import { useEffect, useRef, useState } from 'react';
import { Plus, X, Pencil, ChevronDown } from 'lucide-react';
import type { ReqItem } from '@/types';
import { uid } from '@/lib/util';
import { cx } from './ui';

/**
 * Editable list of requirement items. With `collapsible`, the header toggles the body
 * (controlled by `open` / `onToggle`) and a one-line preview shows while collapsed.
 * Items whose id is in `highlight` were just added: they flash and are scrolled into view.
 */
export default function EditableList({ title, items, onChange, placeholder, icon, collapsible, open = true, onToggle, highlight, readOnly, note }: { title: string; items: ReqItem[]; onChange: (items: ReqItem[]) => void; placeholder?: string; icon?: React.ReactNode; collapsible?: boolean; open?: boolean; onToggle?: () => void; highlight?: Set<string>; readOnly?: boolean; note?: React.ReactNode }) {
  const [adding, setAdding] = useState('');
  const [edit, setEdit] = useState<{ id: string; text: string } | null>(null);
  const add = () => {
    if (!adding.trim()) return;
    onChange([...items, { id: uid('req'), text: adding.trim(), source: 'user' }]);
    setAdding('');
  };
  const expanded = !collapsible || open;
  const listRef = useRef<HTMLUListElement>(null);
  const newIds = items.filter((x) => highlight?.has(x.id)).map((x) => x.id);
  const hl = newIds.join('|');
  useEffect(() => {
    if (hl && expanded) listRef.current?.querySelector('.just-added')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [hl, expanded]);
  const header = (
    <>
      {icon}
      <div className="section-title">{title}</div>
      {collapsible && !open && newIds.length > 0 && <span className="rounded-full bg-brand-100 px-1.5 text-[0.625rem] font-semibold text-brand-700">+{newIds.length} new</span>}
      <span className="ml-auto rounded-full bg-slate-100 px-1.5 text-[0.6875rem] text-slate-500">{items.length}</span>
      {collapsible && <ChevronDown className={cx('h-4 w-4 shrink-0 text-slate-400 transition-transform', open && 'rotate-180')} />}
    </>
  );
  return (
    // a closed card that just received items flashes so the addition isn't missed
    <div className={cx('card', collapsible && !open && newIds.length > 0 && 'just-added')}>
      {collapsible ? (
        <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-2 rounded-xl px-3.5 py-3 text-left hover:bg-slate-50/70">
          {header}
        </button>
      ) : (
        <div className="flex items-center gap-2 px-3.5 pb-2 pt-3.5">{header}</div>
      )}
      {collapsible && !open && items.length > 0 && <div className="-mt-1.5 truncate px-3.5 pb-3 pl-9 text-xs text-slate-500">{items.map((x) => x.text).join(' · ')}</div>}
      {expanded && (
        <div className={cx('px-3.5 pb-3.5', collapsible && 'border-t border-slate-100 pt-2.5')}>
          <ul ref={listRef} className="space-y-1">
            {items.map((it) => (
              <li key={it.id} className={cx('group flex items-start gap-2 rounded-md px-1.5 py-1 hover:bg-slate-50', highlight?.has(it.id) && 'just-added')}>
                <span className={cx('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', it.source === 'extracted' ? 'bg-brand-500' : it.source === 'clarification' ? 'bg-violet-500' : 'bg-emerald-500')} title={`Source: ${it.source}`} />
                {edit?.id === it.id ? (
                  <input
                    className="input py-1 text-sm"
                    autoFocus
                    value={edit.text}
                    onChange={(e) => setEdit({ ...edit, text: e.target.value })}
                    onBlur={() => {
                      onChange(items.map((x) => (x.id === it.id ? { ...x, text: edit.text.trim() || x.text, source: 'user' } : x)));
                      setEdit(null);
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                  />
                ) : (
                  <span className="flex-1 text-sm text-slate-700">{it.text}</span>
                )}
                {!readOnly && <span className="flex shrink-0 gap-0.5 opacity-0 group-hover:opacity-100">
                  <button className="rounded p-0.5 text-slate-400 hover:text-slate-700" onClick={() => setEdit({ id: it.id, text: it.text })} aria-label={`Edit ${it.text}`}>
                    <Pencil className="h-3 w-3" />
                  </button>
                  <button className="rounded p-0.5 text-slate-400 hover:text-red-600" onClick={() => onChange(items.filter((x) => x.id !== it.id))} aria-label={`Remove ${it.text}`}>
                    <X className="h-3.5 w-3.5" />
                  </button>
                </span>}
              </li>
            ))}
            {!items.length && <li className="px-1.5 py-1 text-xs text-slate-400">None identified.</li>}
          </ul>
          {note && <div className="mt-2 px-1.5 text-xs text-slate-500">{note}</div>}
          {!readOnly && <div className="mt-2 flex gap-1.5">
            <input className="input py-1 text-xs" value={adding} placeholder={placeholder ?? 'Add item…'} onChange={(e) => setAdding(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} aria-label={`Add to ${title}`} />
            <button onClick={add} className="rounded-md border border-slate-300 px-2 text-slate-500 hover:bg-slate-50" aria-label={`Add ${title}`}>
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>}
        </div>
      )}
    </div>
  );
}
