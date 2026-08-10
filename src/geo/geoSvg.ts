/**
 * gis-map-viewer (M7): render parsed geometry as inline SVG, auto-scaled to its
 * own bounding box. Pure/testable. Colors go on `style` attributes (var() only
 * resolves in CSS declarations, not presentation attributes). No basemap tiles
 * are fetched — the map is the geometry alone (strict CSP, offline).
 */
import type { GeoShape } from './geoParse';

export interface GeoBBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function geoBBox(shapes: GeoShape[]): GeoBBox | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of shapes) {
    for (const [x, y] of s.points) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}

const PAD = 24;

export function geoToSvg(shapes: GeoShape[], width = 720, height = 440): string {
  const box = geoBBox(shapes);
  if (box === null) {
    return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`
      + `<text x="${width / 2}" y="${height / 2}" text-anchor="middle" style="fill:var(--vscode-descriptionForeground)" font-size="13">No geometry to display</text></svg>`;
  }
  const dx = box.maxX - box.minX;
  const dy = box.maxY - box.minY;
  // Uniform scale so shapes are not distorted; fall back for a single point/line.
  const sx = dx > 0 ? (width - 2 * PAD) / dx : 0;
  const sy = dy > 0 ? (height - 2 * PAD) / dy : 0;
  // A single point or a perfectly horizontal/vertical line leaves one axis at 0;
  // fall back to scale 1 rather than Infinity (Math.min of [] is Infinity).
  const scales = [sx, sy].filter((v) => v > 0);
  const scale = scales.length > 0 ? Math.min(...scales) : 1;
  const contentW = dx * scale;
  const contentH = dy * scale;
  const offX = PAD + (width - 2 * PAD - contentW) / 2;
  const offY = PAD + (height - 2 * PAD - contentH) / 2;
  // Equirectangular: x = lng, y = lat (flipped so north is up).
  const px = (x: number): string => (offX + (x - box.minX) * scale).toFixed(1);
  const py = (y: number): string => (offY + (box.maxY - y) * scale).toFixed(1);

  const parts: string[] = [];
  for (const s of shapes) {
    if (s.points.length === 0) continue;
    if (s.kind === 'point') {
      const [x, y] = s.points[0]!;
      parts.push(`<circle cx="${px(x)}" cy="${py(y)}" r="4" style="fill:var(--vscode-charts-red);stroke:var(--vscode-editor-background,#1e1e1e);stroke-width:1"/>`);
    } else {
      const pts = s.points.map(([x, y]) => `${px(x)},${py(y)}`).join(' ');
      if (s.kind === 'ring') {
        parts.push(`<polygon points="${pts}" style="fill:var(--vscode-charts-blue);fill-opacity:0.22;stroke:var(--vscode-charts-blue);stroke-width:1.5"/>`);
      } else {
        parts.push(`<polyline points="${pts}" style="fill:none;stroke:var(--vscode-charts-green);stroke-width:1.75"/>`);
      }
    }
  }
  return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${parts.join('')}</svg>`;
}
