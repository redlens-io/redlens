import { describe, expect, it } from 'vitest';
import { virtualWindow } from '../src/grid/virtualWindow';

describe('virtualWindow', () => {
  it('windows around the scroll position with overscan and correct pads', () => {
    // 10000 rows, 20px each, 400px viewport, scrolled to row 500 (10000px).
    const w = virtualWindow(10000, 400, 20, 10000, 12);
    expect(w.start).toBe(500 - 12); // floor(10000/20) - overscan
    expect(w.end).toBe(w.start + Math.ceil(400 / 20) + 24);
    expect(w.topPad).toBe(w.start * 20);
    expect(w.bottomPad).toBe((10000 - w.end) * 20);
    // pads + rendered height reconstruct the full scroll height
    expect(w.topPad + (w.end - w.start) * 20 + w.bottomPad).toBe(10000 * 20);
  });

  it('clamps at the top', () => {
    const w = virtualWindow(0, 400, 20, 1000);
    expect(w.start).toBe(0);
    expect(w.topPad).toBe(0);
  });

  it('clamps at the bottom (end never exceeds total)', () => {
    const w = virtualWindow(1_000_000, 400, 20, 1000);
    expect(w.end).toBe(1000);
    expect(w.bottomPad).toBe(0);
  });

  it('degenerate inputs render everything', () => {
    expect(virtualWindow(0, 0, 20, 50)).toEqual({ start: 0, end: 50, topPad: 0, bottomPad: 0 });
    expect(virtualWindow(0, 400, 0, 50)).toEqual({ start: 0, end: 50, topPad: 0, bottomPad: 0 });
    expect(virtualWindow(0, 400, 20, 0)).toEqual({ start: 0, end: 0, topPad: 0, bottomPad: 0 });
  });
});
