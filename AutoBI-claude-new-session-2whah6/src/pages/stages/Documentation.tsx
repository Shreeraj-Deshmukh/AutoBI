import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FileText, FileDown, RefreshCw, CheckCircle2, FileType2, Printer, Code, Rocket } from 'lucide-react';
import type { Project } from '@/types';
import StageLayout from '@/components/StageLayout';
import { Button, Callout, Card, Badge, Empty, cx } from '@/components/ui';
import { isRunning, publishRelease, runDocumentationAgent } from '@/store/orchestrator';
import { exportDocx, exportHtml, exportMarkdown, exportPdf, mdToHtml } from '@/lib/exportDocs';
import { fmtDateTime } from '@/lib/util';
import { docBasis } from '@/agents/documentationAgent';
import { FEATURES } from '@/config/features';

export default function DocumentationStage({ p }: { p: Project }) {
  const D = p.documentation;
  const busy = isRunning(p, 'documentation');
  const [params] = useSearchParams();
  const [sel, setSel] = useState(params.get('doc') ?? D?.docs[0]?.id ?? '');
  const [exporting, setExporting] = useState(false);
  const doc = D?.docs.find((d) => d.id === sel) ?? D?.docs[0];
  const uatOk = p.testing?.signoff.status === 'approved';
  const name = `${p.info.name} - ${doc?.title ?? 'Documentation'}`.replace(/[^\w\- &]+/g, '');
  const pkg = `${p.info.name} - Documentation Package v${D?.version ?? 0}`.replace(/[^\w\- &]+/g, '');
  const outdated = D && D.basis !== docBasis(p);

  const main = !D ? (
    <Empty icon={<FileText className="h-5 w-5" />} title="No documentation generated yet" action={<Button variant="primary" loading={busy} onClick={() => runDocumentationAgent(p.id)}>Generate documentation</Button>}>Documentation can be generated progressively at any stage. The final package requires UAT sign-off and reflects the latest approved artifacts and test results.</Empty>
  ) : (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={D.final ? 'green' : 'amber'}>{D.final ? <><CheckCircle2 className="h-3 w-3" /> Final package v{D.version}</> : `Draft package v${D.version}`}</Badge>
        <span className="text-xs text-slate-500">Generated {fmtDateTime(D.generatedAt)} · {D.docs.length} documents</span>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button size="sm" variant={uatOk && !D.final ? 'success' : 'secondary'} icon={<RefreshCw className="h-3.5 w-3.5" />} loading={busy} onClick={() => runDocumentationAgent(p.id)}>{uatOk ? (D.final ? 'Regenerate final package' : 'Generate final package') : 'Regenerate draft'}</Button>
        </div>
      </div>
      <ReleaseCard p={p} />
      {(outdated || !uatOk) && <Callout tone={outdated ? 'info' : 'warning'}>{outdated ? 'The project changed since this package was generated — regenerate to update it.' : 'Draft package: sign off UAT to produce the final documentation.'}</Callout>}
      <div className="grid gap-4 lg:grid-cols-[16.25rem_minmax(0,1fr)]">
        <Card title="Documents" bodyClass="p-1.5">
          {D.docs.map((d, i) => (
            <button key={d.id} onClick={() => setSel(d.id)} className={cx('flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left', doc?.id === d.id ? 'bg-brand-50 text-brand-800' : 'hover:bg-slate-50')}>
              <FileText className="mt-0.5 h-4 w-4 shrink-0" />
              <span><span className="block text-xs font-medium">{i + 1}. {d.title}</span><span className="text-[0.625rem] text-slate-500">{d.basedOn.join(' · ')}</span></span>
            </button>
          ))}
          <div className="mt-2 space-y-1.5 border-t border-slate-100 p-2">
            <div className="text-[0.6875rem] font-semibold uppercase text-slate-500">Export full package</div>
            <Button size="xs" className="w-full" icon={<FileType2 className="h-3 w-3" />} loading={exporting} onClick={async () => { setExporting(true); try { await exportDocx(D.docs, pkg); } finally { setExporting(false); } }}>Word (.docx)</Button>
            <Button size="xs" className="w-full" icon={<Printer className="h-3 w-3" />} onClick={() => exportPdf(D.docs, pkg)}>PDF (print)</Button>
            <Button size="xs" className="w-full" icon={<FileDown className="h-3 w-3" />} onClick={() => exportMarkdown(D.docs, pkg)}>Markdown (.md)</Button>
            <Button size="xs" className="w-full" icon={<Code className="h-3 w-3" />} onClick={() => exportHtml(D.docs, pkg)}>HTML</Button>
          </div>
        </Card>
        {doc && (
          <Card title={doc.title} subtitle={`Version ${doc.version} · based on ${doc.basedOn.join(', ')}`} actions={<>
            <Button size="xs" icon={<FileType2 className="h-3 w-3" />} onClick={() => exportDocx([doc], name)}>DOCX</Button>
            <Button size="xs" icon={<Printer className="h-3 w-3" />} onClick={() => exportPdf([doc], name)}>PDF</Button>
            <Button size="xs" icon={<FileDown className="h-3 w-3" />} onClick={() => exportMarkdown([doc], name)}>MD</Button>
          </>}>
            <article className="md" data-testid="doc-preview" dangerouslySetInnerHTML={{ __html: mdToHtml(doc.markdown) }} />
          </Card>
        )}
      </div>
    </>
  );
  return <StageLayout p={p} agent="documentation" main={main} next={D?.final ? 'Project completed. The final package reflects the approved design, generated dashboard and signed-off UAT.' : 'Complete UAT sign-off, then regenerate to produce the final documentation package.'} />;
}

function ReleaseCard({ p }: { p: Project }) {
  const uatOk = p.testing?.signoff.status === 'approved';
  const pub = p.release?.published;
  const users = p.release?.users ?? [];
  const [by, setBy] = useState(p.testing?.signoff.by ?? '');
  return (
    <Card title={<span className="flex items-center gap-2"><Rocket className="h-4 w-4 text-brand-600" />Release</span>} subtitle={FEATURES.rowLevelSecurity ? "Publish the validated dashboard for field users with their access rules." : "Publish the validated dashboard for field users."}>
      {pub ? (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Badge tone="green"><CheckCircle2 className="h-3 w-3" /> Published</Badge>
          <span className="text-slate-600">Dashboard v{pub.dashboardVersion} · {fmtDateTime(pub.at)} by {pub.by}{FEATURES.rowLevelSecurity ? ` · ${users.filter((u) => u.values.length).length} field user(s) with row-level security` : ''}</span>
          <a className="ml-auto text-sm font-medium text-brand-700 hover:underline" href={pub.url} target="_blank" rel="noreferrer">Open published dashboard</a>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <input className="input w-56 py-1.5 text-sm" placeholder="Published by" value={by} onChange={(e) => setBy(e.target.value)} aria-label="Published by" />
          <Button size="sm" variant="primary" icon={<Rocket className="h-3.5 w-3.5" />} disabled={!uatOk || !by.trim()} title={uatOk ? '' : 'UAT sign-off is required before publishing'} onClick={() => publishRelease(p.id, by.trim())}>Publish dashboard</Button>
          <span className="text-xs text-slate-500">{uatOk ? (FEATURES.rowLevelSecurity ? `${users.filter((u) => u.values.length).length} field user(s) will see only their territory.` : 'Ready to publish.') : 'Available after UAT sign-off.'}</span>
        </div>
      )}
    </Card>
  );
}
