import { useEffect, useState, type ButtonHTMLAttributes, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react';
import { Download } from 'lucide-react';
import type { DashPage } from '@/types';
import { cx } from '@/components/ui';
import BrandLogo from '@/components/BrandLogo';
import { PAGE_W, type Box } from '@/lib/powerbi/layout';
import { BANNER, CLIENT_THEME as C, REPORT as R, pt } from './format';

/**
 * The pieces of a report page as the Power BI export draws them (banner, page tabs, title, filter band, slicer and
 * visual boxes), shared by the web dashboard and the design wireframe so both look like the downloaded report.
 */

/** Box on the report page, in report pixels. */
export const pos = (b: Box): CSSProperties => ({ left: b.x, width: b.width, top: b.y, height: b.height });

/**
 * The report page at the width available, like Power BI's "Fit to width": the page is drawn at its report size
 * (PAGE_W wide) and zoomed as a whole, so every box keeps the proportions it has in the Power BI file.
 */
export function ReportCanvas({ height, children, className, ...rest }: { height: number; children: ReactNode; className?: string } & HTMLAttributes<HTMLDivElement>) {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    if (!el) return;
    const fit = () => el.clientWidth && setScale(el.clientWidth / PAGE_W);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return (
    <div ref={setEl} className="w-full overflow-hidden">
      <div className={cx('relative', className)} style={{ width: PAGE_W, height, zoom: scale }} {...rest}>
        {children}
      </div>
    </div>
  );
}

/** Banner background: the purple gradient and the white chip the logo sits on. */
export function Banner() {
  return (
    <div className="relative h-full w-full" style={{ background: `linear-gradient(90deg, ${BANNER.from}, ${BANNER.via} 50%, ${BANNER.to})` }}>
      <div className="absolute rounded-md bg-white" style={pos(BANNER.chip)} />
    </div>
  );
}

export const Logo = () => <BrandLogo className="h-full w-full" />;

/** Page tabs (Power BI page navigator): light text, the current page bold white and underlined. */
export function Tabs({ pages, activeId, onSelect, tabProps }: { pages: DashPage[]; activeId?: string; onSelect: (id: string) => void; tabProps?: (p: DashPage) => ButtonHTMLAttributes<HTMLButtonElement> }) {
  return (
    <div className="flex h-full" role="tablist">
      {pages.map((p) => {
        const on = p.id === activeId;
        const extra = tabProps?.(p) ?? {};
        return (
          <button key={p.id} role="tab" aria-selected={on} onClick={() => onSelect(p.id)} {...extra} className={cx('relative flex min-w-0 flex-1 items-center justify-center px-1 text-center leading-tight hover:!text-white', extra.className)} style={{ fontSize: pt(10), color: on ? BANNER.tabActive : BANNER.tab, fontWeight: on ? 700 : 400 }}>
            {p.name}
            {on && <span className="absolute inset-x-0 bottom-0 h-[3px]" style={{ background: BANNER.tabActive }} />}
          </button>
        );
      })}
    </div>
  );
}

export function PageTitle({ page }: { page?: DashPage }) {
  return (
    <div className="min-w-0">
      <div className="truncate font-bold leading-tight" style={{ fontSize: pt(R.pageTitle), color: C.primary }}>{page?.name}</div>
      {page?.description && <div className="mt-0.5 truncate" style={{ fontSize: pt(R.pageDescription), color: C.muted }}>{page.description}</div>}
    </div>
  );
}

export const FilterBand = () => <div className="h-full w-full" style={{ background: R.filterBand }} data-testid="filter-bar" />;

export const SectionHeading = ({ text }: { text: string }) => (
  <div className="flex h-full items-center font-bold uppercase" style={{ fontSize: pt(R.section), color: C.primary }} data-testid="section-heading">{text}</div>
);

/** Dropdown / date box inside a slicer (Power BI's dropdown slicer). */
export const SELECT = 'w-full rounded-sm border border-neutral-300 bg-white px-1.5 py-1 text-[12px] text-neutral-800 outline-none focus:border-brand-500';

export function SlicerBox({ label, children, className, testId }: { label: string; children: ReactNode; className?: string; testId?: string }) {
  return (
    <div className={cx('flex h-full flex-col justify-center bg-white px-2.5', className)} style={{ border: `1px solid ${C.border}`, borderRadius: R.radius }} data-testid={testId}>
      <div className="mb-1.5 truncate font-bold" style={{ fontSize: pt(R.slicerHeader), color: R.slicerHeaderColor }}>{label}</div>
      {children}
    </div>
  );
}

/** A visual's box: white, light border, rounded corners; title and subtitle at the top (the report theme). */
export function VisualBox({ title, subtitle, children, onExport, testId, dataTitle, className, style }: { title?: string; subtitle?: ReactNode; children: ReactNode; onExport?: () => void; testId?: string; dataTitle?: string; className?: string; style?: CSSProperties }) {
  return (
    <div className={cx('group relative flex h-full flex-col overflow-hidden bg-white', className)} style={{ border: `1px solid ${C.border}`, borderRadius: R.radius, ...style }} data-testid={testId} data-title={dataTitle}>
      {title && (
        <div className="px-2.5 pt-2 pr-8">
          <div className="truncate font-semibold leading-snug" style={{ fontSize: pt(R.title), color: R.titleColor }} title={title}>{title}</div>
          {subtitle && <div className="truncate leading-snug" style={{ fontSize: pt(R.subtitle), color: C.muted }} title={typeof subtitle === 'string' ? subtitle : undefined}>{subtitle}</div>}
        </div>
      )}
      {/* Power BI's visual header "Export data" */}
      {onExport && (
        <button onClick={onExport} className="absolute right-1.5 top-1.5 rounded p-1 text-neutral-500 opacity-0 hover:bg-neutral-100 group-hover:opacity-100" title="Export data (CSV)" aria-label={`Export ${dataTitle ?? title ?? 'data'}`}>
          <Download className="h-3.5 w-3.5" />
        </button>
      )}
      <div className="min-h-0 flex-1 px-2 pb-1.5 pt-1">{children}</div>
    </div>
  );
}
