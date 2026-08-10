import { describe, expect, it } from 'vitest';
import { decodeNotebook, encodeNotebook, resultToMarkdown, type RawCell } from '../src/notebook/notebookModel';

describe('decode/encode notebook (.rlnb)', () => {
  it('round-trips cells through JSON', () => {
    const cells: RawCell[] = [
      { kind: 'markup', value: '# Sales report', language: 'markdown' },
      { kind: 'code', value: 'SELECT 1', language: 'sql' },
    ];
    expect(decodeNotebook(encodeNotebook(cells))).toEqual(cells);
  });

  it('an empty file yields a single empty SQL cell', () => {
    expect(decodeNotebook('')).toEqual([{ kind: 'code', value: '', language: 'sql' }]);
  });

  it('a plain .sql (non-JSON) file becomes one SQL cell', () => {
    expect(decodeNotebook('SELECT * FROM t;')).toEqual([{ kind: 'code', value: 'SELECT * FROM t;', language: 'sql' }]);
  });

  it('skips a null/non-object cell without discarding the valid ones', () => {
    const text = '{"cells":[{"kind":"code","value":"SELECT 1","language":"sql"},null,42]}';
    expect(decodeNotebook(text)).toEqual([{ kind: 'code', value: 'SELECT 1', language: 'sql' }]);
  });

  it('tolerates missing/odd fields', () => {
    const text = JSON.stringify({ cells: [{ kind: 'code' }, { value: 'x' }, { kind: 'markup', value: 'y' }] });
    expect(decodeNotebook(text)).toEqual([
      { kind: 'code', value: '', language: 'sql' },
      { kind: 'code', value: 'x', language: 'sql' },
      { kind: 'markup', value: 'y', language: 'markdown' },
    ]);
  });
});

describe('resultToMarkdown', () => {
  it('renders a markdown table with a summary line', () => {
    const md = resultToMarkdown(
      [{ name: 'id', typeName: 'int4' }, { name: 'name', typeName: 'varchar' }],
      [[1, 'a'], [2, 'b']],
      { rowCount: 2, durationMs: 5, truncated: false },
    );
    expect(md).toContain('| id | name |');
    expect(md).toContain('| 1 | a |');
    expect(md).toContain('2 row(s)');
    expect(md).toContain('5 ms');
  });

  it('notes when the output is capped and when the result was truncated', () => {
    const rows = Array.from({ length: 250 }, (_, i) => [i]);
    const md = resultToMarkdown([{ name: 'n' }], rows, { rowCount: 60000, durationMs: 9, truncated: true });
    expect(md).toContain('showing first 200');
    expect(md).toContain('truncated at 50,000');
  });

  it('handles a no-column result (e.g. a DDL statement)', () => {
    expect(resultToMarkdown([], [], { rowCount: 0, durationMs: 3, truncated: false })).toBe('_0 row(s) · 3 ms_');
  });

  it('neutralizes newlines and pipes in values AND headers so the table never breaks', () => {
    const md = resultToMarkdown(
      [{ name: 'a|b' }, { name: 'note' }],
      [['x', 'line1\nline2'], ['p|q', 'ok']],
      { rowCount: 2, durationMs: 1, truncated: false },
    );
    // Every table line has the same number of column separators (no split rows).
    const lines = md.split('\n').filter((l) => l.startsWith('|'));
    const pipeCounts = new Set(lines.map((l) => (l.match(/(?<!\\)\|/g) ?? []).length));
    expect(pipeCounts.size).toBe(1); // header, separator, and all body rows align
    expect(md).not.toMatch(/\n[^|_].*line2/); // "line2" never starts its own line
  });
});
