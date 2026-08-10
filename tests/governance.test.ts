import { describe, expect, it } from 'vitest';
import {
  parseDatashares,
  parseDatashareObjects,
  parseDatashareConsumers,
  parseUsers,
  parseRoles,
  datashareObjectQuery,
  isRedshiftKind,
  SqlGovernanceSource,
  UnsupportedGovernanceSource,
  SQL_DATASHARES,
  SQL_USERS,
  SQL_ROLES,
  sqlDatashareObjects,
  type Datashare,
} from '../src/redshift/governance';
import { DemoGovernanceSource, DEMO_NAMESPACE } from '../src/redshift/governanceFixtures';

describe('governance parsers', () => {
  it('parses datashares and normalizes direction', () => {
    const rows = [
      ['sales_share', 'OUTBOUND', '123', 'prod-ns', 'f'],
      ['mkt_in', 'inbound', '', '', 't'],
    ];
    const shares = parseDatashares(rows);
    expect(shares[0]).toMatchObject({ name: 'sales_share', direction: 'outbound', publicAccessible: false });
    expect(shares[1]).toMatchObject({ name: 'mkt_in', direction: 'inbound', publicAccessible: true });
    // Empty producer fields become undefined, not ''.
    expect(shares[1]!.producerAccount).toBeUndefined();
  });

  it('accepts every boolean encoding Redshift returns (t/f, true/false, 1/0)', () => {
    const t = parseDatashares([['a', 'outbound', '', '', true]])[0]!.publicAccessible;
    const f = parseDatashares([['a', 'outbound', '', '', 0]])[0]!.publicAccessible;
    const one = parseUsers([['u', 1, '0']])[0]!;
    expect(t).toBe(true);
    expect(f).toBe(false);
    expect(one.superuser).toBe(true);
    expect(one.createDb).toBe(false);
  });

  it('parses shared objects and consumers', () => {
    expect(parseDatashareObjects([['table', 'tickit.sales']])[0]).toEqual({ objectType: 'table', objectName: 'tickit.sales' });
    const c = parseDatashareConsumers([['555', 'bi-ns', 'us-east-1']])[0];
    expect(c).toEqual({ consumerAccount: '555', consumerNamespace: 'bi-ns', consumerRegion: 'us-east-1' });
  });

  it('flags federated identities and rdsdb, and plain users stay plain', () => {
    const users = parseUsers([
      ['analyst', 'f', 'f'],
      ['IAMR:readonly', 'f', 'f'],
      ['AWSIDC:alice@corp.com', 'f', 'f'],
      ['rdsdb', 't', 't'],
    ]);
    expect(users[0]!.federated).toBe(false);
    expect(users[0]!.system).toBe(false);
    expect(users[1]!.federated).toBe(true);
    expect(users[2]!.federated).toBe(true);
    expect(users[3]!.system).toBe(true);
  });

  it('flags built-in sys:* roles', () => {
    const roles = parseRoles([['sys:secadmin', ''], ['analyst_role', 'admin']]);
    expect(roles[0]).toMatchObject({ name: 'sys:secadmin', system: true, owner: undefined });
    expect(roles[1]).toMatchObject({ name: 'analyst_role', system: false, owner: 'admin' });
  });
});

describe('datashareObjectQuery', () => {
  const outbound: Datashare = { name: 'sales_share', direction: 'outbound', producerNamespace: 'ns', publicAccessible: false };
  const inbound: Datashare = { name: 'mkt_in', direction: 'inbound', producerNamespace: 'mkt-ns', publicAccessible: false };

  it('outbound table → runnable local 2-part query', () => {
    const q = datashareObjectQuery(outbound, { objectType: 'table', objectName: 'tickit.sales' });
    expect(q).toBe('SELECT * FROM tickit.sales LIMIT 100;');
  });

  it('inbound table → 3-part with a marked placeholder and the CREATE DATABASE hint', () => {
    const q = datashareObjectQuery(inbound, { objectType: 'table', objectName: 'mkt.campaigns' });
    expect(q).toContain('<consumer_db>.mkt.campaigns');
    expect(q).toContain('FROM DATASHARE mkt_in OF NAMESPACE');
    expect(q).toContain('mkt-ns');
  });

  it('a shared schema is not directly queryable → guidance comment only', () => {
    const q = datashareObjectQuery(outbound, { objectType: 'schema', objectName: 'tickit' });
    expect(q.startsWith('--')).toBe(true);
    expect(q).not.toContain('SELECT');
  });
});

describe('SqlGovernanceSource', () => {
  it('fires the expected SQL and maps rows through the parsers', async () => {
    const seen: string[] = [];
    const rowsFor = (sql: string): unknown[][] => {
      if (sql === SQL_DATASHARES) return [['s', 'outbound', '', '', 'f']];
      if (sql === SQL_USERS) return [['admin', 't', 't']];
      if (sql === SQL_ROLES) return [['analyst_role', 'admin']];
      if (sql === sqlDatashareObjects('s')) return [['table', 'a.b']];
      if (sql === 'SELECT current_namespace') return [['GUID-123']];
      return [];
    };
    const src = new SqlGovernanceSource(async (sql) => {
      seen.push(sql);
      return { columns: [], rows: rowsFor(sql) };
    });
    expect((await src.listDatashares())[0]!.name).toBe('s');
    expect((await src.listUsers())[0]!.superuser).toBe(true);
    expect((await src.listRoles())[0]!.owner).toBe('admin');
    expect((await src.listDatashareObjects('s'))[0]!.objectName).toBe('a.b');
    expect(await src.currentNamespace()).toBe('GUID-123');
    expect(src.supported).toBe(true);
    expect(seen).toContain(SQL_DATASHARES);
  });

  it('escapes single quotes in the share name (no SQL injection through the tree)', () => {
    expect(sqlDatashareObjects("o'brien")).toContain("share_name = 'o''brien'");
  });
});

describe('UnsupportedGovernanceSource (plain Postgres)', () => {
  it('is not supported and every read rejects', async () => {
    const src = new UnsupportedGovernanceSource();
    expect(src.supported).toBe(false);
    await expect(src.listDatashares()).rejects.toThrow(/Redshift/);
    await expect(src.listUsers()).rejects.toThrow(/Redshift/);
  });
});

describe('isRedshiftKind', () => {
  it('treats every kind but compat/demo as Redshift', () => {
    for (const k of ['direct', 'data-api', 'direct+ssh']) expect(isRedshiftKind(k)).toBe(true);
    expect(isRedshiftKind('compat')).toBe(false);
    expect(isRedshiftKind('demo')).toBe(false);
  });
});

describe('DemoGovernanceSource', () => {
  it('exposes a full, self-consistent fixture set', async () => {
    const src = new DemoGovernanceSource();
    const shares = await src.listDatashares();
    expect(shares.map((s) => s.direction)).toContain('inbound');
    expect(shares.map((s) => s.direction)).toContain('outbound');
    // Every share resolves objects (or an explicit empty list) and consumers.
    for (const s of shares) {
      expect(Array.isArray(await src.listDatashareObjects(s.name))).toBe(true);
      expect(Array.isArray(await src.listDatashareConsumers(s.name))).toBe(true);
    }
    const users = await src.listUsers();
    expect(users.some((u) => u.federated)).toBe(true);
    expect(users.some((u) => u.system)).toBe(true);
    expect(users.some((u) => u.superuser)).toBe(true);
    expect((await src.listRoles()).some((r) => r.system)).toBe(true);
    expect(await src.currentNamespace()).toBe(DEMO_NAMESPACE);
  });
});
