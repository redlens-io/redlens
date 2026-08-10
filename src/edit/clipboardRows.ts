/**
 * Clipboard → rows parser (M4 `paste-csv-grid`): turns pasted TSV or CSV text
 * into a matrix of cell strings so the grid can add them as new rows. Pure and
 * testable. Delimiter is auto-detected: a tab anywhere → TSV (Excel/other grid
 * paste), otherwise CSV with standard quoting (RFC-4180-ish: `"` quotes fields,
 * `""` is an escaped quote, quoted fields may contain the delimiter/newlines).
 */
export function parseClipboardRows(text: string): string[][] {
  const trimmed = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n$/, '');
  if (trimmed === '') {
    return [];
  }
  const delimiter = trimmed.includes('\t') ? '\t' : ',';
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (trimmed[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = false; }
      } else {
        field += ch;
      }
    } else if (ch === '"' && delimiter === ',') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field); field = '';
    } else if (ch === '\n') {
      row.push(field); field = '';
      rows.push(row); row = [];
    } else {
      field += ch;
    }
  }
  row.push(field);
  rows.push(row);
  return rows;
}
