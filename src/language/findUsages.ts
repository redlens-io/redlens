/**
 * find-usages (M2): locate references of an identifier across text. Pure —
 * the command feeds it .sql file contents and shows results in a QuickPick.
 * Word-boundary match, case-insensitive, ignores matches inside string literals
 * via the caller passing masked text when desired.
 */
export interface UsageMatch {
  line: number; // 0-based
  column: number;
  lineText: string;
}

export function findMatches(text: string, term: string): UsageMatch[] {
  if (term.trim().length === 0) {
    return [];
  }
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`\\b${escaped}\\b`, 'gi');
  const matches: UsageMatch[] = [];
  const lines = text.split('\n');
  lines.forEach((lineText, line) => {
    for (const m of lineText.matchAll(re)) {
      matches.push({ line, column: m.index ?? 0, lineText: lineText.trim() });
    }
  });
  return matches;
}
