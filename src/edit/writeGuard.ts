import { stripLiteralsAndComments } from '../mcp/sqlGuard';

/**
 * Write guard (M4 `read-only-toggle` + `prod-safeguard`): classifies SQL as a
 * write and decides whether to allow/confirm it given the connection's
 * read-only and production flags. Pure/testable; strips literals so a keyword
 * inside a string doesn't trip it.
 */
const WRITE_KEYWORDS = new Set([
  'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'DROP', 'CREATE', 'ALTER',
  'COPY', 'UNLOAD', 'GRANT', 'REVOKE', 'VACUUM', 'ANALYZE', 'MERGE', 'CALL',
]);

export function isWrite(sql: string): boolean {
  const stripped = stripLiteralsAndComments(sql);
  return stripped
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .some((st) => WRITE_KEYWORDS.has(/^[A-Za-z]+/.exec(st.toUpperCase())?.[0] ?? ''));
}

export interface WriteFlags {
  readOnly: boolean;
  production: boolean;
}

export interface RunDecision {
  allow: boolean;
  needsConfirm: boolean;
  reason?: string;
}

export function decideRun(sql: string, flags: WriteFlags): RunDecision {
  if (!isWrite(sql)) {
    return { allow: true, needsConfirm: false };
  }
  if (flags.readOnly) {
    return { allow: false, needsConfirm: false, reason: 'the connection is marked READ-ONLY — writes are blocked' };
  }
  if (flags.production) {
    return { allow: true, needsConfirm: true, reason: 'this is a PRODUCTION connection' };
  }
  return { allow: true, needsConfirm: false };
}
