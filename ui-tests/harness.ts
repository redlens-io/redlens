/**
 * UI-interaction harness (Fase UX-QA, UX-0). Renders the REAL webview pages in
 * headless Chromium and drives them with real clicks/typing/keys — the piece
 * the vitest+itest+shots gate never had. The page HTML comes from the same pure
 * generators the extension host uses (gridHtml / queryBuilderHtml), and the
 * grid bundle is the same dist/webview/grid.js the extension ships.
 *
 * `acquireVsCodeApi` is stubbed by a prelude: outgoing postMessage calls are
 * captured on window.__sent; the host is simulated by window.__inject(msg),
 * which dispatches a 'message' event exactly like VS Code would.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Page } from '@playwright/test';
import { gridHtml, getNonce } from '../src/ui/gridHtml';
import { queryBuilderHtml, type TableRef } from '../src/query/queryBuilderHtml';
import { buildSelectSql } from '../src/query/queryBuilder';

// Repo is CommonJS (no "type":"module"), so __dirname is available and
// import.meta is not — Playwright bundles these test files as CJS too.
const REPO = path.resolve(__dirname, '..');
const GRID_BUNDLE = path.join(REPO, 'dist', 'webview', 'grid.js');

/** Prelude injected before the page script: stubs acquireVsCodeApi so tests can
 * read what the webview posted and inject what the host would send back. */
const VSCODE_STUB = `
  window.__sent = [];
  window.acquireVsCodeApi = function () {
    return { postMessage: function (m) { window.__sent.push(m); }, getState: function(){}, setState: function(){} };
  };
  window.__inject = function (m) { window.dispatchEvent(new MessageEvent('message', { data: m })); };
  window.__lastSent = function (type) {
    for (var i = window.__sent.length - 1; i >= 0; i--) { if (!type || window.__sent[i].type === type) return window.__sent[i]; }
    return undefined;
  };
`;

/** A minimal editable, PII-flagged, multi-column fixture dataset. */
export function sampleDatasets(): unknown[] {
  return [{
    columns: [
      { name: 'id', typeName: 'int4' },
      { name: 'name', typeName: 'varchar' },
      { name: 'email', typeName: 'varchar' },
      { name: 'amount', typeName: 'numeric' },
      { name: 'city', typeName: 'varchar' },
    ],
    rows: [
      [1, 'Ana', 'ana@x.com', 120.5, 'Austin'],
      [2, 'Beto', 'beto@x.com', 80, 'Austin'],
      [3, 'Cyn', 'cyn@x.com', 200, 'Denver'],
      [4, 'Dan', 'dan@x.com', 50, 'Denver'],
    ],
    connectionName: 'Demo',
    durationMs: 3,
    totalRows: 4,
    truncated: false,
    command: 'SELECT',
    editable: { schema: 'public', table: 'people', pkColumns: ['id'] },
    piiColumns: [2],
  }];
}

/** Two result sets, both with a PII column — for tab-switch / residual-state tests. */
export function twoDatasets(): unknown[] {
  const one = sampleDatasets()[0] as Record<string, unknown>;
  const two = {
    ...one,
    setLabel: 'Result 2',
    rows: [[10, 'Zoe', 'zoe@x.com', 5, 'Reno'], [11, 'Ivan', 'ivan@x.com', 9, 'Reno']],
  };
  return [{ ...one, setLabel: 'Result 1' }, two];
}

/** Load the grid page, inject the given datasets, and wait for first render. */
export async function openGrid(page: Page, datasets: unknown[] = sampleDatasets(), theme: 'light' | 'dark' = 'dark'): Promise<void> {
  const bundle = fs.readFileSync(GRID_BUNDLE, 'utf8');
  const nonce = getNonce();
  const html = gridHtml({ inlineScript: bundle, nonce, prelude: VSCODE_STUB });
  await page.emulateMedia({ colorScheme: theme });
  await page.setContent(html, { waitUntil: 'load' });
  // The bundle posts {type:'ready'} on load; simulate the host answering setData.
  await page.waitForFunction(() => Array.isArray((window as unknown as { __sent: unknown[] }).__sent));
  await page.evaluate((d) => (window as unknown as { __inject: (m: unknown) => void }).__inject({ type: 'setData', datasets: d, fkColumns: [] }), datasets);
  await page.waitForSelector('.toolbar');
}

/** Load the query-builder page (self-contained inline script). */
export async function openQueryBuilder(page: Page, tables: TableRef[], columns: string[]): Promise<void> {
  const nonce = getNonce();
  const initialSql = buildSelectSql({ schema: tables[0]!.schema, table: tables[0]!.table, limit: 100 });
  const html = queryBuilderHtml({ tables, columns, initialSql, nonce, prelude: VSCODE_STUB });
  await page.setContent(html, { waitUntil: 'load' });
  await page.waitForSelector('#sql');
}

/** Messages the webview posted to the host, in order. */
export async function sent(page: Page): Promise<Array<{ type: string } & Record<string, unknown>>> {
  return page.evaluate(() => (window as unknown as { __sent: Array<{ type: string }> }).__sent) as Promise<Array<{ type: string } & Record<string, unknown>>>;
}

/** Simulate a host→webview message. */
export async function inject(page: Page, msg: unknown): Promise<void> {
  await page.evaluate((m) => (window as unknown as { __inject: (x: unknown) => void }).__inject(m), msg);
}
