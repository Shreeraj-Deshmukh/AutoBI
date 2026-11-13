import { marked, type Token, type Tokens } from 'marked';
import { Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType, BorderStyle } from 'docx';
import type { DocArtifact } from '@/types';
import { download } from './util';

// Raw HTML in markdown (which may originate from uploaded data values) is escaped, never rendered.
const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
marked.use({ renderer: { html: (token: Tokens.HTML | Tokens.Tag) => escHtml(token.text) } });

/** Let long identifiers (Fact_Call_Activity, table.field) wrap at their separators inside table cells. */
const softBreaks = (html: string) =>
  html.replace(/(<t[dh][^>]*>)([\s\S]*?)(<\/t[dh]>)/g, (_m, open: string, inner: string, close: string) =>
    open + inner.replace(/(^|>)([^<]+)/g, (_x, gt: string, text: string) => gt + text.replace(/([_.\/])(?=\w)/g, '$1<wbr>')) + close);

/** Markdown → HTML; wide tables get their own horizontal scroll instead of stretching the page. */
export const mdToHtml = (md: string) =>
  softBreaks(marked.parse(md, { async: false }) as string).replace(/<table>/g, '<div class="md-table"><table>').replace(/<\/table>/g, '</table></div>');

const STYLE = `body{font-family:Inter,Segoe UI,Arial,sans-serif;color:#262626;max-width:960px;margin:32px auto;padding:0 24px;font-size:13px;line-height:1.5}h1{color:#171717;font-size:24px}h2{color:#171717;font-size:17px;border-bottom:1px solid #e2e8f0;padding-bottom:4px;margin-top:28px}h3{font-size:14px}table{border-collapse:collapse;width:100%;font-size:11px;margin:10px 0}th,td{border:1px solid #cbd5e1;padding:4px 6px;text-align:left;vertical-align:top}th{background:#f1f5f9}blockquote{border-left:4px solid #bd8bff;background:#f6efff;margin:8px 0;padding:6px 12px}code{background:#f1f5f9;padding:0 3px;border-radius:3px}@media print{body{margin:0}h2{page-break-after:avoid}table{page-break-inside:auto}tr{page-break-inside:avoid}}`;

export function docsToHtml(docs: DocArtifact[], title: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>${STYLE}</style></head><body>${docs.map((d) => mdToHtml(d.markdown)).join('<div style="page-break-after:always"></div>')}</body></html>`;
}

export function exportMarkdown(docs: DocArtifact[], name: string) {
  download(`${name}.md`, docs.map((d) => d.markdown).join('\n\n---\n\n'), 'text/markdown');
}

export function exportHtml(docs: DocArtifact[], name: string) {
  download(`${name}.html`, docsToHtml(docs, name), 'text/html');
}

/** Opens a print-ready window so the browser can save the document as PDF. */
export function exportPdf(docs: DocArtifact[], name: string) {
  const w = window.open('', '_blank');
  if (!w) {
    alert('Pop-up blocked — allow pop-ups to export PDF, or use the HTML export and print it.');
    return;
  }
  w.document.write(docsToHtml(docs, name));
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 400);
}

function inline(tokens: Token[] | undefined, bold = false): TextRun[] {
  if (!tokens) return [];
  const out: TextRun[] = [];
  for (const t of tokens) {
    if (t.type === 'strong') out.push(...inline((t as Tokens.Strong).tokens, true));
    else if (t.type === 'em') out.push(...inline((t as Tokens.Em).tokens, bold));
    else if (t.type === 'codespan') out.push(new TextRun({ text: (t as Tokens.Codespan).text, font: 'Consolas', bold }));
    else if (t.type === 'br') out.push(new TextRun({ text: '', break: 1 }));
    else if ('tokens' in t && Array.isArray((t as Tokens.Generic).tokens)) out.push(...inline((t as Tokens.Generic).tokens, bold));
    else out.push(new TextRun({ text: decode((t as Tokens.Text).text ?? (t as Tokens.Generic).raw ?? ''), bold }));
  }
  return out;
}

const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const border = { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' };

function blocks(tokens: Token[]): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];
  for (const t of tokens) {
    if (t.type === 'heading') {
      const h = t as Tokens.Heading;
      out.push(new Paragraph({ heading: [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3][Math.min(h.depth, 3) - 1], children: inline(h.tokens), spacing: { before: 240, after: 120 } }));
    } else if (t.type === 'paragraph') out.push(new Paragraph({ children: inline((t as Tokens.Paragraph).tokens), spacing: { after: 100 } }));
    else if (t.type === 'list') {
      const l = t as Tokens.List;
      l.items.forEach((it, i) => out.push(new Paragraph({ children: [new TextRun(l.ordered ? `${i + 1}. ` : '• '), ...inline(it.tokens.flatMap((x) => ('tokens' in x && x.tokens ? x.tokens : [x])))], indent: { left: 360 }, spacing: { after: 40 } })));
    } else if (t.type === 'blockquote') out.push(new Paragraph({ children: inline((t as Tokens.Blockquote).tokens.flatMap((x) => ('tokens' in x && x.tokens ? x.tokens : [x]))), indent: { left: 360 }, shading: { fill: 'EEF4FF' } }));
    else if (t.type === 'table') {
      const tb = t as Tokens.Table;
      const row = (cells: Tokens.TableCell[], head = false) => new TableRow({ tableHeader: head, children: cells.map((c) => new TableCell({ borders: { top: border, bottom: border, left: border, right: border }, shading: head ? { fill: 'F1F5F9' } : undefined, children: [new Paragraph({ children: inline(c.tokens, head).map((r) => r), spacing: { after: 0 } })] })) });
      out.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [row(tb.header, true), ...tb.rows.map((r) => row(r))] }));
      out.push(new Paragraph({ text: '' }));
    } else if (t.type === 'hr') out.push(new Paragraph({ text: '', pageBreakBefore: true }));
  }
  return out;
}

export async function exportDocx(docs: DocArtifact[], name: string) {
  const sections = docs.map((d, i) => ({ properties: i ? {} : {}, children: blocks(marked.lexer(d.markdown)) }));
  const doc = new Document({ creator: 'Celestra Documentation Agent', title: name, styles: { default: { document: { run: { font: 'Calibri', size: 20 } } } }, sections });
  const blob = await Packer.toBlob(doc);
  download(`${name}.docx`, blob);
}
