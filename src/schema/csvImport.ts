/**
 * csv-import-wizard (M7): turn a CSV/TSV file into INSERT statements for a table.
 * Pure/testable; reuses the tested clipboard parser. The command reads the file
 * and opens the generated SQL for review before it runs anything.
 */
import { parseClipboardRows } from '../edit/clipboardRows';

function ident(name: string): string {
  return /^[a-z_][a-z0-9_$]*$/.test(name) ? name : `"${name.replaceAll('"', '""')}"`;
}

function literal(cell: string): string {
  if (cell === '') return 'NULL';
  // Numeric — leave unquoted. Exclude leading-zero integers ("007", "0123"): those
  // are almost always identifiers (ZIP, phone, codes) and unquoting would drop the
  // zeros / change the type. A lone "0" and decimals like "0.5" are still numeric.
  if (/^-?(0|[1-9]\d*)(\.\d+)?$/.test(cell)) return cell;
  if (/^(true|false)$/i.test(cell)) return cell.toLowerCase();
  return `'${cell.replaceAll("'", "''")}'`;
}

export interface CsvImportOptions {
  hasHeader: boolean;
  /** cap the number of value rows per statement / total */
  maxRows?: number;
}

export function csvToInserts(text: string, schema: string, table: string, opts: CsvImportOptions): string {
  const rows = parseClipboardRows(text);
  if (rows.length === 0) {
    return '-- empty CSV — nothing to import';
  }
  const header = opts.hasHeader ? rows[0]! : rows[0]!.map((_, i) => `col${i + 1}`);
  const dataRows = opts.hasHeader ? rows.slice(1) : rows;
  const capped = opts.maxRows !== undefined ? dataRows.slice(0, opts.maxRows) : dataRows;
  if (capped.length === 0) {
    return `-- ${schema}.${table}: the CSV has a header but no data rows`;
  }
  const width = header.length;
  const cols = header.map(ident).join(', ');
  const valueRows = capped.map((r) => {
    // pad/truncate each row to the header width so the INSERT stays valid.
    const cells = Array.from({ length: width }, (_, i) => literal(r[i] ?? ''));
    return `  (${cells.join(', ')})`;
  });
  const omitted = opts.maxRows !== undefined && dataRows.length > opts.maxRows
    ? `\n-- (${dataRows.length - opts.maxRows} more rows omitted — raise the limit to include them)`
    : '';
  return `INSERT INTO ${ident(schema)}.${ident(table)} (${cols}) VALUES\n${valueRows.join(',\n')};${omitted}`;
}
