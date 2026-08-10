/**
 * Value viewers (M1 `value-viewers`): given a cell value and its Redshift type,
 * produce a formatted representation for the detail panel. Pure/testable.
 */
import { categorizeTypeName } from '../transport/typeParser';

export type ViewerKind = 'json' | 'hex' | 'text' | 'number' | 'boolean' | 'null';

export interface CellView {
  kind: ViewerKind;
  /** Pretty, multi-line where useful (JSON indented, hex grouped). */
  formatted: string;
  /** Bytes/char length for the panel header. */
  length: number;
}

export function viewCell(value: unknown, typeName: string): CellView {
  if (value === null || value === undefined) {
    return { kind: 'null', formatted: 'NULL', length: 0 };
  }
  const category = categorizeTypeName(typeName);

  if (category === 'json' || (typeof value === 'object')) {
    const obj = typeof value === 'string' ? tryParse(value) : value;
    const formatted = JSON.stringify(obj, null, 2);
    return { kind: 'json', formatted, length: formatted.length };
  }
  if (category === 'binary') {
    const text = String(value);
    return { kind: 'hex', formatted: toHexDump(text), length: text.length };
  }
  if (typeof value === 'number' || category === 'number') {
    return { kind: 'number', formatted: String(value), length: String(value).length };
  }
  if (typeof value === 'boolean' || category === 'boolean') {
    return { kind: 'boolean', formatted: String(value), length: String(value).length };
  }
  const text = String(value);
  return { kind: 'text', formatted: text, length: text.length };
}

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Groups hex-ish input into 16-byte rows with an offset column. */
export function toHexDump(input: string): string {
  const clean = input.startsWith('\\x') ? input.slice(2) : input;
  const bytes = clean.match(/.{1,2}/g) ?? [];
  const lines: string[] = [];
  for (let i = 0; i < bytes.length; i += 16) {
    const chunk = bytes.slice(i, i + 16);
    const offset = i.toString(16).padStart(8, '0');
    lines.push(`${offset}  ${chunk.join(' ')}`);
  }
  return lines.join('\n');
}
