import type { Plugin, Connect } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { warehouseMiddleware } from './warehouses.js';

/**
 * Azure AI Foundry proxy (server side).
 *
 * The browser never sees the API key: it calls `/api/ai/*` on the Celestra
 * server, which forwards the request to Azure AI Foundry using credentials
 * from environment variables (e.g. in `.env.local`):
 *
 *   AZURE_AI_ENDPOINT     https://<resource>.services.ai.azure.com/models   (Foundry Models inference)
 *                      or https://<resource>.openai.azure.com                (Azure OpenAI deployment)
 *                      or a full .../chat/completions URL
 *   AZURE_AI_API_KEY      key from the Foundry project / resource
 *   AZURE_AI_MODEL        model / deployment name, e.g. gpt-4o or gpt-4.1-mini
 *   AZURE_AI_API_VERSION  optional (default 2024-05-01-preview for Foundry, 2024-10-21 for Azure OpenAI)
 */

export interface AzureConfig {
  endpoint: string;
  apiKey: string;
  model: string;
  apiVersion?: string;
}

export function readConfig(env: Record<string, string | undefined>): AzureConfig | null {
  if (env.CELESTRA_AI_DISABLED === '1') return null; // e.g. deterministic browser tests
  const endpoint = env.AZURE_AI_ENDPOINT?.trim();
  const apiKey = env.AZURE_AI_API_KEY?.trim();
  const model = env.AZURE_AI_MODEL?.trim();
  if (!endpoint || !apiKey || !model) return null;
  return { endpoint: endpoint.replace(/\/+$/, ''), apiKey, model, apiVersion: env.AZURE_AI_API_VERSION?.trim() || undefined };
}

/** Build the chat-completions URL for the supported Azure endpoint styles. */
export function chatUrl(c: AzureConfig) {
  if (/\/chat\/completions/.test(c.endpoint)) return c.endpoint;
  if (/\.openai\.azure\.com/.test(c.endpoint) && !/\/models$/.test(c.endpoint)) {
    if (/\/openai\/v1$/.test(c.endpoint)) return `${c.endpoint}/chat/completions`;
    return `${c.endpoint}/openai/deployments/${encodeURIComponent(c.model)}/chat/completions?api-version=${c.apiVersion ?? '2024-10-21'}`;
  }
  const base = /\/models$/.test(c.endpoint) ? c.endpoint : `${c.endpoint}/models`;
  return `${base}/chat/completions?api-version=${c.apiVersion ?? '2024-05-01-preview'}`;
}

export interface ChatRequest {
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
  temperature?: number;
  maxTokens?: number;
}

/** Newer models (GPT-5, o-series) reject max_tokens/temperature; they also spend tokens on reasoning. */
const isReasoningModel = (m: string) => /(^|[^a-z])(gpt-5|o1|o3|o4)/i.test(m);

export async function callAzure(c: AzureConfig, req: ChatRequest) {
  const reasoning = isReasoningModel(c.model);
  const max = req.maxTokens ?? 2000;
  const body: Record<string, unknown> = { model: c.model, messages: req.messages };
  if (reasoning) body.max_completion_tokens = Math.max(max * 4, 8000);
  else {
    body.max_tokens = max;
    body.temperature = req.temperature ?? 0.2;
  }
  // adapt to what the deployment accepts, at most a few retries
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(chatUrl(c), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': c.apiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180_000),
    });
    const text = await res.text();
    if (!res.ok) {
      let msg = text.slice(0, 400);
      try {
        msg = JSON.parse(text).error?.message ?? msg;
      } catch {
        /* keep raw text */
      }
      if (res.status === 400 && /max_tokens/.test(msg) && 'max_tokens' in body) {
        body.max_completion_tokens = Math.max(Number(body.max_tokens) * 4, 8000);
        delete body.max_tokens;
        continue;
      }
      if (res.status === 400 && /max_completion_tokens/.test(msg) && 'max_completion_tokens' in body) {
        body.max_tokens = max;
        delete body.max_completion_tokens;
        continue;
      }
      if (res.status === 400 && /temperature/.test(msg) && 'temperature' in body) {
        delete body.temperature;
        continue;
      }
      throw Object.assign(new Error(`Azure AI Foundry returned ${res.status}: ${msg}`), { status: res.status });
    }
    const json = JSON.parse(text);
    const content = String(json.choices?.[0]?.message?.content ?? '');
    if (!content && json.choices?.[0]?.finish_reason === 'length') throw Object.assign(new Error('The model used its whole token budget before answering (finish_reason=length).'), { status: 502 });
    return { content, model: String(json.model ?? c.model), usage: json.usage ?? null };
  }
  throw Object.assign(new Error('Azure AI Foundry rejected the request parameters.'), { status: 400 });
}

function readBody(req: IncomingMessage): Promise<string> {
  // Vercel functions hand over an already-parsed body; Vite's server gives the raw stream
  const pre = (req as IncomingMessage & { body?: unknown }).body;
  if (pre != null) return Promise.resolve(typeof pre === 'string' ? pre : Buffer.isBuffer(pre) ? pre.toString('utf8') : JSON.stringify(pre));
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 2_000_000) reject(new Error('Request too large'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

const send = (res: ServerResponse, status: number, body: unknown) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
};

export function aiMiddleware(env: Record<string, string | undefined>): Connect.NextHandleFunction {
  return async (req, res, next) => {
    if (!req.url?.startsWith('/api/ai/')) return next();
    const cfg = readConfig(env);
    try {
      if (req.url.startsWith('/api/ai/status') && req.method === 'GET') {
        return send(res, 200, cfg ? { configured: true, provider: 'Azure AI Foundry', model: cfg.model, endpointHost: new URL(cfg.endpoint).host } : { configured: false, provider: 'Azure AI Foundry' });
      }
      if (req.url.startsWith('/api/ai/chat') && req.method === 'POST') {
        if (!cfg) return send(res, 503, { error: 'Azure AI Foundry is not configured on the server (set AZURE_AI_ENDPOINT, AZURE_AI_API_KEY, AZURE_AI_MODEL).' });
        const body = JSON.parse((await readBody(req)) || '{}') as ChatRequest;
        if (!Array.isArray(body.messages) || !body.messages.length) return send(res, 400, { error: 'messages[] is required' });
        return send(res, 200, await callAzure(cfg, body));
      }
      return send(res, 404, { error: 'Unknown AI route' });
    } catch (e) {
      const err = e as Error & { status?: number };
      return send(res, err.status && err.status >= 400 && err.status < 600 ? 502 : 500, { error: err.message });
    }
  };
}

/** Vite plugin: mounts the proxy on both the dev server and `vite preview`. */
export function azureFoundryPlugin(env: Record<string, string | undefined>): Plugin {
  return {
    name: 'celestra-azure-ai-foundry',
    configureServer(server) {
      server.middlewares.use(aiMiddleware(env));
      server.middlewares.use(warehouseMiddleware(env));
    },
    configurePreviewServer(server) {
      server.middlewares.use(aiMiddleware(env));
      server.middlewares.use(warehouseMiddleware(env));
    },
  };
}
