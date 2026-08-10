import { describe, expect, it } from 'vitest';
import {
  initialModes, toggleEdit, setEdit, toggleChart, toggleTranspose, setGroup,
  toggleCompare, toggleHeatmap, selectionCleared, type ModeState, type GridMode,
} from '../src/grid/modeMachine';

type Action = { name: string; run: (s: ModeState) => ModeState; targetMode?: GridMode };

const ACTIONS: Action[] = [
  { name: 'toggleEdit', run: toggleEdit, targetMode: 'edit' },
  { name: 'toggleChart', run: toggleChart, targetMode: 'chart' },
  { name: 'toggleTranspose', run: toggleTranspose, targetMode: 'transpose' },
  { name: 'setGroup(2)', run: (s) => setGroup(s, 2), targetMode: 'group' },
  { name: 'toggleCompare', run: toggleCompare, targetMode: 'compare' },
  { name: 'toggleHeatmap', run: toggleHeatmap },
  { name: 'setGroup(undefined)', run: (s) => setGroup(s, undefined) },
  { name: 'setEdit(true)', run: (s) => setEdit(s, true), targetMode: 'edit' },
  { name: 'setEdit(false)', run: (s) => setEdit(s, false) },
];

function invariants(s: ModeState): void {
  // groupBy defined iff grouping — the core invariant.
  expect(s.groupBy !== undefined, `groupBy/mode mismatch: ${JSON.stringify(s)}`).toBe(s.mode === 'group');
  expect(['table', 'edit', 'chart', 'transpose', 'group', 'compare']).toContain(s.mode);
}

// Deterministic PRNG (mulberry32) so a failure is reproducible.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('modeMachine', () => {
  it('starts at table, no group, no heatmap', () => {
    expect(initialModes()).toEqual({ mode: 'table', groupBy: undefined, heatmap: false });
  });

  it('entering any exclusive mode from any other lands ONLY in it (full pair table)', () => {
    const enters = ACTIONS.filter((a) => a.targetMode !== undefined);
    for (const a of enters) {
      for (const b of enters) {
        if (a.targetMode === b.targetMode) continue;
        const afterA = a.run(initialModes());
        expect(afterA.mode).toBe(a.targetMode);
        const afterB = b.run(afterA);
        expect(afterB.mode, `${a.name} then ${b.name}`).toBe(b.targetMode);
        invariants(afterB);
      }
    }
  });

  it('re-toggling the active mode returns to table', () => {
    expect(toggleEdit(toggleEdit(initialModes())).mode).toBe('table');
    expect(toggleChart(toggleChart(initialModes())).mode).toBe('table');
    expect(toggleTranspose(toggleTranspose(initialModes())).mode).toBe('table');
    expect(toggleCompare(toggleCompare(initialModes())).mode).toBe('table');
    expect(setGroup(setGroup(initialModes(), 1), undefined).mode).toBe('table');
  });

  it('setGroup(undefined) outside group mode is a no-op', () => {
    const inChart = toggleChart(initialModes());
    expect(setGroup(inChart, undefined)).toEqual(inChart);
  });

  it('setEdit(false) outside edit mode is a no-op', () => {
    const inChart = toggleChart(initialModes());
    expect(setEdit(inChart, false)).toEqual(inChart);
  });

  it('heatmap is an overlay: survives mode switches, untouched by them', () => {
    let s = toggleHeatmap(initialModes());
    expect(s.heatmap).toBe(true);
    s = toggleChart(s);
    expect(s.heatmap).toBe(true); // chart just does not draw it
    s = toggleEdit(s);
    expect(s.heatmap).toBe(true);
    s = toggleHeatmap(s);
    expect(s.heatmap).toBe(false);
    expect(s.mode).toBe('edit'); // and heatmap does not touch the mode
  });

  it('selectionCleared: exactly when the exclusive view changes', () => {
    const t = initialModes();
    expect(selectionCleared(t, toggleChart(t))).toBe(true);
    expect(selectionCleared(t, toggleHeatmap(t))).toBe(false); // overlay only
    expect(selectionCleared(setGroup(t, 1), setGroup(t, 2))).toBe(true); // regroup
    expect(selectionCleared(t, t)).toBe(false);
  });

  it('property: invariants hold across a 2000-step seeded random walk', () => {
    const rnd = mulberry32(0x9ed1e45); // fixed seed — failures reproduce exactly
    let s = initialModes();
    for (let i = 0; i < 2000; i++) {
      const a = ACTIONS[Math.floor(rnd() * ACTIONS.length)]!;
      const next = a.run(s);
      invariants(next);
      // Entering a target mode always lands there (or table if it was active).
      if (a.targetMode !== undefined) {
        expect(next.mode).toBe(s.mode === a.targetMode && a.name.startsWith('toggle') ? 'table' : a.targetMode);
      }
      // Exclusive-mode actions never touch the heatmap overlay.
      if (a.name !== 'toggleHeatmap') {
        expect(next.heatmap).toBe(s.heatmap);
      }
      s = next;
    }
  });
});
