import { useState } from 'react';
import { cx } from './ui';

/**
 * Client brand mark shown on dashboards (company standard: top-left of the report banner).
 * Sanofi logo (2022 identity, from Wikimedia Commons) at public/brand/sanofi-logo.svg;
 * if the file is missing a text wordmark is shown.
 */
export default function BrandLogo({ className }: { className?: string }) {
  const [ok, setOk] = useState(true);
  if (ok) return <img src="brand/sanofi-logo.svg" alt="Sanofi" className={cx('h-10 w-auto object-contain', className)} onError={() => setOk(false)} />;
  return <span className={cx('select-none text-[0.9375rem] font-extrabold lowercase tracking-tight text-navy-900', className)} aria-label="Sanofi">sanofi</span>;
}
