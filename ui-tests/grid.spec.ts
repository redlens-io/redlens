import { test, expect } from '@playwright/test';
import { openGrid, sent, inject, sampleDatasets } from './harness';

/**
 * UX-0 grid interaction specs. These assert the invariants that map to Diego's
 * report (overlays that must close, one exclusive view at a time, focus/typing,
 * heatmap-as-overlay) against the REAL page + bundle. They also prove the
 * harness works. Failing specs found here graduate to the UX-DEFECTS registry.
 */

test('renders the toolbar and rows from injected data', async ({ page }) => {
  await openGrid(page);
  await expect(page.locator('.toolbar')).toBeVisible();
  await expect(page.locator('tbody tr')).toHaveCount(4);
});

test('value viewer overlay opens on dbl-click and closes via ✕', async ({ page }) => {
  await openGrid(page);
  await page.locator('td[data-r="0"][data-c="1"]').dblclick(); // name cell (not PII)
  await expect(page.locator('#viewer')).toBeVisible();
  await page.locator('#vclose').click();
  await expect(page.locator('#viewer')).toBeHidden();
});

test('export menu opens and a format choice closes it + posts saveFile', async ({ page }) => {
  await openGrid(page);
  await page.locator('#btn-export').click();
  await expect(page.locator('#menu')).toBeVisible();
  await page.locator('.mi[data-f="csv"]').click();
  await expect(page.locator('#menu')).toBeHidden();
  expect((await sent(page)).some((m) => m.type === 'saveFile')).toBe(true);
});

test('mode exclusivity among derived views: transpose → group leaves only one', async ({ page }) => {
  await openGrid(page);
  // Transpose → transposed table shown.
  await page.locator('#btn-transpose').click();
  await expect(page.getByText(/Transposed/)).toBeVisible();
  // Group → transpose gone, grouped shown (both controls exist in these modes).
  await page.locator('#group-sel').selectOption('4'); // city
  await expect(page.getByText(/Transposed/)).toHaveCount(0);
  await expect(page.getByText(/Grouped by/)).toBeVisible();
  expect(await page.locator('#btn-transpose').getAttribute('class')).not.toContain('on');
});

test('chart is exclusive: entering it hides the table-view controls; leaving restores them', async ({ page }) => {
  await openGrid(page);
  await expect(page.locator('#btn-transpose')).toBeVisible();
  await page.locator('#btn-chart').click();
  await expect(page.locator('.chartbar')).toBeVisible();
  // Table-view controls are not shown while charting (chart owns the view).
  await expect(page.locator('#btn-transpose')).toHaveCount(0);
  await expect(page.locator('#group-sel')).toHaveCount(0);
  // Re-clicking chart returns to the table and restores the controls.
  await page.locator('#btn-chart').click();
  await expect(page.locator('.chartbar')).toHaveCount(0);
  await expect(page.locator('#btn-transpose')).toBeVisible();
});

test('heatmap is an overlay: it survives a mode switch', async ({ page }) => {
  await openGrid(page);
  await page.locator('#btn-heat').click();
  await expect(page.locator('#btn-heat')).toHaveClass(/on/);
  // Switch to transpose and back — heatmap stays on.
  await page.locator('#btn-transpose').click();
  await page.locator('#btn-transpose').click();
  await expect(page.locator('#btn-heat')).toHaveClass(/on/);
});

test('search input keeps focus while typing (re-render must not steal it)', async ({ page }) => {
  await openGrid(page);
  const search = page.locator('#search');
  await search.click();
  await search.type('Den', { delay: 20 });
  await expect(search).toBeFocused();
  await expect(search).toHaveValue('Den');
  // Filter applied: only Denver rows remain (Cyn, Dan).
  await expect(page.locator('tbody tr')).toHaveCount(2);
});

test('column filter input keeps focus while typing', async ({ page }) => {
  await openGrid(page);
  const f = page.locator('.colfilter[data-col="4"]'); // city
  await f.click();
  await f.type('Aus', { delay: 20 });
  await expect(f).toBeFocused();
  await expect(page.locator('tbody tr')).toHaveCount(2); // Austin rows
});

test('PII column is masked and the aggregate bar never sees the raw value', async ({ page }) => {
  await openGrid(page);
  // email (col 2) is masked.
  await expect(page.locator('td[data-c="2"]').first()).not.toContainText('@x.com');
  // Selecting a masked cell must not leak it via the aggregate bar.
  await page.locator('td[data-r="0"][data-c="2"]').click();
  await expect(page.locator('#aggbar')).not.toContainText('@x.com');
});

test('new data resets all modes (no residual chart from a previous result)', async ({ page }) => {
  await openGrid(page);
  await page.locator('#btn-chart').click();
  await expect(page.locator('.chartbar')).toBeVisible();
  await inject(page, { type: 'setData', datasets: sampleDatasets(), fkColumns: [] });
  await expect(page.locator('.chartbar')).toHaveCount(0);
  await expect(page.locator('table thead')).toBeVisible();
});
