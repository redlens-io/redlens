import { describe, expect, it } from 'vitest';
import { parseRlsPolicies, parseMaskingPolicies } from '../src/redshift/securityPolicies';
import { parseUserRoleGrants, parseRoleRoleGrants } from '../src/redshift/governance';
import {
  roleClosure,
  resolveEffectivePermissions,
  type EffectivePermissionInput,
} from '../src/redshift/effectivePermissions';
import type { PrivilegeGrant } from '../src/redshift/privileges';

describe('RLS / masking parsers', () => {
  it('joins attached relations onto RLS policies', () => {
    const policies = parseRlsPolicies(
      [['p1', 'tickit'], ['', '']],
      [['p1', 'tickit.sales'], ['p1', 'tickit.event'], ['', '']],
    );
    expect(policies).toHaveLength(1);
    expect(policies[0]).toMatchObject({ name: 'p1', schema: 'tickit', attachedTo: ['tickit.sales', 'tickit.event'] });
  });
  it('parses masking policies with input columns', () => {
    expect(parseMaskingPolicies([['mask_email', 'email'], ['', '']])).toEqual([
      { name: 'mask_email', inputColumns: 'email' },
    ]);
  });
});

describe('membership parsers', () => {
  it('parses user->role and role->role grants, skipping blanks', () => {
    expect(parseUserRoleGrants([['analyst', 'analyst_role'], ['', 'x']])).toEqual([{ user: 'analyst', role: 'analyst_role' }]);
    expect(parseRoleRoleGrants([['analyst_role', 'etl_role'], ['x', '']])).toEqual([{ grantee: 'analyst_role', held: 'etl_role' }]);
  });
});

describe('roleClosure (transitive membership with paths)', () => {
  it('follows role->role edges and records shortest paths', () => {
    const paths = roleClosure(['a'], { a: ['b'], b: ['c'] });
    expect([...paths.keys()].sort()).toEqual(['a', 'b', 'c']);
    expect(paths.get('a')).toEqual(['a']);
    expect(paths.get('c')).toEqual(['a', 'b', 'c']);
  });
  it('does not loop on cycles', () => {
    const paths = roleClosure(['a'], { a: ['b'], b: ['a'] });
    expect([...paths.keys()].sort()).toEqual(['a', 'b']);
  });
});

describe('resolveEffectivePermissions (the moat)', () => {
  const grants: PrivilegeGrant[] = [
    { grantee: 'PUBLIC', granteeType: 'public', privilege: 'SELECT', withGrantOption: false },
    { grantee: 'analyst_role', granteeType: 'role', privilege: 'SELECT', withGrantOption: false, column: 'pricepaid' },
    { grantee: 'etl_role', granteeType: 'role', privilege: 'INSERT', withGrantOption: false },
    { grantee: 'bob', granteeType: 'user', privilege: 'DELETE', withGrantOption: false },
  ];

  it('superuser short-circuits to full access with no grant enumeration', () => {
    const r = resolveEffectivePermissions('tickit.sales', {
      user: { name: 'admin', superuser: true },
      grants,
      userRoles: [],
      roleToRoles: {},
    });
    expect(r.allAccess?.reason).toMatch(/superuser/);
    expect(r.privileges).toHaveLength(0);
  });

  it('object owner short-circuits to full access', () => {
    const r = resolveEffectivePermissions('tickit.sales', {
      user: { name: 'owner1', superuser: false },
      objectOwner: 'owner1',
      grants,
      userRoles: [],
      roleToRoles: {},
    });
    expect(r.allAccess?.reason).toMatch(/owner/);
  });

  it('resolves a transitive role path and explains each privilege', () => {
    // analyst has analyst_role directly; analyst_role inherits etl_role.
    const input: EffectivePermissionInput = {
      user: { name: 'analyst', superuser: false },
      grants,
      userRoles: ['analyst_role'],
      roleToRoles: { analyst_role: ['etl_role'] },
    };
    const r = resolveEffectivePermissions('tickit.sales', input);
    expect(r.effectiveRoles).toEqual(['analyst_role', 'etl_role']);
    const select = r.privileges.find((p) => p.privilege === 'SELECT' && p.column === 'pricepaid');
    expect(select?.reasons).toContain('via role analyst_role');
    const insert = r.privileges.find((p) => p.privilege === 'INSERT');
    expect(insert?.reasons.some((x) => x.includes('inherited: analyst_role → etl_role'))).toBe(true);
    // PUBLIC SELECT (no column) applies too.
    expect(r.privileges.find((p) => p.privilege === 'SELECT' && !p.column)?.reasons).toContain('via PUBLIC');
    // bob's DELETE does NOT reach analyst.
    expect(r.privileges.some((p) => p.privilege === 'DELETE')).toBe(false);
  });

  it('a user with no roles still gets PUBLIC and direct grants', () => {
    const r = resolveEffectivePermissions('tickit.sales', {
      user: { name: 'bob', superuser: false },
      grants,
      userRoles: [],
      roleToRoles: {},
    });
    expect(r.privileges.find((p) => p.privilege === 'DELETE')?.reasons).toContain('granted directly to bob');
    expect(r.privileges.find((p) => p.privilege === 'SELECT' && !p.column)?.reasons).toContain('via PUBLIC');
    expect(r.privileges.some((p) => p.privilege === 'INSERT')).toBe(false); // etl_role not held
  });
});
