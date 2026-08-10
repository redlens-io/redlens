/**
 * Pure grid model (M1 `interactive-grid`): sorting, multi-column filtering,
 * text search and column visibility/order over a page of rows. vscode-free so
 * it unit-tests cleanly; the webview renders whatever this returns.
 */
export interface GridColumn {
  name: string;
  typeName: string;
}

export type SortDirection = 'asc' | 'desc';

export interface SortState {
  columnIndex: number;
  direction: SortDirection;
}

export interface ColumnFilter {
  columnIndex: number;
  /** Case-insensitive substring match against the cell's display text. */
  text: string;
}

export interface GridViewState {
  sort?: SortState;
  filters: ColumnFilter[];
  /** Global case-insensitive search across all columns. */
  search: string;
  /** Column indices hidden from view (data is kept). */
  hidden: number[];
  /** Display order of column indices; defaults to natural order. */
  order?: number[];
}

export function emptyViewState(): GridViewState {
  return { filters: [], search: '', hidden: [] };
}

/** Display text for a cell — matches what the grid renders (NULL, JSON, etc.). */
export function cellText(value: unknown): string {
  if (value === null || value === undefined) {
    return 'NULL';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

function compareValues(a: unknown, b: unknown): number {
  if (a === null || a === undefined) {
    return b === null || b === undefined ? 0 : -1;
  }
  if (b === null || b === undefined) {
    return 1;
  }
  if (typeof a === 'number' && typeof b === 'number') {
    return a - b;
  }
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb) && typeof a !== 'boolean' && typeof b !== 'boolean') {
    return na - nb;
  }
  return cellText(a).localeCompare(cellText(b));
}

/**
 * Applies filters → search → sort and returns the ROW INDICES into the original
 * `rows`, so the webview can map selections back to source data.
 */
export function applyView(rows: readonly unknown[][], state: GridViewState): number[] {
  let indices = rows.map((_, i) => i);

  for (const filter of state.filters) {
    if (filter.text.trim().length === 0) {
      continue;
    }
    const needle = filter.text.toLowerCase();
    indices = indices.filter((i) => cellText(rows[i]?.[filter.columnIndex]).toLowerCase().includes(needle));
  }

  if (state.search.trim().length > 0) {
    const needle = state.search.toLowerCase();
    indices = indices.filter((i) => (rows[i] ?? []).some((cell) => cellText(cell).toLowerCase().includes(needle)));
  }

  if (state.sort !== undefined) {
    const { columnIndex, direction } = state.sort;
    const sign = direction === 'asc' ? 1 : -1;
    indices = [...indices].sort((ia, ib) => sign * compareValues(rows[ia]?.[columnIndex], rows[ib]?.[columnIndex]));
  }

  return indices;
}

/** Visible columns in display order, honoring hidden + order. */
export function visibleColumnOrder(columnCount: number, state: GridViewState): number[] {
  const order = state.order ?? Array.from({ length: columnCount }, (_, i) => i);
  const hidden = new Set(state.hidden);
  return order.filter((i) => i >= 0 && i < columnCount && !hidden.has(i));
}
