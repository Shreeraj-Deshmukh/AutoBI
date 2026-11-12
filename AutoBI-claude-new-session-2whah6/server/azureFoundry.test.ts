import { describe, it, expect } from 'vitest';
import { chatUrl, readConfig } from './azureFoundry';

describe('Azure AI Foundry config', () => {
  it('requires endpoint, key and model', () => {
    expect(readConfig({ AZURE_AI_ENDPOINT: 'x' })).toBeNull();
  });
  it('builds URLs for each endpoint style', () => {
    const base = { apiKey: 'k', model: 'gpt-4o' };
    expect(chatUrl({ ...base, endpoint: 'https://r.services.ai.azure.com/models' })).toBe('https://r.services.ai.azure.com/models/chat/completions?api-version=2024-05-01-preview');
    expect(chatUrl({ ...base, endpoint: 'https://r.services.ai.azure.com' })).toBe('https://r.services.ai.azure.com/models/chat/completions?api-version=2024-05-01-preview');
    expect(chatUrl({ ...base, endpoint: 'https://r.openai.azure.com' })).toBe('https://r.openai.azure.com/openai/deployments/gpt-4o/chat/completions?api-version=2024-10-21');
    expect(chatUrl({ ...base, endpoint: 'https://r.openai.azure.com/openai/v1' })).toBe('https://r.openai.azure.com/openai/v1/chat/completions');
    expect(chatUrl({ ...base, endpoint: 'https://x/chat/completions?api-version=1' })).toBe('https://x/chat/completions?api-version=1');
  });
});
