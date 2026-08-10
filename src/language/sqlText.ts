/**
 * Length-preserving SQL masker: replaces the CONTENT of string literals,
 * quoted identifiers and comments with spaces while keeping every character
 * position — so offsets in the masked text map 1:1 to the original. Used by the
 * linter (needs ranges) and statement splitting.
 */
export function maskSql(sql: string): string {
  const out = sql.split('');
  let i = 0;
  const blank = (from: number, to: number) => {
    for (let k = from; k < to && k < out.length; k++) {
      if (out[k] !== '\n') {
        out[k] = ' ';
      }
    }
  };
  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (ch === "'" || ch === '"') {
      const quote = ch;
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === quote && sql[j + 1] === quote) {
          j += 2;
        } else if (sql[j] === quote) {
          j++;
          break;
        } else {
          j++;
        }
      }
      blank(i + 1, j - 1);
      i = j;
    } else if (ch === '-' && next === '-') {
      let j = i;
      while (j < sql.length && sql[j] !== '\n') {
        j++;
      }
      blank(i, j);
      i = j;
    } else if (ch === '/' && next === '*') {
      let j = i + 2;
      while (j < sql.length && !(sql[j] === '*' && sql[j + 1] === '/')) {
        j++;
      }
      blank(i, j + 2);
      i = j + 2;
    } else {
      i++;
    }
  }
  return out.join('');
}

export interface Statement {
  start: number;
  end: number;
  text: string; // original (unmasked) text of the statement
}

/** Splits SQL into statements with original-coordinate offsets (mask-aware). */
export function splitStatements(sql: string): Statement[] {
  const masked = maskSql(sql);
  const statements: Statement[] = [];
  let start = 0;
  for (let i = 0; i <= masked.length; i++) {
    if (i === masked.length || masked[i] === ';') {
      const raw = sql.slice(start, i);
      if (raw.trim().length > 0) {
        const leading = raw.length - raw.trimStart().length;
        const s = start + leading;
        const e = start + raw.trimEnd().length;
        statements.push({ start: s, end: e, text: sql.slice(s, e) });
      }
      start = i + 1;
    }
  }
  return statements;
}
