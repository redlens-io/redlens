/**
 * Read-only guard for MCP-executed SQL (PLAN §5.4, non-negotiable):
 * belt = this parser (single statement, allowlisted first keyword, no
 * transaction-breakers); suspenders = the engine-level READ ONLY transaction
 * the bridge wraps around every statement. NEVER regex-on-raw-sql alone —
 * strings/comments are stripped first (the archived reference Postgres MCP
 * server was bypassed exactly there).
 */

const ALLOWED_FIRST_KEYWORDS = new Set(['SELECT', 'WITH', 'SHOW', 'EXPLAIN', 'VALUES', 'TABLE']);
const BREAKER_KEYWORDS = new Set(['COMMIT', 'ROLLBACK', 'BEGIN', 'START', 'END', 'ABORT', 'SET']);

/** Replaces string literals, quoted identifiers and comments with spaces (length-preserving-ish). */
export function stripLiteralsAndComments(sql: string): string {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i] ?? '';
    const next = sql[i + 1] ?? '';
    if (ch === "'") {
      i++;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          i += 2;
        } else if (sql[i] === "'") {
          i++;
          break;
        } else {
          i++;
        }
      }
      out += ' ';
    } else if (ch === '"') {
      i++;
      while (i < sql.length && sql[i] !== '"') {
        i++;
      }
      i++;
      out += ' ';
    } else if (ch === '-' && next === '-') {
      while (i < sql.length && sql[i] !== '\n') {
        i++;
      }
    } else if (ch === '/' && next === '*') {
      i += 2;
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) {
        i++;
      }
      i += 2;
      out += ' ';
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

export interface GuardVerdict {
  ok: boolean;
  reason?: string;
}

export function checkReadOnlySql(sql: string): GuardVerdict {
  const stripped = stripLiteralsAndComments(sql);

  const statements = stripped
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (statements.length === 0) {
    return { ok: false, reason: 'empty SQL' };
  }
  if (statements.length > 1) {
    return { ok: false, reason: 'multiple statements are not allowed through the read-only MCP tool' };
  }

  const statement = statements[0] ?? '';
  const firstWord = /^[A-Za-z]+/.exec(statement)?.[0]?.toUpperCase() ?? '';
  if (BREAKER_KEYWORDS.has(firstWord)) {
    return { ok: false, reason: `"${firstWord}" is not allowed — it would break the read-only transaction wrapper` };
  }
  if (!ALLOWED_FIRST_KEYWORDS.has(firstWord)) {
    return {
      ok: false,
      reason: `read-only MCP tool accepts SELECT / WITH / SHOW / EXPLAIN / VALUES / TABLE only (got "${firstWord}"). Writes will arrive as an explicit opt-in tool`,
    };
  }
  return { ok: true };
}
