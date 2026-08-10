import { test, expect } from '@playwright/test';
import { openQueryBuilder, sent, inject } from './harness';

const TABLES = [{ schema: 'tickit', table: 'sales' }, { schema: 'tickit', table: 'venue' }];
const COLUMNS = ['salesid', 'eventid', 'qtysold', 'pricepaid'];

// UXD-019 — Run/Open must use the CURRENT spec, not the async-lagged preview SQL
test('UXD-019: Run carries the current spec (not stale preview text)', async ({ page }) => {
  await openQueryBuilder(page, TABLES, COLUMNS);
  await page.locator('.ck[value="pricepaid"]').check();
  // Deliberately do NOT inject the host 'sql' reply — the <pre> preview is stale.
  await page.locator('#run').click();
  const run = (await sent(page)).reverse().find((m) => m.type === 'run') as { spec?: { columns?: string[] } } | undefined;
  expect(run).toBeDefined();
  expect(run!.spec?.columns).toContain('pricepaid');
});

test('UXD-019: Open also carries the current spec', async ({ page }) => {
  await openQueryBuilder(page, TABLES, COLUMNS);
  await page.locator('#distinct').check();
  await page.locator('#open').click();
  const open = (await sent(page)).reverse().find((m) => m.type === 'open') as { spec?: { distinct?: boolean } } | undefined;
  expect(open!.spec?.distinct).toBe(true);
});

// UXD-020 — a nullary operator must hide the value input
test('UXD-020: IS NULL hides the filter value input', async ({ page }) => {
  await openQueryBuilder(page, TABLES, COLUMNS);
  await page.locator('#addFilter').click();
  const row = page.locator('#filters .frow').first();
  await row.locator('.fop').selectOption('IS NULL');
  await expect(row.locator('.fval')).toBeHidden();
  await row.locator('.fop').selectOption('='); // and comes back for a binary op
  await expect(row.locator('.fval')).toBeVisible();
});

// UXD-021 — changing the table must not leave stale filters from the old table
test('UXD-021: changing the table clears stale filters', async ({ page }) => {
  await openQueryBuilder(page, TABLES, COLUMNS);
  await page.locator('#addFilter').click();
  await expect(page.locator('#filters .frow')).toHaveCount(1);
  await page.locator('#table').selectOption('1'); // venue
  await inject(page, { type: 'columns', columns: ['venueid', 'venuename'] });
  await expect(page.locator('#filters .frow')).toHaveCount(0);
});

// UXD-022 — LIMIT 0 must be expressible (0 is a real limit, not "no limit")
test('UXD-022: LIMIT 0 is carried in the spec', async ({ page }) => {
  await openQueryBuilder(page, TABLES, COLUMNS);
  await page.locator('#limit').fill('0');
  const spec = (await sent(page)).reverse().find((m) => m.type === 'spec') as { spec?: { limit?: number } } | undefined;
  expect(spec!.spec?.limit).toBe(0);
});
