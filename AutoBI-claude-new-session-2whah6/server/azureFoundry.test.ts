import { describe, it, expect } from 'vitest';
import { chatUrl, hasOnlyInlineImages, readConfig } from './azureFoundry';

describe('images in chat requests', () => {
  const img = (url: string) => [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'Describe' }, { type: 'image_url' as const, image_url: { url } }] }];
  it('plain text messages are accepted as before', () => {
    expect(hasOnlyInlineImages([{ role: 'system', content: 'x' }, { role: 'user', content: 'y' }])).toBe(true);
  });
  it('inline screenshots are accepted', () => {
    expect(hasOnlyInlineImages(img('data:image/jpeg;base64,/9j/4AAQ'))).toBe(true);
    expect(hasOnlyInlineImages(img('data:image/png;base64,iVBORw0KGgo'))).toBe(true);
  });
  it('links to images are refused (Azure would fetch them)', () => {
    expect(hasOnlyInlineImages(img('https://example.com/a.png'))).toBe(false);
    expect(hasOnlyInlineImages(img('data:text/html;base64,PGgxPg=='))).toBe(false);
    expect(hasOnlyInlineImages([{ role: 'user', content: [{ type: 'file', file: {} }] as never }])).toBe(false);
  });
});

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
