import { describe, expect, it } from 'vitest';
import { buildSelectSql, type QuerySpec } from '../src/query/queryBuilder';
import { parseGeometry, collectShapes, pickGeometryColumn } from '../src/geo/geoParse';
import { geoBBox, geoToSvg } from '../src/geo/geoSvg';

describe('buildSelectSql', () => {
  it('SELECT * FROM schema.table with default', () => {
    expect(buildSelectSql({ schema: 'tickit', table: 'venue' })).toBe('SELECT *\nFROM tickit.venue;');
  });

  it('columns, DISTINCT, ORDER BY and LIMIT', () => {
    const sql = buildSelectSql({
      schema: 'tickit', table: 'sales', columns: ['salesid', 'pricepaid'], distinct: true,
      orderBy: [{ column: 'pricepaid', dir: 'DESC' }], limit: 25,
    });
    expect(sql).toBe('SELECT DISTINCT salesid, pricepaid\nFROM tickit.sales\nORDER BY pricepaid DESC\nLIMIT 25;');
  });

  it('WHERE with AND/OR connectors, typed literals and IS NULL', () => {
    const spec: QuerySpec = {
      schema: 'tickit', table: 'users',
      filters: [
        { column: 'state', op: '=', value: 'WA' },
        { column: 'age', op: '>', value: '21', connector: 'AND' },
        { column: 'email', op: 'IS NULL', connector: 'OR' },
      ],
    };
    const sql = buildSelectSql(spec);
    expect(sql).toContain("WHERE state = 'WA'");
    expect(sql).toContain('AND age > 21'); // numeric stays unquoted
    expect(sql).toContain('OR email IS NULL'); // no value rendered
  });

  it('IN list and JOIN', () => {
    const sql = buildSelectSql({
      schema: 't', table: 'a',
      joins: [{ table: 'b', on: 'a.id = b.aid', kind: 'LEFT' }],
      filters: [{ column: 'status', op: 'IN', value: 'open, closed' }],
    });
    expect(sql).toContain('LEFT JOIN b ON a.id = b.aid');
    expect(sql).toContain("status IN ('open', 'closed')");
  });

  it('emits LIMIT 0 when explicitly set, and no LIMIT when undefined', () => {
    expect(buildSelectSql({ schema: 't', table: 'a', limit: 0 })).toContain('LIMIT 0');
    expect(buildSelectSql({ schema: 't', table: 'a' })).not.toContain('LIMIT');
  });

  it('quotes a hostile identifier but leaves qualified names intact', () => {
    const sql = buildSelectSql({ schema: 'weird schema', table: 't', columns: ['a.b'] });
    expect(sql).toContain('"weird schema".t');
    expect(sql).toContain('SELECT a.b'); // qualified col not quoted
  });
});

describe('geoParse', () => {
  it('parses WKT POINT / LINESTRING / POLYGON', () => {
    expect(parseGeometry('POINT (30 10)')).toEqual([{ kind: 'point', points: [[30, 10]] }]);
    expect(parseGeometry('LINESTRING (30 10, 10 30, 40 40)')[0]!.kind).toBe('line');
    const poly = parseGeometry('POLYGON ((30 10, 40 40, 20 40, 30 10))');
    expect(poly[0]!.kind).toBe('ring');
    expect(poly[0]!.points.length).toBe(4);
  });

  it('parses a POLYGON with a hole as two rings', () => {
    const p = parseGeometry('POLYGON ((0 0, 10 0, 10 10, 0 0),(2 2, 4 2, 4 4, 2 2))');
    expect(p.length).toBe(2);
    expect(p.every((s) => s.kind === 'ring')).toBe(true);
  });

  it('parses MULTIPOINT and MULTIPOLYGON', () => {
    expect(parseGeometry('MULTIPOINT ((10 40),(40 30))').length).toBe(2);
    const mp = parseGeometry('MULTIPOLYGON (((0 0,1 0,1 1,0 0)),((5 5,6 5,6 6,5 5)))');
    expect(mp.length).toBe(2);
  });

  it('parses GeoJSON and drops SRID prefix on WKT', () => {
    expect(parseGeometry('{"type":"Point","coordinates":[1,2]}')).toEqual([{ kind: 'point', points: [[1, 2]] }]);
    expect(parseGeometry('SRID=4326;POINT (5 6)')).toEqual([{ kind: 'point', points: [[5, 6]] }]);
  });

  it('returns [] for non-geometry / malformed input', () => {
    expect(parseGeometry('not geometry')).toEqual([]);
    expect(parseGeometry('{bad json')).toEqual([]);
    expect(parseGeometry(null)).toEqual([]);
  });

  it('pickGeometryColumn finds the geometry column and collectShapes flattens', () => {
    const columns = [{ name: 'id' }, { name: 'geom' }];
    const rows = [[1, 'POINT (0 0)'], [2, 'POINT (1 1)']];
    expect(pickGeometryColumn(columns, rows)).toBe(1);
    expect(collectShapes(rows.map((r) => r[1] as string)).length).toBe(2);
  });
});

describe('geoSvg', () => {
  it('bbox spans all shapes', () => {
    const shapes = collectShapes(['POINT (0 0)', 'POINT (10 20)']);
    expect(geoBBox(shapes)).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 20 });
  });

  it('renders points/lines/rings with style-attribute colors (CSP-safe)', () => {
    const svg = geoToSvg(collectShapes(['POLYGON ((0 0,10 0,10 10,0 0))', 'LINESTRING (0 0, 5 5)', 'POINT (5 5)']));
    expect(svg).toContain('<svg');
    expect(svg).toContain('<polygon');
    expect(svg).toContain('<polyline');
    expect(svg).toContain('<circle');
    expect(svg).toContain('style="fill:var('); // color via style, not presentation attr
    expect(svg).not.toContain('fill="var('); // Chromium won't resolve var() in presentation attrs
  });

  it('shows a placeholder when there is nothing to draw', () => {
    expect(geoToSvg([])).toContain('No geometry to display');
  });
});
