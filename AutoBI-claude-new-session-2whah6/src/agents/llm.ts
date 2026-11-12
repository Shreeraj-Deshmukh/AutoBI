import { create } from 'zustand';

/**
 * AI model layer (model v2): Azure AI Foundry.
 *
 * The browser calls the Celestra server (`/api/ai/*`), which holds the Azure
 * credentials and forwards requests to Azure AI Foundry (see server/azureFoundry.ts).
 * Every agent keeps a deterministic implementation; when AI is unavailable,
 * disabled, or a call fails, agents fall back to it and say so on the run.
 */

interface AIState {
  status: 'checking' | 'unconfigured' | 'ready' | 'offline';
  model?: string;
  endpointHost?: string;
  enabled: boolean;
  lastError?: string;
  setEnabled: (v: boolean) => void;
}

const PREF = 'celestra-ai-enabled';
const readPref = () => {
  try {
    return localStorage.getItem(PREF) !== 'false';
  } catch {
    return true;
  }
};

export const useAI = create<AIState>((set) => ({
  status: 'checking',
  enabled: typeof localStorage === 'undefined' ? true : readPref(),
  setEnabled: (v) => {
    try {
      localStorage.setItem(PREF, String(v));
    } catch {
      /* ignore */
    }
    set({ enabled: v });
  },
}));

export async function initAI() {
  try {
    const r = await fetch('api/ai/status');
    if (!r.ok) throw new Error(`status ${r.status}`);
    const j = await r.json();
    useAI.setState(j.configured ? { status: 'ready', model: j.model, endpointHost: j.endpointHost } : { status: 'unconfigured' });
  } catch {
    // static hosting without the Celestra server: AI proxy not available
    useAI.setState({ status: 'offline' });
  }
}

export const aiActive = () => {
  const s = useAI.getState();
  return s.status === 'ready' && s.enabled;
};

export const DETERMINISTIC = 'Deterministic engine';
export const engineLabel = () => (aiActive() ? `Azure AI Foundry · ${useAI.getState().model}` : DETERMINISTIC);

type Msg = { role: 'system' | 'user' | 'assistant'; content: string };

export async function chat(messages: Msg[], opts: { temperature?: number; maxTokens?: number } = {}): Promise<string> {
  const r = await fetch('api/ai/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages, ...opts }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `AI request failed (${r.status})`);
  return String(j.content ?? '');
}

/** Extract the first JSON object from a model response (tolerates code fences / prose). */
export function parseJsonLoose<T>(text: string): T {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const src = fenced ? fenced[1] : text;
  const start = src.indexOf('{');
  const end = src.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('Model did not return JSON');
  return JSON.parse(src.slice(start, end + 1)) as T;
}

export async function chatJSON<T>(system: string, user: string, opts: { maxTokens?: number } = {}): Promise<T> {
  const text = await chat([{ role: 'system', content: `${system}\nRespond with a single valid JSON object only — no prose, no markdown.` }, { role: 'user', content: user }], { temperature: 0.1, maxTokens: opts.maxTokens ?? 2500 });
  return parseJsonLoose<T>(text);
}

export interface AIResult<T> {
  value: T;
  engine: string;
  aiError?: string;
}

/** Run the AI path when active, otherwise (or on failure) the deterministic fallback. */
export async function withAI<T>(ai: () => Promise<T>, fallback: () => T): Promise<AIResult<T>> {
  if (!aiActive()) return { value: fallback(), engine: DETERMINISTIC };
  try {
    const value = await ai();
    useAI.setState({ lastError: undefined });
    return { value, engine: engineLabel() };
  } catch (e) {
    const msg = (e as Error).message;
    useAI.setState({ lastError: msg });
    return { value: fallback(), engine: `${DETERMINISTIC} (AI fallback)`, aiError: msg };
  }
}
