import { describe, expect, it } from 'vitest';
import { layoutErd, erdToSvg, type ErdTable, type ErdFk } from '../src/schema/erdLayout';
import type { ResultSnapshot } from '../src/grid/compareResults';

const tables: ErdTable[] = [
  { name: 'sales', columns: [{ name: 'salesid', typeName: 'int4' }, { name: 'eventid', typeName: 'int4' }] },
  { name: 'event', columns: [{ name: 'eventid', typeName: 'int4' }, { name: 'venueid', typeName: 'int4' }] },
  { name: 'venue', columns: [{ name: 'venueid', typeName: 'int4' }] },
];
const fks: ErdFk[] = [{ from: 'sales', to: 'event' }, { from: 'event', to: 'venue' }, { from: 'sales', to: 'nope' }];

describe('layoutErd', () => {
  it('places boxes without overlap and keeps only valid edges', () => {
    const l = layoutErd(tables, fks, 3);
    expect(l.boxes).toHaveLength(3);
    // distinct positions
    const keys = new Set(l.boxes.map((b) => `${b.x},${b.y}`));
    expect(keys.size).toBe(3);
    // the FK to a missing table is dropped
    expect(l.edges).toEqual([{ from: 'sales', to: 'event' }, { from: 'event', to: 'venue' }]);
    expect(l.width).toBeGreaterThan(0);
    expect(l.height).toBeGreaterThan(0);
  });

  it('caps very wide tables and stacks in the given column count', () => {
    const wide: ErdTable = { name: 't', columns: Array.from({ length: 30 }, (_, i) => ({ name: `c${i}`, typeName: 'int4' })) };
    const l = layoutErd([wide], [], 1);
    expect(l.boxes[0]!.columns.length).toBeLessThanOrEqual(12);
  });
});

describe('erdToSvg', () => {
  it('renders an svg with a box per table and a line per edge, escaping names', () => {
    const hostile: ErdTable = { name: 'a<b>&"', columns: [{ name: 'c<x', typeName: 'int' }] };
    const svg = erdToSvg(layoutErd([hostile], [], 1));
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('a&lt;b&gt;&amp;&quot;');
    expect(svg).not.toContain('a<b>&"'); // raw hostile text must not leak
    const svg2 = erdToSvg(layoutErd(tables, fks, 3));
    expect((svg2.match(/<line /g) ?? []).length).toBe(2); // two valid FK edges
  });
});

