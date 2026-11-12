import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Project } from '@/types';
import { reconcileMappings } from '@/agents/foundationAgent';

/**
 * Persistent project store (localStorage). Dataset rows are stored separately
 * (see lib/rowStore.ts). All workflow mutations go through the orchestrator.
 */
interface State {
  projects: Project[];
  seeded: boolean;
  seedVersion?: number;
  toasts: { id: string; kind: 'success' | 'error' | 'info'; text: string }[];
  setProjects: (fn: (ps: Project[]) => Project[]) => void;
  toast: (kind: 'success' | 'error' | 'info', text: string) => void;
  dismiss: (id: string) => void;
  markSeeded: (version: number) => void;
}

export const useStore = create<State>()(
  persist(
    (set) => ({
      projects: [],
      seeded: false,
      toasts: [],
      setProjects: (fn) => set((s) => ({ projects: fn(s.projects) })),
      toast: (kind, text) => {
        const id = Math.random().toString(36).slice(2);
        set((s) => ({ toasts: [...s.toasts, { id, kind, text }] }));
        setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 4500);
      },
      dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
      markSeeded: (version) => set({ seeded: true, seedVersion: version }),
    }),
    {
      name: 'celestra-v1',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ projects: s.projects, seeded: s.seeded, seedVersion: s.seedVersion }),
      // forward-compatibility for projects saved by earlier versions
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<State>;
        const projects = (p.projects ?? []).map((x) => {
          let y = x.requirements && !x.requirements.stories ? { ...x, requirements: { ...x.requirements, stories: [] } } : x;
          // KPIs defined in the foundation are not "missing" data (older saves predate this check)
          if (y.understanding?.mappings.some((m) => m.status === 'missing') && y.foundation) {
            y = structuredClone(y);
            reconcileMappings(y.understanding!, y.foundation!);
          }
          return y;
        });
        return { ...current, ...p, projects };
      },
    },
  ),
);

export const getProject = (id: string) => useStore.getState().projects.find((p) => p.id === id);

/** Apply a mutation to a project immutably (structured clone + mutate). */
export function mutate(id: string, fn: (p: Project) => void) {
  useStore.getState().setProjects((ps) =>
    ps.map((p) => {
      if (p.id !== id) return p;
      const next = structuredClone(p);
      fn(next);
      next.updatedAt = new Date().toISOString();
      return next;
    }),
  );
}

export const useProject = (id: string | undefined) => useStore((s) => s.projects.find((p) => p.id === id));
