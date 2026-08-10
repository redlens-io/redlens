/**
 * RedLens interactive results grid (M1 + M4 edit) — webview frontend. Vanilla
 * TS, no framework, bundled by esbuild to dist/webview/grid.js. Reuses the
 * tested pure logic (gridModel/aggregate/exporters/cellViewer/editModel). Talks
 * to the extension host over postMessage for file save, clipboard, FK
 * navigation and committing edits.
 */
import { applyView, visibleColumnOrder, cellText, emptyViewState, type GridViewState, type GridColumn } from '../../src/grid/gridModel';
import { aggregate } from '../../src/grid/aggregate';
import { exportResult, type ExportFormat } from '../../src/grid/exporters';
import { viewCell } from '../../src/grid/cellViewer';
import {
  emptyEditState, pkOf, rowKey, coerceEdit, recordUpdate, toggleDelete, addInsert, removeInsert,
  editCount, toChangeSet, type EditState, type EditableSource,
} from '../../src/edit/editModel';
import { parseClipboardRows } from '../../src/edit/clipboardRows';
import { MASK_TOKEN } from '../../src/pii/piiMask';
import { suggestChartSpec, numericColumns, buildChartModel, type ChartSpec, type ChartType, type ChartModel } from '../../src/grid/chartData';
import { transpose, groupRows, columnRange, heatIntensity, type DerivedResult, type Range } from '../../src/grid/gridViews';
import { compareResults, type ResultSnapshot } from '../../src/grid/compareResults';
import { virtualWindow } from '../../src/grid/virtualWindow';
import {
  initialModes, toggleEdit as machineToggleEdit, setEdit as machineSetEdit,
  toggleChart as machineToggleChart, toggleTranspose as machineToggleTranspose,
  setGroup as machineSetGroup, toggleCompare as machineToggleCompare,
  toggleHeatmap as machineToggleHeatmap, selectionCleared, type ModeState,
} from '../../src/grid/modeMachine';

interface Dataset {
  columns: GridColumn[];
  rows: unknown[][];
  connectionName: string;
  durationMs: number;
  totalRows: number;
  truncated: boolean;
  command: string;
  setLabel?: string;
  editable?: EditableSource;
  piiColumns?: number[];
}
interface FkColumn { columnIndex: number; refSchema: string; refTable: string; refColumn: string; }

interface VsCodeApi { postMessage(msg: unknown): void; }
declare function acquireVsCodeApi(): VsCodeApi;
const vscode = acquireVsCodeApi();

let datasets: Dataset[] = [];
let fkColumns: FkColumn[] = [];
let activeSet = 0;
let view: GridViewState = emptyViewState();
const selected = new Set<string>();
// View-mode state lives in the mode machine (src/grid/modeMachine.ts — the
// single authority for exclusivity). The flags below are DERIVED read-only
// mirrors kept in sync by applyModes(); never assign them directly.
let modes: ModeState = initialModes();
let editMode = false;
let chartMode = false;
let heatmapOn = false;
let transposeOn = false;
let groupByCol: number | undefined;
let compareMode = false;
let edit: EditState = emptyEditState();
let revealPii = false;
let chartSpec: ChartSpec | undefined;
let committing = false; // in-flight guard: prevents a double-click double-commit (double DML)
let lastFkNav = 0; // debounce: a double Alt+click must not fire two follow-up queries (UXD-030)
let baseline: ResultSnapshot | undefined; // result-run-compare (persists across queries)

/** Route every mode transition through the machine; clears the selection when
 * the exclusive view changes (stale selections are meaningless across views
 * and would leak PII through the aggregate bar). */
function applyModes(next: ModeState): void {
  if (selectionCleared(modes, next)) { selected.clear(); }
  modes = next;
  editMode = next.mode === 'edit';
  chartMode = next.mode === 'chart';
  transposeOn = next.mode === 'transpose';
  groupByCol = next.groupBy;
  compareMode = next.mode === 'compare';
  heatmapOn = next.heatmap;
}
// virtualized-grid: render a window of rows for large results.
const VIRT_THRESHOLD = 200;
const RENDER_COUNT = 220; // >= visible rows + 2*OVERSCAN, covers tall viewports
const OVERSCAN = 30;
const ROW_H = 24; // estimated row height (px); slightly over-estimated on purpose
let winStart = 0;
let virtualized = false;
let savedScroll = 0;
let rafPending = false;
let lastRowCount = 0; // rowIdx length from the last render (avoids re-running applyView on scroll)

window.addEventListener('message', (ev) => {
  const msg = ev.data as { type: string } & Record<string, unknown>;
  if (msg.type === 'setData') {
    datasets = (msg.datasets as Dataset[]) ?? [];
    fkColumns = (msg.fkColumns as FkColumn[]) ?? [];
    activeSet = 0;
    view = emptyViewState();
    selected.clear();
    applyModes(initialModes());
    edit = emptyEditState();
    revealPii = false;
    chartSpec = undefined; // keep `baseline` — the point is to compare a later run
    committing = false; // a fresh result set means the prior commit finished
    winStart = 0;
    render();
  } else if (msg.type === 'setEditMode') {
    if (editableSource() !== undefined) { applyModes(machineSetEdit(modes, Boolean(msg.on))); render(); }
  } else if (msg.type === 'toggleEditMode') {
    if (editableSource() !== undefined) { applyModes(machineToggleEdit(modes)); render(); }
  } else if (msg.type === 'toggleChart') {
    toggleChart();
  } else if (msg.type === 'toggleHeatmap') {
    applyModes(machineToggleHeatmap(modes)); render();
  } else if (msg.type === 'toggleTranspose') {
    applyModes(machineToggleTranspose(modes)); render();
  } else if (msg.type === 'setGroup') {
    const col = Number(msg.column);
    const d = data();
    if (d !== undefined && col >= 0 && col < d.columns.length) {
      applyModes(machineSetGroup(modes, col)); render();
    }
  } else if (msg.type === 'pinBaseline') {
    pinBaseline();
  } else if (msg.type === 'toggleCompare') {
    toggleCompare();
  } else if (msg.type === 'pasteRows') {
    if (editableSource() !== undefined) {
      applyModes(machineSetEdit(modes, true));
      addRowsFromText(String(msg.text ?? ''));
      render();
    }
  } else if (msg.type === 'updatePii') {
    // pii-safe-mode toggled while a grid is open (UXD-031): re-mask live without
    // resetting the user's view. Force reveal off so turning masking ON actually masks.
    const per = (msg.piiPerSet as number[][]) ?? [];
    datasets = datasets.map((d, i) => ({ ...d, piiColumns: per[i] ?? d.piiColumns }));
    revealPii = false;
    render();
  }
});

/** result-run-compare: snapshot the current result (PII-masked) as the baseline. */
function pinBaseline(): void {
  const d = data();
  if (d === undefined) { return; }
  // Force-mask: the baseline persists and Reveal auto-resets, so it must never
  // hold cleartext PII (which the diff would otherwise disclose).
  baseline = { columns: d.columns.map((c) => ({ name: c.name })), rows: forcedMaskRows() };
  vscode.postMessage({ type: 'info', text: `RedLens: pinned ${baseline.rows.length.toLocaleString()} rows as the compare baseline. Run another query, then Compare.` });
  render();
}

function toggleCompare(): void {
  if (baseline === undefined) {
    vscode.postMessage({ type: 'info', text: 'RedLens: pin a baseline first (📌 Baseline), then run another query and Compare.' });
    return;
  }
  applyModes(machineToggleCompare(modes));
  render();
}

/** paste-csv-grid: parse TSV/CSV text and append it as new insert rows. */
function addRowsFromText(text: string): void {
  const parsed = parseClipboardRows(text);
  const d = data();
  if (parsed.length === 0 || d === undefined) { return; }
  const names = d.columns.map((c) => c.name);
  for (const cells of parsed) {
    const idx = addInsert(edit, names);
    const rowObj = edit.inserts[idx]!;
    for (let i = 0; i < cells.length && i < names.length; i++) {
      const raw = cells[i]!;
      rowObj[names[i]!] = raw === '' ? null : coerceEdit(raw, d.rows[0]?.[i] ?? '');
    }
  }
}

function data(): Dataset | undefined { return datasets[activeSet]; }
function isFk(c: number): FkColumn | undefined { return fkColumns.find((f) => f.columnIndex === c); }
function hasNumeric(): boolean {
  const d = data();
  return d !== undefined && numericColumns(d.columns, d.rows).length > 0;
}
function toggleChart(): void {
  const d = data();
  if (d === undefined || !hasNumeric()) {
    if (!chartMode) { vscode.postMessage({ type: 'info', text: 'RedLens: this result has no numeric columns to chart.' }); }
    return;
  }
  applyModes(machineToggleChart(modes));
  if (chartMode && chartSpec === undefined) { chartSpec = suggestChartSpec(d.columns, d.rows); }
  render();
}

/** Source rows with PII masked (webview holds raw data; masking is display-only,
 * so derived views/exports must re-apply it). Honors the Reveal PII toggle. */
function maskedSourceRows(): unknown[][] {
  const d = data()!;
  const pii = d.piiColumns ?? [];
  if (pii.length === 0 || revealPii) { return d.rows; }
  const set = new Set(pii);
  return d.rows.map((row) => row.map((v, i) => (set.has(i) ? MASK_TOKEN : v)));
}

/** Source rows with PII ALWAYS masked, ignoring the Reveal toggle — for the
 * persistent compare baseline (Reveal auto-resets, so a snapshot must never
 * store cleartext PII) and the diff it is compared against. */
function forcedMaskRows(): unknown[][] {
  const d = data()!;
  const pii = d.piiColumns ?? [];
  if (pii.length === 0) { return d.rows; }
  const set = new Set(pii);
  return d.rows.map((row) => row.map((v, i) => (set.has(i) ? MASK_TOKEN : v)));
}

/** transpose-view / grouping-panel produce a derived, read-only result. */
function activeDerived(): DerivedResult | undefined {
  const d = data();
  if (d === undefined) { return undefined; }
  if (groupByCol !== undefined) { return groupRows(d.columns, maskedSourceRows(), groupByCol); }
  if (transposeOn) { return transpose(d.columns, maskedSourceRows()); }
  return undefined;
}

/** grid-heatmap: numeric-column ranges for the given result. */
function heatRanges(columns: { name: string; typeName: string }[], rows: unknown[][]): Map<number, Range> {
  const ranges = new Map<number, Range>();
  if (!heatmapOn) { return ranges; }
  for (const c of numericColumns(columns, rows)) {
    const r = columnRange(rows, c);
    if (r !== undefined) { ranges.set(c, r); }
  }
  return ranges;
}

function heatStyle(colIndex: number, value: unknown, ranges: Map<number, Range>): string {
  const r = ranges.get(colIndex);
  if (r === undefined) { return ''; }
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) { return ''; }
  const alpha = (0.08 + 0.55 * heatIntensity(n, r)).toFixed(2);
  return `background:rgba(230,126,40,${alpha})`;
}
function editableSource(): EditableSource | undefined { return data()?.editable; }
function colNames(): string[] { return data()?.columns.map((c) => c.name) ?? []; }
function isPkCol(c: number): boolean {
  const src = editableSource();
  const name = data()?.columns[c]?.name;
  return src !== undefined && name !== undefined && src.pkColumns.includes(name);
}
function isPiiCol(c: number): boolean { return (data()?.piiColumns ?? []).includes(c); }
/** A PII column is masked unless the user has revealed it. */
function isMasked(c: number): boolean { return isPiiCol(c) && !revealPii; }

function esc(s: string): string {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

/** Re-focus a text input after render() rebuilt the DOM, restoring the caret to
 * where it was. Without the caret restore the caret jumps to position 0 and each
 * new character is inserted at the start (typing "Den" produced "neD"). */
function refocus(el: HTMLInputElement | null, caret: number | null): void {
  if (el === null) { return; }
  el.focus();
  if (caret !== null) {
    try { el.setSelectionRange(caret, caret); } catch { /* non-text input */ }
  }
}

function currentRowsForExport(): { columns: GridColumn[]; rows: unknown[][] } {
  const d = data();
  if (d === undefined) return { columns: [], rows: [] };
  // Export the derived (grouped/transposed) view when one is active — its rows
  // are already PII-masked at the source.
  const derived = activeDerived();
  if (derived !== undefined) {
    return { columns: derived.columns as GridColumn[], rows: derived.rows };
  }
  const order = visibleColumnOrder(d.columns.length, view);
  const rowIdx = applyView(d.rows, view);
  // pii-safe-mode: exports carry the masked value too, unless PII is revealed.
  const cell = (r: number, c: number): unknown => (isMasked(c) ? MASK_TOKEN : d.rows[r]![c]);
  return { columns: order.map((c) => d.columns[c]!), rows: rowIdx.map((r) => order.map((c) => cell(r, c))) };
}

/** Value to show for an existing-row cell, honoring any pending edit. */
function displayValue(r: number, c: number): unknown {
  const d = data()!;
  if (isMasked(c)) return MASK_TOKEN;
  const src = editableSource();
  if (editMode && src !== undefined) {
    const pk = pkOf(colNames(), d.rows[r]!, src.pkColumns);
    const pending = edit.updates[rowKey(pk)]?.changes;
    const name = d.columns[c]!.name;
    if (pending !== undefined && Object.prototype.hasOwnProperty.call(pending, name)) {
      return pending[name];
    }
  }
  return d.rows[r]![c];
}

function render(): void {
  const app = document.getElementById('app')!;
  const d = data();
  if (d === undefined) { app.innerHTML = '<p>No data.</p>'; return; }
  const order = visibleColumnOrder(d.columns.length, view);
  const rowIdx = applyView(d.rows, view);
  lastRowCount = rowIdx.length;
  const src = editableSource();

  const notices: string[] = [];
  if (d.totalRows > d.rows.length) notices.push(`showing ${d.rows.length.toLocaleString()} of ${d.totalRows.toLocaleString()} rows`);
  if (d.truncated) notices.push('truncated at 50,000 rows');
  if (rowIdx.length !== d.rows.length) notices.push(`${rowIdx.length.toLocaleString()} match filters`);

  const tabs = datasets.length > 1
    ? `<div class="tabs">${datasets.map((s, i) => `<div class="tab${i === activeSet ? ' active' : ''}" data-set="${i}">${esc(s.setLabel ?? `Result ${i + 1}`)}</div>`).join('')}</div>`
    : '';

  const actHead = editMode ? '<th class="rowact" title="delete/undo"></th>' : '';
  const header = order.map((c) => {
    const col = d.columns[c]!;
    const arrow = view.sort?.columnIndex === c ? (view.sort.direction === 'asc' ? ' ▲' : ' ▼') : '';
    const fk = isFk(c) ? '<span class="fkcol" title="foreign key — Alt+click a cell to open the referenced row"> ⇢FK</span>' : '';
    const pk = editMode && isPkCol(c) ? '<span class="fkcol" title="primary key (identifies the row; not editable)"> PK</span>' : '';
    const pii = isPiiCol(c) ? `<span class="fkcol" title="PII — masked in the grid, exports and MCP"> ${revealPii ? '👁 PII' : '🔒 PII'}</span>` : '';
    return `<th data-col="${c}" title="${esc(col.typeName)}"><span class="hname">${esc(col.name)}${arrow}</span>${fk}${pk}${pii}<span class="hide" data-hide="${c}" title="Hide column">✕</span></th>`;
  }).join('');
  const filterRow = order.map((c) => {
    const f = view.filters.find((x) => x.columnIndex === c)?.text ?? '';
    return `<th><input class="colfilter" data-col="${c}" value="${esc(f)}" placeholder="filter"/></th>`;
  }).join('');
  const filterActCell = editMode ? '<th></th>' : '';
  const hmRanges = heatmapOn ? heatRanges(d.columns, maskedSourceRows()) : new Map<number, Range>();
  const derived = activeDerived();

  const rowHtml = (vi: number): string => {
    const r = rowIdx[vi]!;
    const rowPk = src !== undefined ? pkOf(colNames(), d.rows[r]!, src.pkColumns) : undefined;
    const deleted = rowPk !== undefined && edit.deletes[rowKey(rowPk)] !== undefined;
    const act = editMode ? `<td class="rowact" data-del="${vi}" title="${deleted ? 'undo delete' : 'delete row'}">${deleted ? '⟲' : '✕'}</td>` : '';
    const cells = order.map((c) => {
      const val = displayValue(r, c);
      const isNull = val === null || val === undefined;
      const key = `${vi}:${c}`;
      const masked = isMasked(c);
      const editableCell = editMode && src !== undefined && !isPkCol(c) && !deleted && !masked;
      const editedHere = isCellEdited(r, c);
      const cls = [isNull ? 'null' : '', selected.has(key) ? 'sel' : '', isFk(c) ? 'fk' : '',
        editableCell ? 'editable' : '', editedHere ? 'edited' : '', masked ? 'masked' : ''].filter(Boolean).join(' ');
      const title = editableCell ? 'double-click to edit' : 'double-click to view';
      const hs = heatmapOn && !masked ? heatStyle(c, val, hmRanges) : '';
      return `<td class="${cls}" data-r="${vi}" data-c="${c}" title="${title}"${hs ? ` style="${hs}"` : ''}>${esc(cellText(val))}</td>`;
    }).join('');
    return `<tr class="${deleted ? 'deleted' : ''}">${act}${cells}</tr>`;
  };

  // virtualized-grid: for large results render only a window of rows + spacers.
  virtualized = derived === undefined && !chartMode && !compareMode && !editMode && rowIdx.length > VIRT_THRESHOLD;
  let body: string;
  if (virtualized) {
    if (winStart > rowIdx.length - 1) { winStart = 0; }
    const winEnd = Math.min(rowIdx.length, winStart + RENDER_COUNT);
    const span = order.length;
    const spacer = (h: number): string => (h > 0 ? `<tr class="vspacer"><td colspan="${span}" style="height:${h}px;padding:0;border:0"></td></tr>` : '');
    const rows: string[] = [];
    for (let vi = winStart; vi < winEnd; vi++) { rows.push(rowHtml(vi)); }
    body = spacer(winStart * ROW_H) + rows.join('') + spacer((rowIdx.length - winEnd) * ROW_H);
  } else {
    body = rowIdx.map((_, vi) => rowHtml(vi)).join('');
  }

  const insertBody = editMode && src !== undefined ? edit.inserts.map((row, ii) => {
    const act = `<td class="rowact" data-insdel="${ii}" title="remove new row">✕</td>`;
    const cells = order.map((c) => {
      const name = d.columns[c]!.name;
      const val = row[name];
      const isNull = val === null || val === undefined || val === '';
      return `<td class="editable ${isNull ? 'null' : ''}" data-ins="${ii}" data-c="${c}" title="double-click to edit">${esc(isNull ? '' : cellText(val))}</td>`;
    }).join('');
    return `<tr class="insert">${act}${cells}</tr>`;
  }).join('') : '';

  const fkHint = fkColumns.length > 0 ? '<div class="hint">FK columns (marked ⇢FK) are foreign keys — Alt+click a cell to open the referenced row.</div>' : '';
  const editHint = editMode && !chartMode && !transposeOn && groupByCol === undefined
    ? '<div class="hint">Editing — double-click a cell to change it, ✕ to delete a row, “+ Add row” for a new one. PK columns identify rows and are locked. Nothing touches the database until you press Commit.</div>'
    : '';

  const editBtns = derived === undefined && !compareMode && src !== undefined
    ? `<button id="btn-edit" class="${editMode ? 'on' : ''}" title="Toggle inline editing">${editMode ? '✓ Editing' : '✎ Edit'}</button>`
      + (editMode ? `<button id="btn-add">+ Add row</button><button id="btn-commit" class="commit"${committing ? ' disabled' : ''}>${committing ? 'Committing…' : `Commit ${editCount(edit)}`}</button><button id="btn-discard"${committing ? ' disabled' : ''}>Discard</button>` : '')
    : '';
  const piiBtn = (d.piiColumns ?? []).length > 0
    ? `<button id="btn-pii" class="${revealPii ? 'on' : ''}" title="Reveal or hide masked PII columns (this view only)">${revealPii ? '🔒 Hide PII' : '👁 Reveal PII'}</button>`
    : '';
  const chartBtn = derived === undefined && !compareMode && hasNumeric()
    ? `<button id="btn-chart" class="${chartMode ? 'on' : ''}" title="Chart this result set">${chartMode ? '▦ Table' : '📊 Chart'}</button>`
    : '';
  const heatBtn = (hasNumeric() || groupByCol !== undefined) && !chartMode && !compareMode
    ? `<button id="btn-heat" class="${heatmapOn ? 'on' : ''}" title="Color numeric cells by value">🔥 Heatmap</button>`
    : '';
  const transBtn = !chartMode && !compareMode
    ? `<button id="btn-transpose" class="${transposeOn ? 'on' : ''}" title="Swap rows and columns">⇄ Transpose</button>`
    : '';
  const groupSel = !chartMode && !compareMode
    ? `<label class="grouplbl">Group by <select id="group-sel"><option value="">(none)</option>${d.columns.map((c, i) => `<option value="${i}"${groupByCol === i ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>`
    : '';
  const compareBtns = derived === undefined && !chartMode
    ? `<button id="btn-pin" title="Pin this result as a comparison baseline">📌 Baseline</button>`
      + (baseline !== undefined ? `<button id="btn-compare" class="${compareMode ? 'on' : ''}" title="Compare current result with the pinned baseline">${compareMode ? '▦ Table' : 'Δ Compare'}</button>` : '')
    : '';

  app.innerHTML = `${tabs}
    <div class="toolbar">
      <input id="search" placeholder="Search all columns…" value="${esc(view.search)}"/>
      <button id="btn-export">Export ▾</button>
      <button id="btn-copy">Copy ▾</button>
      ${view.hidden.length > 0 ? `<button id="btn-cols" title="Show the ${view.hidden.length} hidden column(s)">Show all columns</button>` : ''}
      ${editBtns}${piiBtn}${chartBtn}${heatBtn}${transBtn}${groupSel}${compareBtns}
      <span class="meta">${esc(d.connectionName)} · ${d.rows.length.toLocaleString()} rows · ${d.durationMs.toLocaleString()} ms ${notices.length ? '· ' + notices.map(esc).join(' · ') : ''}</span>
    </div>${fkHint}${editHint}
    <div id="menu" class="menu hidden"></div>
    ${compareMode
      ? renderCompare()
      : derived !== undefined
        ? renderDerivedTable(derived)
        : chartMode
          ? renderChart()
          : `<div class="gridwrap"><table><thead><tr>${actHead}${header}</tr><tr class="filters">${filterActCell}${filterRow}</tr></thead><tbody>${body}${insertBody}</tbody></table></div>`}
    <div id="aggbar" class="aggbar"></div>
    <div id="viewer" class="viewer hidden"></div>`;

  wire();
  renderAgg();
}

/** result-run-compare: diff the pinned baseline vs the current result. */
function renderCompare(): string {
  const d = data()!;
  const base = baseline;
  if (base === undefined) { return '<div class="hint">No baseline pinned.</div>'; }
  const src = editableSource();
  const keyCols = src !== undefined
    ? src.pkColumns.map((n) => d.columns.findIndex((c) => c.name === n)).filter((i) => i >= 0)
    : undefined;
  const cur: ResultSnapshot = { columns: d.columns.map((c) => ({ name: c.name })), rows: forcedMaskRows() };
  // Align the baseline to the CURRENT column order by NAME so the positional
  // diff (and the current-indexed key columns) are correct even if the baseline
  // query had a different column order/shape. Columns absent in the baseline
  // become null (shown as a difference, honestly).
  const colMap = cur.columns.map((c) => base.columns.findIndex((b) => b.name === c.name));
  const sameShape = colMap.every((bi, i) => bi === i) && base.columns.length === cur.columns.length;
  const alignedBase: ResultSnapshot = sameShape
    ? base
    : { columns: cur.columns, rows: base.rows.map((r) => colMap.map((bi) => (bi >= 0 ? r[bi] : null))) };
  const missing = colMap.filter((bi) => bi < 0).length;
  const cmp = compareResults(alignedBase, cur, keyCols && keyCols.length > 0 ? keyCols : undefined);
  const sym: Record<string, string> = { added: '+', removed: '–', changed: '~' };
  const head = '<th class="cmpk">Δ</th>' + d.columns.map((c) => `<th title="${esc(c.typeName)}">${esc(c.name)}</th>`).join('');
  const rows = cmp.rows.map((rd) => {
    const cells = d.columns.map((_, c) => {
      const changedHere = rd.kind === 'changed' && rd.changedColumns?.includes(c);
      const was = changedHere && rd.before !== undefined ? ` <span class="was">(was ${esc(cellText(rd.before[c]))})</span>` : '';
      return `<td class="${changedHere ? 'edited' : ''}">${esc(cellText(rd.row[c]))}${was}</td>`;
    }).join('');
    return `<tr class="cmp-${rd.kind}"><td class="cmpk">${sym[rd.kind]}</td>${cells}</tr>`;
  }).join('');
  const keyNote = keyCols && keyCols.length > 0
    ? `keyed by ${keyCols.map((i) => esc(d.columns[i]!.name)).join(', ')}`
    : 'matched by full row (no PK — modified rows show as removed + added)';
  const shapeNote = missing > 0 ? ` · ⚠ baseline is missing ${missing} of the current columns` : '';
  const summary = `Baseline ${base.rows.length.toLocaleString()} vs current ${cur.rows.length.toLocaleString()}${shapeNote} · `
    + `<span class="cmp-added-t">+${cmp.added} added</span> · <span class="cmp-removed-t">−${cmp.removed} removed</span> · `
    + `<span class="cmp-changed-t">~${cmp.changed} changed</span> · ${cmp.unchanged} unchanged · ${keyNote}`;
  return `<div class="hint">${summary}</div>`
    + `<div class="gridwrap"><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

/** Read-only table for a transposed / grouped view (grid-heatmap applies too). */
function renderDerivedTable(dr: DerivedResult): string {
  const ranges = heatmapOn ? heatRanges(dr.columns, dr.rows) : new Map<number, Range>();
  const head = dr.columns.map((c) => `<th title="${esc(c.typeName)}">${esc(c.name)}</th>`).join('');
  const body = dr.rows.map((row) => `<tr>${row.map((v, c) => {
    const isNull = v === null || v === undefined;
    const hs = heatmapOn ? heatStyle(c, v, ranges) : '';
    return `<td class="${isNull ? 'null' : ''}"${hs ? ` style="${hs}"` : ''}>${esc(cellText(v))}</td>`;
  }).join('')}</tr>`).join('');
  const d = data()!;
  const note = groupByCol !== undefined
    ? `Grouped by ${esc(d.columns[groupByCol]?.name ?? '')} · ${dr.rows.length.toLocaleString()} groups — read-only`
    : `Transposed · ${dr.columns.length - 1} rows as columns — read-only`;
  return `<div class="hint">${note}. Export / Copy use this view.</div>`
    + `<div class="gridwrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

const CHART_COLORS = ['blue', 'green', 'orange', 'red', 'purple', 'yellow'].map((c) => `var(--vscode-charts-${c})`);

/** Chart view: type/label/value pickers + an inline-SVG chart (CSP-safe). */
function renderChart(): string {
  const d = data()!;
  if (chartSpec === undefined) { chartSpec = suggestChartSpec(d.columns, d.rows); }
  if (chartSpec === undefined) { return '<div class="hint">No numeric columns to chart.</div>'; }
  const spec = chartSpec;
  const numeric = new Set(numericColumns(d.columns, d.rows));
  const typeOpts = (['bar', 'line', 'pie'] as ChartType[])
    .map((t) => `<option value="${t}"${t === spec.type ? ' selected' : ''}>${t}</option>`).join('');
  const labelOpts = d.columns
    .map((c, i) => `<option value="${i}"${i === spec.labelColumn ? ' selected' : ''}>${esc(c.name)}</option>`).join('');
  const valueChecks = d.columns.map((c, i) => numeric.has(i)
    ? `<label class="vk"><input type="checkbox" class="chart-val" data-c="${i}"${spec.valueColumns.includes(i) ? ' checked' : ''}/> ${esc(c.name)}</label>`
    : '').join('');
  const model = buildChartModel(d.columns, d.rows, spec);
  const omitted = model.omitted > 0
    ? (model.type === 'pie'
        ? `<div class="hint">showing the top ${model.labels.length} of ${(model.labels.length + model.omitted).toLocaleString()} categories (${model.omitted.toLocaleString()} smaller ones omitted)</div>`
        : `<div class="hint">charting the first ${model.labels.length} of ${d.rows.length.toLocaleString()} rows (${model.omitted.toLocaleString()} omitted)</div>`)
    : '';
  return `<div class="chartbar">
      <label>Type <select id="chart-type">${typeOpts}</select></label>
      <label>Label <select id="chart-label">${labelOpts}</select></label>
      <span class="vals">Values ${valueChecks}</span>
    </div>${omitted}
    <div class="chartwrap">${chartSvg(model)}</div>`;
}

function chartSvg(model: ChartModel): string {
  // Color goes on the `style` attribute (not the `fill`/`stroke` presentation
  // attributes): Chromium resolves CSS var() only in style declarations.
  const W = 820, H = 380, mL = 48, mR = 16, mT = 16, mB = 70;
  const plotW = W - mL - mR, plotH = H - mT - mB;
  const color = (i: number): string => CHART_COLORS[i % CHART_COLORS.length]!;
  const legend = model.series.map((s, i) =>
    `<span class="lg"><span class="sw" style="background:${color(i)}"></span>${esc(s.name)}</span>`).join('');

  if (model.type === 'pie') {
    const vals = model.series[0]?.values ?? [];
    const total = vals.reduce((a, b) => a + Math.max(0, b), 0) || 1;
    const cx = W / 2, cy = H / 2 - 10, rad = Math.min(plotH, plotW) / 2 - 10;
    const positive = vals.filter((v) => v > 0).length;
    let angle = -Math.PI / 2;
    const slices = vals.map((v, i) => {
      const frac = Math.max(0, v) / total;
      if (frac <= 0) { return ''; }
      // A single (100%) slice is a full circle: an arc with coincident
      // endpoints is degenerate and paints nothing, so draw a circle instead.
      if (positive === 1 || frac >= 0.9999) {
        return `<circle cx="${cx}" cy="${cy}" r="${rad}" style="fill:${color(i)};stroke:var(--vscode-editor-background)"/>`;
      }
      const end = angle + frac * Math.PI * 2;
      const x1 = cx + rad * Math.cos(angle), y1 = cy + rad * Math.sin(angle);
      const x2 = cx + rad * Math.cos(end), y2 = cy + rad * Math.sin(end);
      const large = frac > 0.5 ? 1 : 0;
      const path = `<path d="M ${cx} ${cy} L ${x1.toFixed(1)} ${y1.toFixed(1)} A ${rad} ${rad} 0 ${large} 1 ${x2.toFixed(1)} ${y2.toFixed(1)} Z" style="fill:${color(i)};stroke:var(--vscode-editor-background)"/>`;
      angle = end;
      return path;
    }).join('');
    const pieLegend = model.labels.map((l, i) =>
      `<span class="lg"><span class="sw" style="background:${color(i)}"></span>${esc(l)} (${fmt(vals[i] ?? 0)})</span>`).join(' ');
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet">${slices}</svg><div class="legend">${pieLegend}</div>`;
  }

  const allValues = model.series.flatMap((s) => s.values);
  // Floor/ceil at 0 so the baseline is included, but do NOT clamp the range to
  // 1 — that would flatten sub-1 (ratios) or all-negative data.
  const max = Math.max(0, ...allValues);
  const min = Math.min(0, ...allValues);
  const span = max - min || 1;
  const y = (v: number): number => mT + plotH - ((v - min) / span) * plotH;
  const n = model.labels.length || 1;
  const axis = `<line x1="${mL}" y1="${mT + plotH}" x2="${W - mR}" y2="${mT + plotH}" style="stroke:var(--vscode-widget-border,#555)"/>`
    + `<line x1="${mL}" y1="${mT}" x2="${mL}" y2="${mT + plotH}" style="stroke:var(--vscode-widget-border,#555)"/>`
    + `<text x="4" y="${(y(max) + 4).toFixed(1)}" style="fill:var(--vscode-descriptionForeground)" font-size="10">${fmt(max)}</text>`
    + `<text x="4" y="${(y(min) + 4).toFixed(1)}" style="fill:var(--vscode-descriptionForeground)" font-size="10">${fmt(min)}</text>`;
  // x labels (thin them if crowded)
  const step = Math.ceil(n / 14);
  const xlabels = model.labels.map((l, i) => i % step === 0
    ? `<text x="${(mL + (i + 0.5) / n * plotW).toFixed(1)}" y="${H - mB + 14}" style="fill:var(--vscode-descriptionForeground)" font-size="9" text-anchor="end" transform="rotate(-40 ${(mL + (i + 0.5) / n * plotW).toFixed(1)} ${H - mB + 14})">${esc(l.length > 14 ? l.slice(0, 13) + '…' : l)}</text>`
    : '').join('');

  let body = '';
  if (model.type === 'line') {
    body = model.series.map((s, si) => {
      const cx = (i: number): number => mL + (i + 0.5) / n * plotW;
      const pts = s.values.map((v, i) => `${cx(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
      // Markers so a single-point series (a one-point polyline paints nothing)
      // and every vertex stay visible.
      const dots = s.values.map((v, i) => `<circle cx="${cx(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="2.5" style="fill:${color(si)}"/>`).join('');
      return `<polyline points="${pts}" fill="none" style="stroke:${color(si)}" stroke-width="2"/>${dots}`;
    }).join('');
  } else {
    const groupW = plotW / n;
    const barW = Math.max(2, (groupW * 0.8) / model.series.length);
    body = model.labels.map((_, i) => model.series.map((s, si) => {
      const v = s.values[i] ?? 0;
      const bx = mL + i * groupW + groupW * 0.1 + si * barW;
      const top = y(Math.max(v, 0)), bottom = y(Math.min(v, 0));
      return `<rect x="${bx.toFixed(1)}" y="${top.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(0, bottom - top).toFixed(1)}" style="fill:${color(si)}"/>`;
    }).join('')).join('');
  }
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet">${axis}${body}${xlabels}</svg><div class="legend">${legend}</div>`;
}

function fmt(n: number): string {
  return Math.abs(n) >= 1000 ? n.toLocaleString(undefined, { maximumFractionDigits: 0 }) : String(Math.round(n * 100) / 100);
}

function isCellEdited(r: number, c: number): boolean {
  const src = editableSource();
  const d = data();
  if (!editMode || src === undefined || d === undefined) return false;
  const pk = pkOf(colNames(), d.rows[r]!, src.pkColumns);
  const pending = edit.updates[rowKey(pk)]?.changes;
  return pending !== undefined && Object.prototype.hasOwnProperty.call(pending, d.columns[c]!.name);
}

function wire(): void {
  document.querySelectorAll('.tab').forEach((el) => el.addEventListener('click', () => {
    activeSet = Number(el.getAttribute('data-set')); view = emptyViewState(); selected.clear();
    // Reset the mode state, pending edits AND the PII reveal — a new result must
    // never inherit Reveal from the previous tab (would unmask its PII silently).
    applyModes(initialModes()); edit = emptyEditState(); chartSpec = undefined; revealPii = false; winStart = 0; render();
  }));
  document.querySelectorAll('th[data-col] .hname').forEach((el) => el.addEventListener('click', () => {
    const c = Number((el.closest('th') as HTMLElement).getAttribute('data-col'));
    const cur = view.sort;
    view.sort = cur?.columnIndex === c && cur.direction === 'asc' ? { columnIndex: c, direction: 'desc' }
      : cur?.columnIndex === c && cur.direction === 'desc' ? undefined
      : { columnIndex: c, direction: 'asc' };
    // Selection keys are positional (view-index); after a re-sort they'd point at
    // different rows, so the aggregate bar would describe stale data. Clear it.
    selected.clear();
    winStart = 0; render();
  }));
  document.querySelectorAll('.hide').forEach((el) => el.addEventListener('click', (e) => {
    e.stopPropagation();
    view.hidden = [...view.hidden, Number(el.getAttribute('data-hide'))]; render();
  }));
  document.querySelectorAll('.colfilter').forEach((el) => el.addEventListener('input', () => {
    const inp = el as HTMLInputElement;
    const c = Number(el.getAttribute('data-col'));
    const caret = inp.selectionStart; // preserve caret across the full re-render
    const text = inp.value;
    view.filters = view.filters.filter((f) => f.columnIndex !== c);
    if (text.length > 0) view.filters.push({ columnIndex: c, text });
    selected.clear(); // positional selection is stale once the filtered rows change
    winStart = 0; render();
    refocus(document.querySelector(`.colfilter[data-col="${c}"]`), caret);
  }));
  const search = document.getElementById('search') as HTMLInputElement;
  search?.addEventListener('input', () => {
    const caret = search.selectionStart; // preserve caret; render() rebuilds the input
    view.search = search.value; winStart = 0; render();
    refocus(document.getElementById('search') as HTMLInputElement | null, caret);
  });

  document.querySelectorAll('td[data-r]').forEach((el) => {
    el.addEventListener('click', (e) => {
      const me = e as MouseEvent;
      const c = Number(el.getAttribute('data-c'));
      const fk = isFk(c);
      if (me.altKey && fk !== undefined) {
        const now = Date.now();
        if (now - lastFkNav < 600) { return; } // ignore the 2nd click of a double-click
        lastFkNav = now;
        const vi = Number(el.getAttribute('data-r'));
        const d = data()!;
        const r = applyView(d.rows, view)[vi]!;
        vscode.postMessage({ type: 'fkNavigate', columnIndex: c, value: d.rows[r]![c] });
        return;
      }
      const key = `${el.getAttribute('data-r')}:${c}`;
      if (!me.ctrlKey && !me.metaKey) selected.clear();
      selected.has(key) ? selected.delete(key) : selected.add(key);
      document.querySelectorAll('td.sel').forEach((t) => t.classList.remove('sel'));
      selected.forEach((k) => { const [r, cc] = k.split(':'); document.querySelector(`td[data-r="${r}"][data-c="${cc}"]`)?.classList.add('sel'); });
      renderAgg();
    });
    el.addEventListener('dblclick', () => {
      const c = Number(el.getAttribute('data-c'));
      const vi = Number(el.getAttribute('data-r'));
      if (isMasked(c)) { return; } // don't reveal PII through the cell viewer
      if (editMode && editableSource() !== undefined && !isPkCol(c) && !(el as HTMLElement).closest('tr')?.classList.contains('deleted')) {
        beginCellEdit(el as HTMLElement, vi, c);
      } else {
        showViewer(vi, c);
      }
    });
  });

  // Insert-row cells: double-click to edit.
  document.querySelectorAll('td[data-ins]').forEach((el) => {
    el.addEventListener('dblclick', () => beginInsertEdit(el as HTMLElement, Number(el.getAttribute('data-ins')), Number(el.getAttribute('data-c'))));
  });

  // Row delete / undo toggles.
  document.querySelectorAll('td[data-del]').forEach((el) => el.addEventListener('click', () => {
    const vi = Number(el.getAttribute('data-del'));
    const d = data()!; const src = editableSource()!;
    const r = applyView(d.rows, view)[vi]!;
    toggleDelete(edit, pkOf(colNames(), d.rows[r]!, src.pkColumns));
    render();
  }));
  document.querySelectorAll('td[data-insdel]').forEach((el) => el.addEventListener('click', () => {
    removeInsert(edit, Number(el.getAttribute('data-insdel'))); render();
  }));

  document.getElementById('btn-export')?.addEventListener('click', () => toggleMenu('save', 'btn-export'));
  document.getElementById('btn-copy')?.addEventListener('click', () => toggleMenu('clip', 'btn-copy'));
  document.getElementById('btn-cols')?.addEventListener('click', () => { view.hidden = []; render(); });
  document.getElementById('btn-edit')?.addEventListener('click', () => { applyModes(machineToggleEdit(modes)); render(); });
  document.getElementById('btn-pii')?.addEventListener('click', () => { revealPii = !revealPii; render(); });
  document.getElementById('btn-chart')?.addEventListener('click', () => toggleChart());
  document.getElementById('btn-heat')?.addEventListener('click', () => { applyModes(machineToggleHeatmap(modes)); render(); });
  document.getElementById('btn-pin')?.addEventListener('click', () => pinBaseline());
  document.getElementById('btn-compare')?.addEventListener('click', () => toggleCompare());
  document.getElementById('btn-transpose')?.addEventListener('click', () => {
    applyModes(machineToggleTranspose(modes));
    render();
  });
  document.getElementById('group-sel')?.addEventListener('change', (e) => {
    const v = (e.target as HTMLSelectElement).value;
    applyModes(machineSetGroup(modes, v === '' ? undefined : Number(v)));
    render();
  });
  document.getElementById('chart-type')?.addEventListener('change', (e) => {
    if (chartSpec !== undefined) { chartSpec.type = (e.target as HTMLSelectElement).value as ChartType; render(); }
  });
  document.getElementById('chart-label')?.addEventListener('change', (e) => {
    if (chartSpec !== undefined) { chartSpec.labelColumn = Number((e.target as HTMLSelectElement).value); render(); }
  });
  document.querySelectorAll('.chart-val').forEach((el) => el.addEventListener('change', () => {
    if (chartSpec === undefined) return;
    const picked = Array.from(document.querySelectorAll('.chart-val'))
      .filter((x) => (x as HTMLInputElement).checked)
      .map((x) => Number(x.getAttribute('data-c')));
    chartSpec.valueColumns = picked.length > 0 ? picked : chartSpec.valueColumns;
    render();
  }));
  document.getElementById('btn-add')?.addEventListener('click', () => { addInsert(edit, colNames()); render(); });
  document.getElementById('btn-discard')?.addEventListener('click', () => { edit = emptyEditState(); render(); });
  document.getElementById('btn-commit')?.addEventListener('click', () => {
    const src = editableSource();
    if (src === undefined || committing) return; // in-flight guard (UXD-003)
    if (editCount(edit) === 0) { return; }
    committing = true;
    render(); // repaints the button disabled so a second click can't re-fire
    vscode.postMessage({ type: 'commitEdits', changeSet: toChangeSet(src, edit), source: src });
    // Fallback: if the commit fails the host sends no fresh data, so re-enable
    // after a grace period (success path clears `committing` via setData).
    setTimeout(() => { if (committing) { committing = false; render(); } }, 5000);
  });

  // virtualized-grid: restore scroll after the re-render and track scrolling.
  if (virtualized) {
    const wrap = document.querySelector('.gridwrap') as HTMLElement | null;
    if (wrap !== null) {
      wrap.scrollTop = savedScroll;
      wrap.addEventListener('scroll', onVirtualScroll);
    }
  }
}

/** virtualized-grid: re-window only when the viewport nears the rendered slice
 * edge (hysteresis), throttled to one check per animation frame. */
function onVirtualScroll(): void {
  const wrap = document.querySelector('.gridwrap') as HTMLElement | null;
  if (wrap === null) { return; }
  savedScroll = wrap.scrollTop; // keep fresh so a benign re-render restores it exactly
  if (rafPending) { return; }
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    const w = document.querySelector('.gridwrap') as HTMLElement | null;
    if (w === null) { return; }
    // virtualWindow gives the ideal [start,end] for the viewport; only re-render
    // when it pokes outside the currently rendered slice (hysteresis).
    const ideal = virtualWindow(w.scrollTop, w.clientHeight, ROW_H, lastRowCount, OVERSCAN);
    if (ideal.start < winStart || ideal.end > winStart + RENDER_COUNT) {
      const newStart = Math.max(0, Math.floor(w.scrollTop / ROW_H) - OVERSCAN * 2);
      if (newStart !== winStart) { savedScroll = w.scrollTop; winStart = newStart; render(); }
    }
  });
}

/** Replace an existing-row cell with an input; commit on Enter/blur. */
function beginCellEdit(td: HTMLElement, vi: number, c: number): void {
  const d = data()!; const src = editableSource()!;
  const r = applyView(d.rows, view)[vi]!;
  const original = d.rows[r]![c];
  const current = displayValue(r, c);
  openInput(td, current, (raw) => {
    recordUpdate(edit, pkOf(colNames(), d.rows[r]!, src.pkColumns), d.columns[c]!.name, coerceEdit(raw, original), original);
    render();
  });
}

/** Replace an insert-row cell with an input; store the value on commit. */
function beginInsertEdit(td: HTMLElement, ii: number, c: number): void {
  const d = data()!;
  const name = d.columns[c]!.name;
  const current = edit.inserts[ii]?.[name];
  openInput(td, current, (raw) => {
    if (edit.inserts[ii] !== undefined) {
      edit.inserts[ii]![name] = raw === '' ? null : coerceEdit(raw, d.rows[0]?.[c] ?? '');
    }
    render();
  });
}

function openInput(td: HTMLElement, current: unknown, commit: (raw: string) => void): void {
  const start = current === null || current === undefined ? '' : String(current);
  td.classList.add('editing');
  td.innerHTML = `<input value="${esc(start)}"/>`;
  const input = td.querySelector('input') as HTMLInputElement;
  input.focus(); input.select();
  let done = false;
  const finish = (save: boolean): void => {
    if (done) return; done = true;
    if (save) commit(input.value); else render();
  };
  input.addEventListener('keydown', (e) => {
    const ke = e as KeyboardEvent;
    if (ke.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (ke.key === 'Escape') { e.preventDefault(); finish(false); }
  });
  input.addEventListener('blur', () => finish(true));
}

/** Close the export/copy menu and the value viewer (shared dismiss path). */
function closeOverlays(): void {
  document.getElementById('menu')?.classList.add('hidden');
  document.getElementById('viewer')?.classList.add('hidden');
}

/** Open the export/copy menu, or close it if the same trigger is clicked again. */
function toggleMenu(target: 'save' | 'clip', triggerId: string): void {
  const menu = document.getElementById('menu')!;
  if (!menu.classList.contains('hidden') && menu.dataset.target === target) {
    menu.classList.add('hidden');
    return;
  }
  showMenu(target, triggerId);
}

function showMenu(target: 'save' | 'clip', triggerId: string): void {
  const menu = document.getElementById('menu')!;
  menu.dataset.target = target;
  const formats: ExportFormat[] = ['csv', 'tsv', 'json', 'markdown', 'insert'];
  menu.innerHTML = formats.map((f) => `<div class="mi" data-f="${f}">${f.toUpperCase()}</div>`).join('');
  // Anchor the (position:fixed) menu just under its trigger button.
  const btn = document.getElementById(triggerId);
  if (btn !== null) {
    const r = btn.getBoundingClientRect();
    menu.style.left = `${Math.round(r.left)}px`;
    menu.style.top = `${Math.round(r.bottom)}px`;
  }
  menu.classList.remove('hidden');
  menu.querySelectorAll('.mi').forEach((el) => el.addEventListener('click', () => {
    const format = el.getAttribute('data-f') as ExportFormat;
    const { columns, rows } = currentRowsForExport();
    const content = exportResult(format, { columns, rows, tableName: 'target_table' });
    vscode.postMessage(target === 'save' ? { type: 'saveFile', format, content } : { type: 'clipboard', content });
    menu.classList.add('hidden');
  }));
}

function showViewer(vi: number, c: number): void {
  const d = data();
  if (d === undefined) return;
  const r = applyView(d.rows, view)[vi]!;
  const val = d.rows[r]![c];
  const cv = viewCell(val, d.columns[c]!.typeName);
  const viewer = document.getElementById('viewer')!;
  viewer.innerHTML = `<div class="vhead">${esc(d.columns[c]!.name)} · ${cv.kind} · ${cv.length} chars <span id="vclose">✕</span></div><pre>${esc(cv.formatted)}</pre>`;
  viewer.classList.remove('hidden');
  document.getElementById('vclose')?.addEventListener('click', () => viewer.classList.add('hidden'));
}

function renderAgg(): void {
  const bar = document.getElementById('aggbar');
  const d = data();
  if (bar === null || d === undefined) return;
  if (selected.size === 0) { bar.textContent = ''; return; }
  const rowIdx = applyView(d.rows, view);
  // pii-safe-mode: never aggregate the raw value of a masked cell — that would
  // leak PII through sum/avg/min/max/median. Masked cells contribute as text.
  const values = [...selected].map((k) => {
    const [r, c] = k.split(':').map(Number);
    return isMasked(c!) ? MASK_TOKEN : d.rows[rowIdx[r!]!]![c!];
  });
  const a = aggregate(values);
  const parts = [`count ${a.count}`, `nulls ${a.nulls}`];
  if (a.sum !== undefined) parts.push(`sum ${round(a.sum)}`, `avg ${round(a.avg!)}`, `min ${round(a.min!)}`, `max ${round(a.max!)}`, `median ${round(a.median!)}`);
  bar.textContent = parts.join('  ·  ');
}

function round(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/\.?0+$/, '');
}

// Overlay dismissal (UXD-005/006): the export/copy menu and the value viewer
// must close like real menus. One document-level pair of listeners (render()
// rebuilds the DOM, so wiring per-render would stack them).
document.addEventListener('keydown', (e) => {
  if ((e as KeyboardEvent).key === 'Escape') { closeOverlays(); }
});
document.addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  const menu = document.getElementById('menu');
  if (menu !== null && !menu.classList.contains('hidden')
    && t.closest('#menu') === null && t.closest('#btn-export') === null && t.closest('#btn-copy') === null) {
    menu.classList.add('hidden');
  }
  const viewer = document.getElementById('viewer');
  if (viewer !== null && !viewer.classList.contains('hidden') && t.closest('#viewer') === null) {
    viewer.classList.add('hidden');
  }
});

// paste-csv-grid: in edit mode, paste TSV/CSV to add rows. One document-level
// listener (render() rebuilds the DOM, so wiring it per-render would stack).
document.addEventListener('paste', (e) => {
  if (!editMode || editableSource() === undefined) { return; }
  const text = (e as ClipboardEvent).clipboardData?.getData('text/plain') ?? '';
  if (parseClipboardRows(text).length === 0) { return; }
  e.preventDefault();
  addRowsFromText(text);
  render();
});

render();
vscode.postMessage({ type: 'ready' });
