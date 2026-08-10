import { test, expect } from '@playwright/test';
import { openQueryBuilder, sent, inject } from './harness';

const TABLES = [{ schema: 'tickit', table: 'sales' }, { schema: 'tickit', table: 'venue' }];
const COLUMNS = ['salesid', 'eventid', 'qtysold', 'pricepaid'];

test('renders the form with the initial SQL preview', async ({ page }) => {
  await openQueryBuilder(page, TABLES, COLUMNS);
  await expect(page.locator('#sql')).toContainText('SELECT *');
  await expect(page.locator('#sql')).toContainText('FROM tickit.sales');
  await expect(page.locator('.ck')).toHaveCount(4);
});

test('checking a column posts a spec and the host-generated SQL updates', async ({ page }) => {
  await openQueryBuilder(page, TABLES, COLUMNS);
  await page.locator('.ck[value="pricepaid"]').check();
  // The webview posts a spec; simulate the host answering with the SQL.
  const spec = (await sent(page)).reverse().find((m) => m.type === 'spec');
  expect(spec).toBeDefined();
  await inject(page, { type: 'sql', sql: 'SELECT pricepaid\nFROM tickit.sales\nLIMIT 100;' });
  await expect(page.locator('#sql')).toContainText('SELECT pricepaid');
});

test('add + remove a filter row', async ({ page }) => {
  await openQueryBuilder(page, TABLES, COLUMNS);
  await page.locator('#addFilter').click();
  await expect(page.locator('#filters .frow')).toHaveCount(1);
  await page.locator('#filters .frm').click();
  await expect(page.locator('#filters .frow')).toHaveCount(0);
});

test('changing the table asks the host for that table’s columns', async ({ page }) => {
  await openQueryBuilder(page, TABLES, COLUMNS);
  await page.locator('#table').selectOption('1'); // venue
  const pick = (await sent(page)).reverse().find((m) => m.type === 'pickTable');
  expect(pick).toMatchObject({ schema: 'tickit', table: 'venue' });
  // Host answers with venue columns; the checkbox list rebuilds.
  await inject(page, { type: 'columns', columns: ['venueid', 'venuename', 'venueseats'] });
  await expect(page.locator('.ck')).toHaveCount(3);
});

test('Open and Run post the current SQL', async ({ page }) => {
  await openQueryBuilder(page, TABLES, COLUMNS);
  await page.locator('#open').click();
  await page.locator('#run').click();
  const msgs = await sent(page);
  expect(msgs.some((m) => m.type === 'open')).toBe(true);
  expect(msgs.some((m) => m.type === 'run')).toBe(true);
});
