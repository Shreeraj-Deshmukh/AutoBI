/**
 * Exports a demo kit to a Power BI Project folder (and zip), the same files the
 * app's "Download for Power BI" button produces, so it can be opened in Power BI
 * Desktop or validated without clicking through the app.
 *
 *   npx vite-node scripts/export-powerbi.ts -- <kit: access|brand|hcp|retail> <outDir>
 *
 * The kit files are read from public/sample-data and parsed with the app's ingest code.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DEMO_KITS } from '../src/lib/demoKits';
import { parseFile } from '../src/lib/ingest';
import { runDemoPipeline } from '../src/lib/powerbi/demoPipeline';
import { longestPath, zipExport } from '../src/lib/powerbi';

const args = process.argv.slice(2).filter((a) => a !== '--');
const kit = DEMO_KITS.find((k) => k.id === (args[0] ?? 'access'));
if (!kit) throw new Error(`Unknown kit "${args[0]}". Use one of: ${DEMO_KITS.map((k) => k.id).join(', ')}`);
const out = path.resolve(args[1] ?? 'powerbi-export');

const tables = [];
for (const f of kit.files) {
  const buf = fs.readFileSync(path.resolve(__dirname, '../public/sample-data', kit.id, f));
  for (const t of await parseFile(new File([buf], f))) tables.push({ name: t.name, rows: t.rows });
}
const r = runDemoPipeline(kit.project, kit.narrative, tables);
const x = r.pbi;
const root = path.join(out, x.name);
fs.rmSync(root, { recursive: true, force: true });
for (const [p, content] of Object.entries(x.files)) {
  const file = path.join(root, p);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}
fs.writeFileSync(path.join(out, `${x.name}_PowerBI.zip`), zipExport(x));
const longest = root.length + 1 + longestPath(x);
console.log(JSON.stringify({ folder: root, pbip: path.join(root, `${x.name}.pbip`), longestFullPath: longest, ...x.summary, warnings: x.warnings }, null, 2));
if (longest > 259) console.warn(`WARNING: the deepest file path is ${longest} characters; Windows limits paths to 260. Use a shorter output folder.`);
