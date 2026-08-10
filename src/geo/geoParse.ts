/**
 * gis-map-viewer (M7): parse geometry values (WKT or GeoJSON) into a flat list
 * of primitive shapes for rendering. Pure/testable.
 *
 * Scope (honest): renders geometry that arrives as text — WKT (POINT,
 * LINESTRING, POLYGON and their MULTI* forms) or GeoJSON. On Redshift, wrap the
 * GEOMETRY column with `ST_AsText(geom)` or `ST_AsGeoJSON(geom)` to get text.
 * Hex EWKB is out of scope. There is no basemap: the map is the geometry alone,
 * auto-scaled — no tiles are fetched (strict webview CSP, fully offline).
 */
export interface GeoShape {
  kind: 'point' | 'line' | 'ring';
  /** [lng, lat] positions */
  points: Array<[number, number]>;
}

function parsePositions(text: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const chunk of text.split(',')) {
    const nums = chunk.trim().split(/\s+/).map(Number);
    if (nums.length >= 2 && Number.isFinite(nums[0]!) && Number.isFinite(nums[1]!)) {
      out.push([nums[0]!, nums[1]!]);
    }
  }
  return out;
}

/** Split on commas that sit at parenthesis-depth 0. */
function splitGroups(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ',' && depth === 0) { out.push(text.slice(start, i)); start = i + 1; }
  }
  out.push(text.slice(start));
  return out.map((s) => s.trim()).filter((s) => s.length > 0);
}

/** Strip one balanced outer layer of parentheses from a single group. */
function stripParens(s: string): string {
  const t = s.trim();
  return t.startsWith('(') && t.endsWith(')') ? t.slice(1, -1) : t;
}

function parseWkt(value: string): GeoShape[] {
  let s = value.trim();
  if (/^SRID=/i.test(s)) {
    const semi = s.indexOf(';');
    if (semi >= 0) s = s.slice(semi + 1).trim();
  }
  const m = /^([A-Za-z]+)\s*(?:ZM|Z|M)?\s*\((.*)\)\s*$/s.exec(s);
  if (m === null) return [];
  const type = m[1]!.toUpperCase();
  const body = m[2]!;
  switch (type) {
    case 'POINT':
      return [{ kind: 'point', points: parsePositions(body) }];
    case 'LINESTRING':
      return [{ kind: 'line', points: parsePositions(body) }];
    case 'POLYGON':
      return splitGroups(body).map((r) => ({ kind: 'ring' as const, points: parsePositions(stripParens(r)) }));
    case 'MULTIPOINT': {
      const groups = body.includes('(') ? splitGroups(body).map(stripParens) : body.split(',');
      return groups.map((g) => ({ kind: 'point' as const, points: parsePositions(g) }));
    }
    case 'MULTILINESTRING':
      return splitGroups(body).map((g) => ({ kind: 'line' as const, points: parsePositions(stripParens(g)) }));
    case 'MULTIPOLYGON':
      return splitGroups(body).flatMap((poly) =>
        splitGroups(stripParens(poly)).map((r) => ({ kind: 'ring' as const, points: parsePositions(stripParens(r)) })));
    default:
      return [];
  }
}

function toPositions(coords: unknown): Array<[number, number]> {
  if (!Array.isArray(coords)) return [];
  const out: Array<[number, number]> = [];
  for (const p of coords) {
    if (Array.isArray(p) && typeof p[0] === 'number' && typeof p[1] === 'number'
      && Number.isFinite(p[0]) && Number.isFinite(p[1])) {
      out.push([p[0], p[1]]);
    }
  }
  return out;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function parseGeoJson(obj: any): GeoShape[] {
  if (obj === null || typeof obj !== 'object') return [];
  const c = obj.coordinates;
  switch (obj.type) {
    case 'Point':
      return Array.isArray(c) && typeof c[0] === 'number' && typeof c[1] === 'number'
        ? [{ kind: 'point', points: [[c[0], c[1]]] }] : [];
    case 'LineString':
      return [{ kind: 'line', points: toPositions(c) }];
    case 'Polygon':
      return Array.isArray(c) ? c.map((ring: unknown) => ({ kind: 'ring' as const, points: toPositions(ring) })) : [];
    case 'MultiPoint':
      return toPositions(c).map((p) => ({ kind: 'point' as const, points: [p] }));
    case 'MultiLineString':
      return Array.isArray(c) ? c.map((line: unknown) => ({ kind: 'line' as const, points: toPositions(line) })) : [];
    case 'MultiPolygon':
      return Array.isArray(c)
        ? c.flatMap((poly: unknown) => Array.isArray(poly) ? poly.map((ring: unknown) => ({ kind: 'ring' as const, points: toPositions(ring) })) : [])
        : [];
    case 'GeometryCollection':
      return Array.isArray(obj.geometries) ? obj.geometries.flatMap(parseGeoJson) : [];
    case 'Feature':
      return parseGeoJson(obj.geometry);
    case 'FeatureCollection':
      return Array.isArray(obj.features) ? obj.features.flatMap((f: any) => parseGeoJson(f?.geometry)) : [];
    default:
      return [];
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Parse a single cell value (WKT or GeoJSON) into primitive shapes. Returns
 * [] for anything it cannot read, so callers can skip non-geometry cells. */
export function parseGeometry(value: string | null | undefined): GeoShape[] {
  if (typeof value !== 'string') return [];
  const t = value.trim();
  if (t === '') return [];
  if (t.startsWith('{')) {
    try {
      return parseGeoJson(JSON.parse(t)).filter((s) => s.points.length > 0);
    } catch {
      return [];
    }
  }
  return parseWkt(t).filter((s) => s.points.length > 0);
}

/** Parse every value of a column into one flat shape list (drops empty cells). */
export function collectShapes(values: Array<string | null | undefined>): GeoShape[] {
  return values.flatMap((v) => parseGeometry(v));
}

/** Heuristic: index of the first column whose sampled values parse as geometry. */
export function pickGeometryColumn(columns: Array<{ name: string }>, rows: unknown[][]): number {
  const sample = rows.slice(0, 25);
  for (let c = 0; c < columns.length; c++) {
    let hits = 0;
    for (const r of sample) {
      const v = r[c];
      if (typeof v === 'string' && parseGeometry(v).length > 0) hits++;
    }
    if (hits > 0) return c;
  }
  return -1;
}
