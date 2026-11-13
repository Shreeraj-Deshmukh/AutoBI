import { useEffect, useRef, useState } from 'react';

/**
 * Keys that appeared since the previous render, kept for `ms` so the UI can highlight
 * what was just added (by the user or an agent). The first render, a change from an
 * empty list, and bulk changes (more than `max` new keys, e.g. a regenerate) are ignored
 * so a whole screen never lights up.
 */
export function useJustAdded(keys: string[], opts: { max?: number; ms?: number } = {}): Set<string> {
  const { max = 6, ms = 4000 } = opts;
  const prev = useRef<Set<string> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const [fresh, setFresh] = useState<Set<string>>(() => new Set());
  const sig = keys.join('\u0001');

  useEffect(() => {
    const before = prev.current;
    prev.current = new Set(keys);
    if (!before || before.size === 0) return;
    const added = keys.filter((k) => !before.has(k));
    if (!added.length || added.length > max) return;
    setFresh(new Set(added));
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setFresh(new Set()), ms);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  useEffect(() => () => clearTimeout(timer.current), []);
  return fresh;
}
