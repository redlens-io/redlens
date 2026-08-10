import { stripLiteralsAndComments } from '../mcp/sqlGuard';

/**
 * Unsafe-query warning (M2 `unsafe-query-warning`): flags statements that would
 * affect every row / drop objects, so RedLens can confirm before running.
 * Strips strings/comments first so a WHERE inside a literal doesn't fool it.
 */
export interface UnsafeVerdict {
  unsafe: boolean;
  reason?: string;
}

export function detectUnsafe(sql: string): UnsafeVerdict {
  const stripped = stripLiteralsAndComments(sql);
  const statements = stripped.split(';').map((s) => s.trim()).filter((s) => s.length > 0);
  for (const st of statements) {
    const upper = st.toUpperCase();
    const first = /^[A-Z]+/.exec(upper)?.[0] ?? '';
    if ((first === 'UPDATE' || first === 'DELETE') && !/\bWHERE\b/.test(upper)) {
      return { unsafe: true, reason: `${first} without a WHERE clause affects every row` };
    }
    if (first === 'TRUNCATE') {
      return { unsafe: true, reason: 'TRUNCATE removes every row of the table' };
    }
    if (first === 'DROP') {
      return { unsafe: true, reason: 'DROP permanently removes the object' };
    }
  }
  return { unsafe: false };
}
