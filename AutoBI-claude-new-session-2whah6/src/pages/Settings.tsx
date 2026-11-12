import { useState } from 'react';
import { CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';
import { Button, Card, Callout } from '@/components/ui';
import { chat, initAI, useAI } from '@/agents/llm';
import PageHeader from '@/components/PageHeader';

const USES = [
  ['Requirement Intelligence', 'Extracts the specification from your brief and answers in the requirements chat'],
  ['Data Intelligence', 'Writes business descriptions of datasets and columns (metadata and a few example values only — never full rows)'],
  ['Design assistant', 'Turns free-form change requests into wireframe edits'],
  ['Documentation', 'Writes the executive summary of the documentation package'],
];

export default function Settings() {
  const ai = useAI();
  const [test, setTest] = useState<{ state: 'idle' | 'running' | 'ok' | 'error'; text?: string }>({ state: 'idle' });
  const run = async () => {
    setTest({ state: 'running' });
    try {
      const t0 = performance.now();
      const reply = await chat([{ role: 'user', content: 'Reply with the single word: ready' }], { maxTokens: 10 });
      setTest({ state: 'ok', text: `“${reply.trim()}” in ${Math.round(performance.now() - t0)} ms` });
    } catch (e) {
      setTest({ state: 'error', text: (e as Error).message });
    }
  };
  return (
    <div className="min-h-full bg-slate-50">
      <PageHeader title="AI model" description="Celestra uses Azure AI Foundry for language tasks. Calculations, data mapping and test validation always stay deterministic, so the numbers can be verified." />
      <div className="mx-auto max-w-6xl space-y-5 px-6 py-6">
      <Card title="Azure AI Foundry">
        {ai.status === 'checking' && <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />Checking connection…</div>}
        {ai.status === 'ready' && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4" />Connected · model <b>{ai.model}</b> · {ai.endpointHost}</div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={ai.enabled} onChange={(e) => ai.setEnabled(e.target.checked)} />
              Use the AI model in agents (turn off to run fully deterministic)
            </label>
            <div className="flex items-center gap-3">
              <Button size="sm" onClick={run} loading={test.state === 'running'}>Test connection</Button>
              {test.state === 'ok' && <span className="text-xs text-emerald-700">{test.text}</span>}
              {test.state === 'error' && <span className="text-xs text-red-600">{test.text}</span>}
            </div>
            {ai.lastError && <Callout tone="warning" title="Last AI call failed — the deterministic engine was used">{ai.lastError}</Callout>}
          </div>
        )}
        {(ai.status === 'unconfigured' || ai.status === 'offline') && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-amber-700"><AlertTriangle className="h-4 w-4" />{ai.status === 'offline' ? 'The AI proxy is not reachable (static hosting). Run Celestra with `npm run dev` or `npm run preview`.' : 'Not configured — agents run in deterministic mode.'}</div>
            <div className="text-sm text-slate-600">Create <code className="rounded bg-slate-100 px-1">.env.local</code> in the project root and restart the server:</div>
            <pre className="overflow-x-auto rounded-lg bg-navy-950 p-3 text-xs text-blue-100">{`AZURE_AI_ENDPOINT=https://<resource>.services.ai.azure.com/models
AZURE_AI_API_KEY=<key from your Foundry project>
AZURE_AI_MODEL=gpt-4o        # your deployment / model name`}</pre>
            <div className="text-xs text-slate-500">Azure OpenAI endpoints (<code>https://&lt;resource&gt;.openai.azure.com</code>) also work. The key stays on the server; the browser only talks to <code>/api/ai</code>.</div>
            <Button size="sm" onClick={() => initAI()}>Check again</Button>
          </div>
        )}
      </Card>

      <Card title="Where the model is used">
        <ul className="space-y-2">
          {USES.map(([a, b]) => (
            <li key={a} className="text-sm"><span className="font-medium text-navy-900">{a}</span><span className="text-slate-500"> — {b}</span></li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-slate-500">If a call fails, the agent falls back to its deterministic engine and the run is labelled accordingly.</p>
      </Card>
      </div>
    </div>
  );
}
