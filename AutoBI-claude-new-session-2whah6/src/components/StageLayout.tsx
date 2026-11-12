import type { ReactNode } from 'react';

export default function StageLayout({ main, side }: { main: ReactNode; side: ReactNode }) {
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_21.25rem]">
      <div className="min-w-0 space-y-5">{main}</div>
      <div className="space-y-4 xl:sticky xl:top-4 xl:self-start">{side}</div>
    </div>
  );
}
