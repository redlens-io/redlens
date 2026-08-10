/**
 * Windowing math (M5 `virtualized-grid`): given the scroll position, decides
 * which contiguous slice of rows to actually render, plus the spacer heights
 * that keep the scrollbar geometry correct. Pure/testable; the webview renders
 * only [start,end) and pads with two spacer rows.
 */
export interface VWindow {
  start: number;
  end: number;
  topPad: number;
  bottomPad: number;
}

export function virtualWindow(
  scrollTop: number,
  viewportH: number,
  rowH: number,
  total: number,
  overscan = 12,
): VWindow {
  if (total <= 0 || rowH <= 0 || viewportH <= 0) {
    return { start: 0, end: total < 0 ? 0 : total, topPad: 0, bottomPad: 0 };
  }
  const top = Math.max(0, scrollTop);
  const start = Math.max(0, Math.floor(top / rowH) - overscan);
  const visible = Math.ceil(viewportH / rowH) + overscan * 2;
  const end = Math.min(total, start + visible);
  return {
    start,
    end,
    topPad: start * rowH,
    bottomPad: Math.max(0, (total - end) * rowH),
  };
}
