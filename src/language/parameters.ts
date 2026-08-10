import { stripLiteralsAndComments } from '../mcp/sqlGuard';

/**
 * SQL parameters (M2 `parameterized-queries`): `:name` placeholders that are
 * prompted for and substituted before running. `::type` casts are ignored via
 * the lookbehind (a `:` preceded by another `:` or a word char is not a param).
 */
const PARAM_RE = /(?<![:\w]):([a-zA-Z_]\w*)/g;

/** Unique parameter names in first-seen order, ignoring params inside literals. */
export function extractParams(sql: string): string[] {
  const stripped = stripLiteralsAndComments(sql);
  const names: string[] = [];
  for (const m of stripped.matchAll(PARAM_RE)) {
    const name = m[1] ?? '';
    if (!names.includes(name)) {
      names.push(name);
    }
  }
  return names;
}

/** Substitutes provided values as SQL literals (numbers raw, everything else quoted). */
export function substituteParams(sql: string, values: Record<string, string>): string {
  return sql.replace(PARAM_RE, (full, name: string) => {
    if (!(name in values)) {
      return full;
    }
    const v = values[name] ?? '';
    // Leave numeric values unquoted, but NOT leading-zero all-digit strings like
    // '01234' (ZIP/codes) — those must stay quoted or the zeros are lost (UXD-042).
    return /^-?(0|[1-9]\d*)(\.\d+)?$/.test(v) ? v : `'${v.replaceAll("'", "''")}'`;
  });
}
