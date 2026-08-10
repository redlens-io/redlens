/**
 * mock-data-generator (M7): generate a batch of INSERT rows with plausible fake
 * values by column type. Pure and DETERMINISTIC (seeded PRNG) so tests are
 * stable and re-runs reproduce; the command writes the SQL to a new editor.
 */
export interface MockColumn {
  name: string;
  typeName: string;
}

function ident(name: string): string {
  return /^[a-z_][a-z0-9_$]*$/.test(name) ? name : `"${name.replaceAll('"', '""')}"`;
}

/** mulberry32 — tiny deterministic PRNG. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NAMES = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel'];

function sqlLiteral(value: string | number | boolean | null): string {
  if (value === null) return 'NULL';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return `'${value.replaceAll("'", "''")}'`;
}

function mockValue(typeName: string, rand: () => number, row: number, col: number): string | number | boolean {
  const t = typeName.toLowerCase();
  if (/int|serial/.test(t)) return Math.floor(rand() * 1000);
  if (/numeric|decimal|real|double|float|money/.test(t)) return Math.round(rand() * 100000) / 100;
  if (/bool/.test(t)) return rand() < 0.5;
  if (/timestamp|datetime/.test(t)) {
    const m = 1 + Math.floor(rand() * 12);
    const d = 1 + Math.floor(rand() * 28);
    const h = Math.floor(rand() * 24);
    return `2026-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')} ${String(h).padStart(2, '0')}:00:00`;
  }
  if (/date/.test(t)) {
    const m = 1 + Math.floor(rand() * 12);
    const d = 1 + Math.floor(rand() * 28);
    return `2026-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  // text-ish default
  return `${NAMES[Math.floor(rand() * NAMES.length)]}_${row}_${col}`;
}

export function generateMockInserts(
  schema: string,
  table: string,
  columns: MockColumn[],
  count: number,
  seed = 1,
): string {
  if (columns.length === 0 || count <= 0) {
    return `-- nothing to generate for ${schema}.${table}`;
  }
  const rand = prng(seed);
  const colList = columns.map((c) => ident(c.name)).join(', ');
  const rows: string[] = [];
  for (let r = 0; r < count; r++) {
    const values = columns.map((c, ci) => sqlLiteral(mockValue(c.typeName, rand, r, ci)));
    rows.push(`  (${values.join(', ')})`);
  }
  return `INSERT INTO ${ident(schema)}.${ident(table)} (${colList}) VALUES\n${rows.join(',\n')};`;
}
