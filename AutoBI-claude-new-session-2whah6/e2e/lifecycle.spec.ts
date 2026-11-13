import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';

/** Builds a small, deterministic retail dataset (a different domain from the HCP demo). */
function retailFiles() {
  const regions = ['North', 'South', 'East', 'West'];
  const stores = Array.from({ length: 20 }, (_, i) => ({ Store_ID: `S${100 + i}`, Store_Name: `Store ${i + 1}`, Region: regions[i % 4], Format: ['Mall', 'Outlet'][i % 2] }));
  const cats = ['Apparel', 'Footwear', 'Beauty'];
  const sales = Array.from({ length: 600 }, (_, i) => ({ Sale_ID: `T${i + 1}`, Store_ID: stores[(i * 7) % 20].Store_ID, Sale_Date: `2026-${String((i % 9) + 1).padStart(2, '0')}-${String((i % 27) + 1).padStart(2, '0')}`, Product_Category: cats[i % 3], Channel: i % 4 ? 'In-store' : 'Online', Amount: 20 + ((i * 37) % 300) }));
  const csv = (rows: Record<string, unknown>[]) => [Object.keys(rows[0]).join(','), ...rows.map((r) => Object.values(r).join(','))].join('\n');
  return [
    { name: 'stores.csv', mimeType: 'text/csv', buffer: Buffer.from(csv(stores)) },
    { name: 'sales.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ data: sales })) },
  ];
}

async function waitIdle(page: Page) {
  // agents show a pulsing "Agent working" box in the sidebar while running
  await expect(page.getByText('Agent working')).toHaveCount(0, { timeout: 30_000 });
}

test('demo project dashboard is interactive', async ({ page }) => {
  await page.goto('/#/p/demo-hcp/preview');
  const kpi = page.getByTestId('kpi').filter({ hasText: 'Total Calls' }).getByTestId('kpi-value');
  await expect(kpi).toBeVisible();
  const before = await kpi.textContent();
  await page.getByRole('button', { name: 'Region filter' }).click();
  await page.getByLabel('Northeast').check();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByTestId('active-filter')).toContainText('Northeast');
  await expect(kpi).not.toHaveText(before!);
  await page.getByRole('tab', { name: 'Account-Level Performance' }).click();
  await expect(page.getByTestId('data-table')).toBeVisible();
  await page.getByRole('button', { name: 'Reset' }).click();
  await expect(page.getByTestId('active-filter')).toHaveCount(0);
});

test('full lifecycle on a new project with uploaded data', async ({ page }) => {
  await page.goto('/#/new');
  await page.getByPlaceholder('Sales Performance Dashboard').fill('Retail Sales Performance');
  await page.locator('textarea').last().fill('Track sales revenue by region and by product category over time, monthly. Filter by channel and region.');
  await page.getByRole('button', { name: /Create project/ }).click();

  // Requirements
  await expect(page.getByText('KPIs', { exact: true })).toBeVisible({ timeout: 20_000 });
  await waitIdle(page);
  await page.getByRole('button', { name: 'Generate Requirements Specification' }).click();
  await page.getByRole('button', { name: 'Approve Specification' }).click();
  await page.getByRole('button', { name: /Continue to Data/ }).click();

  // Data ingestion & understanding
  await page.getByTestId('file-input').setInputFiles(retailFiles());
  await waitIdle(page);
  await expect(page.getByText('Sale Activity').first()).toBeVisible();
  await expect(page.getByText('Store Master').first()).toBeVisible();
  await page.getByRole('button', { name: /Confirm data understanding/i }).click();

  // Reporting foundation
  await expect(page).toHaveURL(/foundation/);
  await waitIdle(page);
  await page.getByRole('tab', { name: /KPI Definitions/ }).click();
  await expect(page.getByText('Total Amount').first()).toBeVisible();
  await page.getByRole('button', { name: 'Approve Reporting Foundation' }).click();

  // Design
  await expect(page).toHaveURL(/design/);
  await waitIdle(page);
  await expect(page.getByTestId('wireframe')).toBeVisible();
  await page.getByPlaceholder('Modify this dashboard design…').fill('Add a format filter');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('wf-filter').filter({ hasText: 'Format' })).toBeVisible();
  await page.getByRole('button', { name: 'Approve Design & Start Development' }).click();

  // Development
  await expect(page).toHaveURL(/development/);
  await waitIdle(page);
  await expect(page.getByTestId('kpi').first()).toBeVisible();
  await page.getByRole('button', { name: /Continue to Testing/ }).click();

  // Testing
  await page.getByRole('button', { name: /Generate test cases/ }).click();
  await waitIdle(page);
  await page.getByRole('button', { name: 'Run automated tests' }).click();
  await waitIdle(page);
  await expect(page.getByTestId('test-row').filter({ hasText: /Passed(Automated|Manual)/ }).first()).toBeVisible();
  await expect(page.getByTestId('test-row').filter({ hasText: /Failed(Automated|Manual)/ })).toHaveCount(0);
  await page.getByRole('tab', { name: /Data Validation Testing/ }).click();
  await expect(page.getByTestId('test-row').filter({ hasText: /Passed(Automated|Manual)/ }).first()).toBeVisible();
  await expect(page.getByTestId('test-row').filter({ hasText: /Failed(Automated|Manual)/ })).toHaveCount(0);

  // Analyst-led UAT: execute every manual scenario, then sign off
  await page.getByRole('tab', { name: /^UAT/ }).click();
  const items = page.locator('ul.divide-y > li > button');
  const n = await items.count();
  expect(n).toBeGreaterThan(5);
  for (let i = 0; i < n; i++) {
    await items.nth(i).click();
    await page.getByRole('button', { name: 'Pass', exact: true }).click();
  }
  await page.getByLabel('Approver name').fill('Jordan Analyst');
  await page.getByRole('button', { name: 'Approve UAT' }).click();
  await expect(page.getByText('UAT signed off')).toBeVisible();

  // Final documentation package
  await page.getByRole('button', { name: /Generate final documentation/ }).click();
  await page.getByRole('button', { name: /Generate documentation|Generate final package/ }).click();
  await waitIdle(page);
  await expect(page.getByText(/Final package v1/)).toBeVisible();
  await expect(page.getByTestId('doc-preview')).toContainText('Business Requirements Document');
  await expect(page.getByText('Documentation').first()).toBeVisible();
  // export works (download is triggered)
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Markdown (.md)' }).click();
  expect((await dl).suggestedFilename()).toMatch(/\.md$/);
  // every stage approved/completed → overall progress 100%
  await expect(page.getByText('100%', { exact: true })).toBeVisible();
});

test('a sample project works with its files uploaded manually', async ({ page }) => {
  await page.goto('/#/new');
  await page.getByLabel('Sample project').selectOption('access');
  await page.getByRole('button', { name: /Create project/ }).click();
  await expect(page.getByText('KPIs', { exact: true })).toBeVisible({ timeout: 20_000 });
  await waitIdle(page);
  await page.getByRole('button', { name: 'Generate Requirements Specification' }).click();
  await page.getByRole('button', { name: 'Approve Specification' }).click();
  await page.getByRole('button', { name: /Continue to Data/ }).click();
  await page.getByTestId('file-input').setInputFiles(['sp_patient_journey.csv', 'payer_plan_pbm.csv', 'hcp_frm_alignment.xlsx', 'frm_cases.csv'].map((f) => path.resolve('public/sample-data/access', f)));
  await waitIdle(page);
  await expect(page.getByText('Patient Activity').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Plan Master').first()).toBeVisible();
  await expect(page.getByText('Territory Master').first()).toBeVisible();
  await page.getByRole('tab', { name: /Links & quality/ }).click();
  await expect(page.getByText(/Plan_ID that does not exist/).first()).toBeVisible();
});
