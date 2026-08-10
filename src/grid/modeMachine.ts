/**
 * Grid mode machine (Fase UX-QA, UX-0): the single authority for the grid's
 * view-mode state. The webview used to mutate six loose flags (editMode /
 * chartMode / heatmapOn / transposeOn / groupByCol / compareMode) at ~10 call
 * sites — the historical source of "I opened X and Y did not close" bugs.
 *
 * Model:
 * - Exactly ONE exclusive mode is active at a time: table | edit | chart |
 *   transpose | group | compare. Entering any of them leaves the others.
 * - `groupBy` is defined iff mode === 'group' (invariant).
 * - `heatmap` is an OVERLAY, not a mode: it composes with table/edit/derived
 *   views, is simply not drawn by chart/compare, and survives mode switches.
 *   It resets only with `initialModes()` (new data / tab switch).
 *
 * Pure and fully tested (tests/modeMachine.test.ts, incl. a seeded random walk
 * asserting the invariants after every step).
 */
export type GridMode = 'table' | 'edit' | 'chart' | 'transpose' | 'group' | 'compare';

export interface ModeState {
  readonly mode: GridMode;
  /** Grouping column index; defined iff mode === 'group'. */
  readonly groupBy: number | undefined;
  /** Heatmap overlay (independent of the exclusive mode). */
  readonly heatmap: boolean;
}

export function initialModes(): ModeState {
  return { mode: 'table', groupBy: undefined, heatmap: false };
}

function enter(s: ModeState, mode: GridMode, groupBy?: number): ModeState {
  return { mode, groupBy: mode === 'group' ? groupBy : undefined, heatmap: s.heatmap };
}

/** edit ↔ table; entering edit leaves chart/transpose/group/compare. */
export function toggleEdit(s: ModeState): ModeState {
  return s.mode === 'edit' ? enter(s, 'table') : enter(s, 'edit');
}

/** Explicit on/off (host `setEditMode` message). Off from a non-edit mode is a no-op. */
export function setEdit(s: ModeState, on: boolean): ModeState {
  if (on) { return enter(s, 'edit'); }
  return s.mode === 'edit' ? enter(s, 'table') : s;
}

/** chart ↔ table. Callers guard "has numeric columns" before calling. */
export function toggleChart(s: ModeState): ModeState {
  return s.mode === 'chart' ? enter(s, 'table') : enter(s, 'chart');
}

export function toggleTranspose(s: ModeState): ModeState {
  return s.mode === 'transpose' ? enter(s, 'table') : enter(s, 'transpose');
}

/** Group by a column; `undefined` leaves grouping (only) back to table. */
export function setGroup(s: ModeState, col: number | undefined): ModeState {
  if (col === undefined) {
    return s.mode === 'group' ? enter(s, 'table') : s;
  }
  return enter(s, 'group', col);
}

/** compare ↔ table. Callers guard "a baseline is pinned" before calling. */
export function toggleCompare(s: ModeState): ModeState {
  return s.mode === 'compare' ? enter(s, 'table') : enter(s, 'compare');
}

export function toggleHeatmap(s: ModeState): ModeState {
  return { mode: s.mode, groupBy: s.groupBy, heatmap: !s.heatmap };
}

/** The cell selection must be cleared whenever the exclusive view changes
 * (a selection made in one view is meaningless — and a PII leak vector via the
 * aggregate bar — in another). */
export function selectionCleared(prev: ModeState, next: ModeState): boolean {
  return prev.mode !== next.mode || prev.groupBy !== next.groupBy;
}
