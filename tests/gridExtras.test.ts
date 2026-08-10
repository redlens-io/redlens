import { describe, expect, it } from 'vitest';
import { aggregate } from '../src/grid/aggregate';
import { exportResult } from '../src/grid/exporters';
import { viewCell, toHexDump } from '../src/grid/cellViewer';

describe('aggregate', () => {
  it('computes numeric stats and counts nulls', () => {
    const a = aggregate([1, 2, 3, 4, null, 'x']);
    expect(a.count).toBe(5);
    expect(a.nulls).toBe(1);
    expect(a.numeric).toBe(4);
    expect(a.sum).toBe(10);
    expect(a.avg).toBe(2.5);
    expect(a.min).toBe(1);
    expect(a.max).toBe(4);
    expect(a.median).toBe(2.5);
  });

  it('handles no numeric values', () => {
    const a = aggregate(['a', 'b', null]);
    expect(a.numeric).toBe(0);
    expect(a.sum).toBeUndefined();
    expect(a.median).toBeUndefined();
  });

  it('median of odd count', () => {
    expect(aggregate([5, 1, 3]).median).toBe(3);
  });
});

const cols = [
  { name: 'id', typeName: 'int4' },
  { name: 'note', typeName: 'varchar' },
];
const rows: unknown[][] = [
  [1, 'hello'],
  [2, 'has,comma'],
  [3, null],
];

describe('exportResult', () => {
  it('CSV quotes fields with commas and renders NULL as empty', () => {
    const csv = exportResult('csv', { columns: cols, rows });
    expect(csv.split('\n')[0]).toBe('id,note');
    expect(csv).toContain('"has,comma"');
    expect(csv.split('\n')[3]).toBe('3,');
  });

  it('JSON produces objects keyed by column', () => {
    const json = JSON.parse(exportResult('json', { columns: cols, rows }));
    expect(json[0]).toEqual({ id: 1, note: 'hello' });
    expect(json[2]).toEqual({ id: 3, note: null });
  });

  it('Markdown escapes pipes', () => {
    const md = exportResult('markdown', { columns: cols, rows: [[1, 'a|b']] });
    expect(md).toContain('a\\|b');
    expect(md.split('\n')[1]).toBe('| --- | --- |');
  });

  it('INSERT quotes strings, keeps numbers, uses NULL', () => {
    const sql = exportResult('insert', { columns: cols, rows, tableName: 'tickit.notes' });
    expect(sql).toContain("INSERT INTO tickit.notes (id, note) VALUES (1, 'hello');");
    expect(sql).toContain('VALUES (3, NULL);');
  });
});

describe('viewCell', () => {
  it('pretty-prints JSON/SUPER', () => {
    const v = viewCell('{"a":1}', 'super');
    expect(v.kind).toBe('json');
    expect(v.formatted).toContain('"a": 1');
  });

  it('hex-dumps varbyte', () => {
    const v = viewCell('\\x48656c6c6f', 'varbyte');
    expect(v.kind).toBe('hex');
    expect(v.formatted).toContain('48 65 6c 6c 6f');
  });

  it('renders NULL and plain text', () => {
    expect(viewCell(null, 'int4').kind).toBe('null');
    expect(viewCell('plain', 'varchar').kind).toBe('text');
  });
});

describe('toHexDump', () => {
  it('groups into 16-byte rows with offset', () => {
    const dump = toHexDump('00112233445566778899aabbccddeeff00');
    const lines = dump.split('\n');
    expect(lines[0]).toMatch(/^00000000  00 11 22/);
    expect(lines[1]).toMatch(/^00000010  00$/);
  });
});
