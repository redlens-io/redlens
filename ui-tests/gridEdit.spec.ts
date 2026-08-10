import { test, expect } from '@playwright/test';
import { openGrid, sent, inject, sampleDatasets } from './harness';

/**
 * UX-3 L2 repro + regression: grid editing must not double-submit DML and FK
 * navigation must not double-fire a follow-up query on a double-click.
 */

// UXD-003 — Commit must not double-submit on a double-click (double DML)
test('UXD-003: double-clicking Commit posts only one commitEdits', async ({ page }) => {
  await openGrid(page);
  await page.locator('#btn-edit').click(); // enter edit mode
  await page.locator('td[data-r="0"][data-c="1"]').dblclick(); // edit name (non-PK, non-PII)
  const input = page.locator('td.editing input');
  await input.fill('Ana2');
  await input.press('Enter');
  await expect(page.locator('#btn-commit')).toBeVisible();
  await page.locator('#btn-commit').dblclick();
  const commits = (await sent(page)).filter((m) => m.type === 'commitEdits');
  expect(commits.length).toBe(1); // exactly one DML round-trip, not two
});

// UXD-030 — FK navigation must not double-fire on a double Alt+click
test('UXD-030: double Alt+click on an FK cell fires only one fkNavigate', async ({ page }) => {
  await openGrid(page);
  await inject(page, {
    type: 'setData', datasets: sampleDatasets(),
    fkColumns: [{ columnIndex: 1, refSchema: 'public', refTable: 'ref', refColumn: 'id' }],
  });
  await page.locator('td[data-r="0"][data-c="1"]').dblclick({ modifiers: ['Alt'] });
  const fks = (await sent(page)).filter((m) => m.type === 'fkNavigate');
  expect(fks.length).toBe(1); // one follow-up query, not two
});
