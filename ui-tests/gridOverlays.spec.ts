import { test, expect } from '@playwright/test';
import { openGrid, sent, inject, twoDatasets, sampleDatasets } from './harness';

/**
 * UX-3 L1 repro + regression specs: grid overlays (export/copy menu, value
 * viewer) must dismiss like real menus, PII reveal must not cross tabs, and a
 * stale positional selection must not survive a sort/filter. Each maps to a UXD.
 */

// UXD-005 / UXD-032 — export/copy menu dismissal
test('UXD-005: export menu closes on Escape', async ({ page }) => {
  await openGrid(page);
  await page.locator('#btn-export').click();
  await expect(page.locator('#menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#menu')).toBeHidden();
});

test('UXD-005: export menu closes when clicking outside it', async ({ page }) => {
  await openGrid(page);
  await page.locator('#btn-export').click();
  await expect(page.locator('#menu')).toBeVisible();
  // Click the toolbar meta text — in the toolbar, clear of the dropdown (which
  // is anchored BELOW the toolbar), so it is a genuine outside click.
  await page.locator('.meta').click();
  await expect(page.locator('#menu')).toBeHidden();
});

test('UXD-005: re-clicking the trigger toggles the menu closed', async ({ page }) => {
  await openGrid(page);
  await page.locator('#btn-export').click();
  await expect(page.locator('#menu')).toBeVisible();
  await page.locator('#btn-export').click();
  await expect(page.locator('#menu')).toBeHidden();
});

// UXD-006 — value viewer dismissal
test('UXD-006: value viewer closes on Escape', async ({ page }) => {
  await openGrid(page);
  await page.locator('td[data-r="0"][data-c="1"]').dblclick();
  await expect(page.locator('#viewer')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#viewer')).toBeHidden();
});

test('UXD-006: value viewer closes when clicking outside it', async ({ page }) => {
  await openGrid(page);
  await page.locator('td[data-r="0"][data-c="1"]').dblclick();
  await expect(page.locator('#viewer')).toBeVisible();
  await page.locator('#search').click(); // click elsewhere
  await expect(page.locator('#viewer')).toBeHidden();
});

// UXD-004 — revealPii must reset on tab switch
test('UXD-004: revealed PII re-masks when switching result tabs', async ({ page }) => {
  await openGrid(page, twoDatasets());
  await page.locator('#btn-pii').click(); // reveal PII on Result 1
  await expect(page.locator('td[data-c="2"]').first()).toContainText('@x.com');
  await page.locator('.tab', { hasText: 'Result 2' }).click();
  // Result 2's PII must be masked again — reveal must not persist across tabs.
  await expect(page.locator('#btn-pii')).not.toHaveClass(/on/);
  await expect(page.locator('td[data-c="2"]').first()).not.toContainText('@x.com');
});

// UXD-008 — sort/filter must clear the positional selection
test('UXD-008: sorting clears the positional cell selection (no stale aggbar)', async ({ page }) => {
  await openGrid(page);
  await page.locator('td[data-r="0"][data-c="3"]').click(); // select an amount cell
  await expect(page.locator('#aggbar')).toContainText('count 1');
  await page.locator('th[data-col="3"] .hname').click(); // sort by amount
  await expect(page.locator('#aggbar')).toHaveText(''); // selection cleared
});

test('UXD-008: applying a column filter clears the selection', async ({ page }) => {
  await openGrid(page);
  await page.locator('td[data-r="0"][data-c="3"]').click();
  await expect(page.locator('#aggbar')).toContainText('count 1');
  await page.locator('.colfilter[data-col="4"]').fill('Austin');
  await expect(page.locator('#aggbar')).toHaveText('');
});

// UXD-031 — toggling PII-safe re-masks the already-open grid (updatePii contract)
test('UXD-031: PII-safe toggle re-masks the open grid live', async ({ page }) => {
  const ds = sampleDatasets();
  (ds[0] as { piiColumns: number[] }).piiColumns = []; // PII-safe was OFF: email raw
  await openGrid(page, ds);
  await expect(page.locator('td[data-c="2"]').first()).toContainText('@x.com');
  await inject(page, { type: 'updatePii', piiPerSet: [[2]] }); // host toggled PII-safe ON
  await expect(page.locator('td[data-c="2"]').first()).not.toContainText('@x.com');
});
