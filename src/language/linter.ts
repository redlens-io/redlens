import { maskSql, splitStatements } from './sqlText';

/**
 * SQL linter (M2 `sql-linting`): produces diagnostics with original-coordinate
 * offsets. Rules are intentionally conservative (no false positives): unsafe
 * destructive statements (warning) and SELECT * (hint). The provider maps these
 * to VS Code diagnostics + quick-fixes.
 */
export type LintSeverity = 'warning' | 'info' | 'hint';

export interface LintIssue {
  start: number;
  end: number;
  severity: LintSeverity;
  message: string;
  code: string;
}

export function lintSql(sql: string): LintIssue[] {
  const issues: LintIssue[] = [];
  for (const st of splitStatements(sql)) {
    const masked = maskSql(st.text).toUpperCase();
    const first = /^\s*([A-Z]+)/.exec(masked)?.[1] ?? '';

    // Require an actual condition after WHERE, not just the keyword: `WHERE ;`
    // (what the quick-fix used to leave) must still warn — it clears the squiggle
    // otherwise while leaving unrunnable SQL (UXD-027).
    if ((first === 'UPDATE' || first === 'DELETE') && !/\bWHERE\s+[^\s;]/.test(masked)) {
      issues.push({ start: st.start, end: st.end, severity: 'warning', code: `unsafe-${first.toLowerCase()}`, message: `${first} without a WHERE clause affects every row` });
    }
    if (first === 'TRUNCATE') {
      issues.push({ start: st.start, end: st.end, severity: 'warning', code: 'unsafe-truncate', message: 'TRUNCATE removes every row' });
    }
    const star = /\bSELECT\s+\*/.exec(masked);
    if (star !== null) {
      const at = st.start + star.index + star[0].length - 1;
      issues.push({ start: at, end: at + 1, severity: 'hint', code: 'select-star', message: 'SELECT * — list columns explicitly for stable results and less scanned data' });
    }
  }
  return issues;
}
