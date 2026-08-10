/**
 * SQL notebook model (M5 `sql-notebooks`): the pure serialize/deserialize of the
 * `.rlnb` file format and the result→markdown formatting. Kept free of vscode
 * deps so it is unit-tested directly; the provider wraps these into the VS Code
 * NotebookData / NotebookController types.
 */
import { exportResult } from '../grid/exporters';
import type { GridColumn } from '../grid/gridModel';

export interface RawCell {
  kind: 'code' | 'markup';
  value: string;
  language: string;
}

interface NotebookFile {
  version: number;
  cells: RawCell[];
}

/** Parse a `.rlnb` file. Tolerates empty files and non-JSON (treated as one
 * SQL cell), so a plain `.sql` opened as a notebook still works. */
export function decodeNotebook(text: string): RawCell[] {
  if (text.trim() === '') {
    return [{ kind: 'code', value: '', language: 'sql' }];
  }
  try {
    const parsed = JSON.parse(text) as Partial<NotebookFile>;
    if (Array.isArray(parsed.cells)) {
      // Guard each element: a single null/non-object cell must not discard the
      // whole notebook (it would fall back to the raw JSON as one cell).
      return (parsed.cells as unknown[])
        .filter((c): c is Partial<RawCell> => typeof c === 'object' && c !== null)
        .map((c): RawCell => ({
          kind: c.kind === 'markup' ? 'markup' : 'code',
          value: typeof c.value === 'string' ? c.value : '',
          language: typeof c.language === 'string' ? c.language : c.kind === 'markup' ? 'markdown' : 'sql',
        }));
    }
  } catch {
    /* not JSON — fall through and treat the whole file as one SQL cell */
  }
  return [{ kind: 'code', value: text, language: 'sql' }];
}

export function encodeNotebook(cells: RawCell[]): string {
  const file: NotebookFile = { version: 1, cells };
  return JSON.stringify(file, null, 2);
}

/** Render a result as a markdown table with a summary line, for cell output. */
export function resultToMarkdown(
  columns: { name: string; typeName?: string }[],
  rows: unknown[][],
  meta: { rowCount: number; durationMs: number; truncated: boolean },
): string {
  if (columns.length === 0) {
    return `_${meta.rowCount} row(s) · ${meta.durationMs} ms_`;
  }
  const gridColumns: GridColumn[] = columns.map((c) => ({ name: c.name, typeName: c.typeName ?? 'text' }));
  const CAP = 200; // keep cell output readable; note when truncated
  const shown = rows.slice(0, CAP);
  const table = exportResult('markdown', { columns: gridColumns, rows: shown, tableName: 'result' });
  const notes = [
    `${meta.rowCount.toLocaleString()} row(s)`,
    `${meta.durationMs.toLocaleString()} ms`,
    rows.length > CAP ? `showing first ${CAP}` : '',
    meta.truncated ? 'truncated at 50,000' : '',
  ].filter(Boolean).join(' · ');
  return `${table}\n\n_${notes}_`;
}
