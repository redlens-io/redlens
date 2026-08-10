/**
 * Result exporters (M1 `results-export` + `export-clipboard-formats`).
 * Pure string builders — the command layer writes to a file or the clipboard.
 */
import { cellText } from './gridModel';
import type { GridColumn } from './gridModel';

export type ExportFormat = 'csv' | 'tsv' | 'json' | 'markdown' | 'insert';

export interface ExportInput {
  columns: readonly GridColumn[];
  rows: readonly unknown[][];
  /** For INSERT: target table (schema.table); defaults to a placeholder. */
  tableName?: string;
}

function csvField(value: unknown, delimiter: string): string {
  if (value === null || value === undefined) {
    return '';
  }
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (text.includes(delimiter) || text.includes('"') || text.includes('\n')) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

function sqlValue(value: unknown): string {
  if (value === null || value === undefined) {
    return 'NULL';
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return `'${text.replaceAll("'", "''")}'`;
}

export function exportResult(format: ExportFormat, input: ExportInput): string {
  const headers = input.columns.map((c) => c.name);
  switch (format) {
    case 'csv':
    case 'tsv': {
      const d = format === 'csv' ? ',' : '\t';
      const lines = [headers.map((h) => csvField(h, d)).join(d)];
      for (const row of input.rows) {
        lines.push(row.map((cell) => csvField(cell, d)).join(d));
      }
      return lines.join('\n');
    }
    case 'json': {
      const objects = input.rows.map((row) => {
        const obj: Record<string, unknown> = {};
        headers.forEach((h, i) => {
          obj[h] = row[i] ?? null;
        });
        return obj;
      });
      return JSON.stringify(objects, null, 2);
    }
    case 'markdown': {
      // A table cell may not contain a raw `|` (escape it) or a newline (would
      // split the row across physical lines and break the table) — collapse
      // newlines to a space. Applies to headers and body alike.
      const mdCell = (s: string): string => s.replaceAll('|', '\\|').replace(/\r\n?|\n/g, ' ');
      const head = `| ${headers.map(mdCell).join(' | ')} |`;
      const sep = `| ${headers.map(() => '---').join(' | ')} |`;
      const body = input.rows.map((row) => `| ${row.map((c) => mdCell(cellText(c))).join(' | ')} |`);
      return [head, sep, ...body].join('\n');
    }
    case 'insert': {
      const table = input.tableName ?? 'target_table';
      const cols = headers.join(', ');
      return input.rows
        .map((row) => `INSERT INTO ${table} (${cols}) VALUES (${row.map(sqlValue).join(', ')});`)
        .join('\n');
    }
  }
}

export const EXPORT_EXTENSIONS: Record<ExportFormat, string> = {
  csv: 'csv',
  tsv: 'tsv',
  json: 'json',
  markdown: 'md',
  insert: 'sql',
};
