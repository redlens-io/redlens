/**
 * ERD layout + SVG (M7 `schema-designer-erd`): lay out table boxes in columns
 * and draw an entity-relationship diagram (boxes + FK lines) as inline SVG.
 * Pure/testable; the webview just hosts the SVG string.
 */
export interface ErdTable {
  name: string;
  columns: { name: string; typeName: string }[];
}
export interface ErdFk {
  from: string; // table with the FK column
  to: string; // referenced table
}
export interface ErdBox {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  columns: { name: string; typeName: string }[];
}
export interface ErdEdge {
  from: string;
  to: string;
}
export interface ErdLayout {
  boxes: ErdBox[];
  edges: ErdEdge[];
  width: number;
  height: number;
}

const BOX_W = 210;
const HEADER_H = 26;
const ROW_H = 18;
const MAX_ROWS = 12;
const GAP_X = 56;
const GAP_Y = 30;
const PAD = 20;

export function layoutErd(tables: ErdTable[], fks: ErdFk[], columns = 3): ErdLayout {
  const cols = Math.max(1, Math.min(columns, tables.length || 1));
  const colHeights = Array.from({ length: cols }, () => PAD);
  const boxes: ErdBox[] = tables.map((t, i) => {
    const col = i % cols;
    const shown = t.columns.slice(0, MAX_ROWS);
    const h = HEADER_H + Math.max(1, shown.length) * ROW_H + (t.columns.length > MAX_ROWS ? ROW_H : 0);
    const x = PAD + col * (BOX_W + GAP_X);
    const y = colHeights[col]!;
    colHeights[col] = y + h + GAP_Y;
    return { name: t.name, x, y, w: BOX_W, h, columns: shown };
  });
  const names = new Set(tables.map((t) => t.name));
  const edges = fks.filter((f) => names.has(f.from) && names.has(f.to) && f.from !== f.to)
    .map((f) => ({ from: f.from, to: f.to }));
  const width = PAD + cols * (BOX_W + GAP_X);
  const height = Math.max(...colHeights, PAD);
  return { boxes, edges, width, height };
}

function esc(s: string): string {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

/** Render the layout as inline SVG. Colors use style attributes (var() only
 * resolves in CSS declarations, not presentation attributes). */
export function erdToSvg(layout: ErdLayout): string {
  const byName = new Map(layout.boxes.map((b) => [b.name, b]));
  const edges = layout.edges.map((e) => {
    const a = byName.get(e.from)!;
    const b = byName.get(e.to)!;
    const ax = a.x + a.w / 2;
    const ay = a.y + a.h / 2;
    const bx = b.x + b.w / 2;
    const by = b.y + b.h / 2;
    return `<line x1="${ax.toFixed(0)}" y1="${ay.toFixed(0)}" x2="${bx.toFixed(0)}" y2="${by.toFixed(0)}" style="stroke:var(--vscode-charts-blue);stroke-width:1.5" marker-end="url(#arrow)"/>`;
  }).join('');
  const boxes = layout.boxes.map((b) => {
    const header = `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${HEADER_H}" style="fill:var(--vscode-editorWidget-background);stroke:var(--vscode-widget-border,#555)"/>`
      + `<text x="${b.x + 8}" y="${b.y + 17}" style="fill:var(--vscode-foreground)" font-size="12" font-weight="600">${esc(b.name)}</text>`;
    const body = `<rect x="${b.x}" y="${b.y + HEADER_H}" width="${b.w}" height="${b.h - HEADER_H}" style="fill:var(--vscode-editor-background);stroke:var(--vscode-widget-border,#555)"/>`;
    const rows = b.columns.map((c, i) =>
      `<text x="${b.x + 8}" y="${b.y + HEADER_H + 13 + i * ROW_H}" style="fill:var(--vscode-foreground)" font-size="11">${esc(c.name)} <tspan style="fill:var(--vscode-descriptionForeground)">${esc(c.typeName)}</tspan></text>`).join('');
    return header + body + rows;
  }).join('');
  const defs = '<defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 Z" style="fill:var(--vscode-charts-blue)"/></marker></defs>';
  return `<svg viewBox="0 0 ${layout.width} ${layout.height}" width="${layout.width}" height="${layout.height}" xmlns="http://www.w3.org/2000/svg">${defs}${edges}${boxes}</svg>`;
}
