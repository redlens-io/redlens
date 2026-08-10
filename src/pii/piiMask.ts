/**
 * PII masking (M4 `pii-safe-mode`, catalog Part E): hides configured columns so
 * sensitive data is not shown in the grid/exports and — the important part —
 * never reaches the MCP bridge, so an AI agent/LLM sees masked values instead
 * of raw PII. Pure and testable; the extension supplies the config.
 */
export interface PiiConfig {
  /** Master switch (redlens.piiSafeMode). */
  enabled: boolean;
  /** Column-name patterns (redlens.piiColumns): substring match, or glob if it
   * contains `*`. Case-insensitive. e.g. ["email", "ssn", "*card*", "phone"]. */
  patterns: string[];
}

export const MASK_TOKEN = '••••';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A predicate matching a column name against the configured PII patterns. */
export function makePiiMatcher(patterns: string[]): (columnName: string) => boolean {
  const normalized = patterns.map((p) => p.trim().toLowerCase()).filter((p) => p.length > 0);
  const substrings = normalized.filter((p) => !p.includes('*'));
  const globs = normalized
    .filter((p) => p.includes('*'))
    .map((p) => new RegExp(`^${p.split('*').map(escapeRegExp).join('.*')}$`));
  return (columnName: string) => {
    const name = columnName.toLowerCase();
    return substrings.some((s) => name.includes(s)) || globs.some((re) => re.test(name));
  };
}

/** Mask one cell value. NULL stays NULL (absence is not the sensitive part). */
export function maskValue(value: unknown): unknown {
  return value === null || value === undefined ? value : MASK_TOKEN;
}

/** Indices of the columns that should be masked (empty when disabled). */
export function piiColumnIndices(columns: { name: string }[], config: PiiConfig): number[] {
  if (!config.enabled) {
    return [];
  }
  const match = makePiiMatcher(config.patterns);
  const out: number[] = [];
  columns.forEach((c, i) => {
    if (match(c.name)) {
      out.push(i);
    }
  });
  return out;
}

/**
 * Return rows with the PII columns masked. Returns the SAME rows reference when
 * nothing needs masking (disabled or no matching columns), so callers pay
 * nothing in the common case.
 */
export function maskRows(columns: { name: string }[], rows: unknown[][], config: PiiConfig): unknown[][] {
  const indices = piiColumnIndices(columns, config);
  if (indices.length === 0) {
    return rows;
  }
  const set = new Set(indices);
  return rows.map((row) => row.map((cell, i) => (set.has(i) ? maskValue(cell) : cell)));
}
