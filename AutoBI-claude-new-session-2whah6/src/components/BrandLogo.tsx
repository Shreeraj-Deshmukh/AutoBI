import { useState } from 'react';
import { cx } from './ui';

/**
 * Client brand mark shown on dashboards (company standard: top-right corner).
 * Drop the official logo file at public/brand/procdna-logo.png (or .svg) to use it;
 * until then a text wordmark is shown.
 */
export default function BrandLogo({ className }: { className?: string }) {
  const [src, setSrc] = useState<string | null>('brand/procdna-logo.png');
  if (src)
    return <img src={src} alt="ProcDNA" className={cx('h-10 w-auto object-contain', className)} onError={() => setSrc(src.endsWith('.png') ? 'brand/procdna-logo.svg' : null)} />;
  return <span className={cx('select-none text-[0.9375rem] font-extrabold tracking-tight text-navy-900', className)} aria-label="ProcDNA">Proc<span className="text-brand-600">DNA</span></span>;
}
