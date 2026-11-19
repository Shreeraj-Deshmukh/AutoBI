import { test, expect } from '@playwright/test';

// a 1×1 PNG, standing in for a dashboard screenshot
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
const shot = (name: string) => ({ name, mimeType: 'image/png', buffer: PNG });

/** What the AI model reports for the screenshot (mocked). */
const INVENTORY = {
  dashboardTitle: 'Retail Performance',
  pages: [
    {
      name: 'Overview',
      filters: [{ label: 'Region' }],
      visuals: [
        { row: 1, type: 'card', title: 'Net Sales', measures: [{ name: 'Net Sales', format: 'currency' }] },
        { row: 2, type: 'filled map', title: 'Net Sales by City', measures: [{ name: 'Net Sales' }], category: 'City' },
        { row: 3, type: 'Q&A', title: 'Ask a question' },
      ],
    },
  ],
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('autobi-fast', '1');
    localStorage.setItem('autobi-session', JSON.stringify({ name: 'Demo user', method: 'demo', signedInAt: new Date().toISOString() }));
  });
});

test('screenshots need the AI model; without it the requirement box works as before', async ({ page }) => {
  await page.goto('/#/new');
  await page.getByTestId('mockup-input').setInputFiles([shot('overview.png')]);
  await expect(page.getByRole('img', { name: /Screenshot 1/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Describe screenshots' })).toBeDisabled();
  await page.getByRole('button', { name: 'Remove screenshot 1' }).click();
  await expect(page.getByRole('img', { name: /Screenshot 1/ })).toHaveCount(0);
});

test('screenshots are sent inline as JPEG and described in the requirement box', async ({ page }) => {
  let sent: { messages: { role: string; content: unknown }[] } | null = null;
  await page.route('**/api/ai/status', (r) => r.fulfill({ json: { configured: true, provider: 'Azure AI Foundry', model: 'test-model', endpointHost: 'test' } }));
  await page.route('**/api/ai/chat', async (r) => {
    sent = r.request().postDataJSON();
    await r.fulfill({ json: { content: JSON.stringify(INVENTORY), model: 'test-model', usage: null } });
  });
  await page.goto('/#/new');
  await page.locator('textarea').last().fill('Also add a Channel filter.');
  await page.getByTestId('mockup-input').setInputFiles([shot('overview.png'), shot('products.png')]);
  await expect(page.getByRole('img', { name: /Screenshot 2/ })).toBeVisible();
  await page.getByRole('button', { name: 'Describe screenshots' }).click();

  const box = page.locator('textarea').last();
  await expect(box).toHaveValue(/^Also add a Channel filter\.\n\nRebuild the "Retail Performance" dashboard/);
  await expect(box).toHaveValue(/"Net Sales by City" \(Overview\) is a map; it will be a horizontal bar chart of the top 10\./);
  await expect(box).toHaveValue(/Not built:\n- "Ask a question" \(Overview\) is a Q&A visual/);

  // one request: the prompt, then the text and both images as inline JPEG data URLs, in page order
  const user = sent!.messages[1].content as { type: string; text?: string; image_url?: { url: string; detail: string } }[];
  expect(sent!.messages[0].role).toBe('system');
  expect(user[0]).toMatchObject({ type: 'text' });
  expect(user.slice(1).map((p) => p.type)).toEqual(['image_url', 'image_url']);
  for (const p of user.slice(1)) {
    expect(p.image_url!.url).toMatch(/^data:image\/jpeg;base64,/);
    expect(p.image_url!.detail).toBe('high');
  }
});
