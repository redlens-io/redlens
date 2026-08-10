import { describe, expect, it } from 'vitest';
import {
  sqlShowGrants,
  sqlRelationPrivileges,
  sqlColumnPrivileges,
  parseShowGrants,
  parseColumnPrivileges,
  generateGrant,
  generateRevoke,
  generateGrantScript,
  objectRefSql,
  objectLabel,
  ident,
  type ObjectRef,
  type PrivilegeGrant,
} from '../src/redshift/privileges';
import { SqlGovernanceSource } from '../src/redshift/governance';
import { DemoGovernanceSource } from '../src/redshift/governanceFixtures';

const TABLE: ObjectRef = { kind: 'table', schema: 'tickit', name: 'sales' };
const SCHEMA: ObjectRef = { kind: 'schema', schema: 'tickit' };

describe('privilege SQL', () => {
  it('builds SHOW GRANTS for table and schema', () => {
    expect(sqlShowGrants(TABLE)).toBe('SHOW GRANTS ON TABLE tickit.sales');
    expect(sqlShowGrants(SCHEMA)).toBe('SHOW GRANTS ON SCHEMA tickit');
  });
  it('SVV fallback and column probe filter by object', () => {
    expect(sqlRelationPrivileges(TABLE)).toContain("relation_name = 'sales'");
    expect(sqlColumnPrivileges(TABLE)).toContain('svv_column_privileges');
  });
  it('objectRefSql / objectLabel', () => {
    expect(objectRefSql(TABLE)).toBe('TABLE tickit.sales');
    expect(objectRefSql(SCHEMA)).toBe('SCHEMA tickit');
    expect(objectLabel(TABLE)).toBe('tickit.sales');
  });
});

describe('parseShowGrants (maps by column name, order-independent)', () => {
  const columns = [
    { name: 'database_name' },
    { name: 'privilege_type' },
    { name: 'identity_name' },
    { name: 'identity_type' },
    { name: 'admin_option' },
  ];
  it('normalizes grantee type and PUBLIC, honors admin_option', () => {
    const rows = [
      ['dev', 'SELECT', 'analyst_role', 'role', true],
      ['dev', 'select', 'bob', 'user', 'f'],
      ['dev', 'USAGE', 'ignored', 'public', false],
    ];
    const g = parseShowGrants(columns, rows);
    expect(g[0]).toEqual({ grantee: 'analyst_role', granteeType: 'role', privilege: 'SELECT', withGrantOption: true });
    expect(g[1]).toMatchObject({ grantee: 'bob', granteeType: 'user', privilege: 'SELECT', withGrantOption: false });
    expect(g[2]).toMatchObject({ grantee: 'PUBLIC', granteeType: 'public' });
  });
  it('skips rows without an identity or privilege (headers/summaries)', () => {
    expect(parseShowGrants(columns, [['dev', '', '', 'user', false]])).toHaveLength(0);
  });
});

describe('parseColumnPrivileges', () => {
  it('tags the column', () => {
    const g = parseColumnPrivileges([['analyst_role', 'role', 'SELECT', 'pricepaid', 'f']]);
    expect(g[0]).toEqual({ grantee: 'analyst_role', granteeType: 'role', privilege: 'SELECT', column: 'pricepaid', withGrantOption: false });
  });
});

describe('GRANT/REVOKE generation', () => {
  it('role/group/public/user grantee clauses', () => {
    const base = { privilege: 'SELECT', withGrantOption: false } as const;
    expect(generateGrant(TABLE, { ...base, grantee: 'r', granteeType: 'role' })).toBe('GRANT SELECT ON TABLE tickit.sales TO ROLE r;');
    expect(generateGrant(TABLE, { ...base, grantee: 'g', granteeType: 'group' })).toBe('GRANT SELECT ON TABLE tickit.sales TO GROUP g;');
    expect(generateGrant(TABLE, { ...base, grantee: 'PUBLIC', granteeType: 'public' })).toBe('GRANT SELECT ON TABLE tickit.sales TO PUBLIC;');
    expect(generateGrant(TABLE, { ...base, grantee: 'bob', granteeType: 'user' })).toBe('GRANT SELECT ON TABLE tickit.sales TO bob;');
  });
  it('column grant and WITH GRANT OPTION', () => {
    const g: PrivilegeGrant = { grantee: 'r', granteeType: 'role', privilege: 'SELECT', withGrantOption: true, column: 'pricepaid' };
    expect(generateGrant(TABLE, g)).toBe('GRANT SELECT ( pricepaid ) ON TABLE tickit.sales TO ROLE r WITH GRANT OPTION;');
  });
  it('REVOKE mirrors GRANT without the grant option', () => {
    const g: PrivilegeGrant = { grantee: 'r', granteeType: 'role', privilege: 'SELECT', withGrantOption: true };
    expect(generateRevoke(TABLE, g)).toBe('REVOKE SELECT ON TABLE tickit.sales FROM ROLE r;');
  });
  it('reconstruct script has a header + owner/superuser caveat, and an empty case', () => {
    const script = generateGrantScript(TABLE, [
      { grantee: 'PUBLIC', granteeType: 'public', privilege: 'SELECT', withGrantOption: false },
    ]);
    expect(script).toContain('-- Grants on tickit.sales');
    expect(script).toContain('implicit rights');
    expect(script).toContain('GRANT SELECT ON TABLE tickit.sales TO PUBLIC;');
    expect(generateGrantScript(TABLE, [])).toContain('No explicit grants');
  });
});

describe('ident quoting', () => {
  it('leaves safe identifiers bare, quotes the rest', () => {
    expect(ident('sales')).toBe('sales');
    expect(ident('Weird Name')).toBe('"Weird Name"');
    expect(ident('a"b')).toBe('"a""b"');
  });
});

describe('SqlGovernanceSource.objectPrivileges', () => {
  it('uses SHOW GRANTS then merges column grants', async () => {
    const src = new SqlGovernanceSource(async (sql) => {
      if (sql === sqlShowGrants(TABLE)) {
        return {
          columns: [{ name: 'identity_name' }, { name: 'identity_type' }, { name: 'privilege_type' }, { name: 'admin_option' }],
          rows: [['analyst_role', 'role', 'SELECT', 'f']],
        };
      }
      if (sql === sqlColumnPrivileges(TABLE)) {
        return { columns: [], rows: [['analyst_role', 'role', 'SELECT', 'pricepaid', 'f']] };
      }
      return { columns: [], rows: [] };
    });
    const res = await src.objectPrivileges(TABLE);
    expect(res.source).toBe('show-grants');
    expect(res.columnGrantsBestEffort).toBe(false);
    expect(res.grants).toHaveLength(2);
    expect(res.grants.some((g) => g.column === 'pricepaid')).toBe(true);
  });

  it('falls back to SVV when SHOW GRANTS throws, and flags column probe failure', async () => {
    const src = new SqlGovernanceSource(async (sql) => {
      if (sql === sqlShowGrants(TABLE)) throw new Error('syntax error at SHOW');
      if (sql === sqlRelationPrivileges(TABLE)) return { columns: [], rows: [['bob', 'user', 'SELECT', 'f']] };
      throw new Error('svv_column_privileges does not exist');
    });
    const res = await src.objectPrivileges(TABLE);
    expect(res.source).toBe('svv');
    expect(res.columnGrantsBestEffort).toBe(true);
    expect(res.grants[0]!.grantee).toBe('bob');
  });
});

describe('DemoGovernanceSource.objectPrivileges', () => {
  it('demo exposes a role grant AND a column grant (the two differentiators)', async () => {
    const res = await new DemoGovernanceSource().objectPrivileges(TABLE);
    expect(res.grants.some((g) => g.granteeType === 'role')).toBe(true);
    expect(res.grants.some((g) => g.column)).toBe(true);
  });
});
