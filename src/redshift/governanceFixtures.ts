import type {
  Datashare,
  DatashareConsumer,
  DatashareObject,
  DbRole,
  DbUser,
  GovernanceSource,
  RoleRoleGrant,
  UserRoleGrant,
} from './governance';
import type { ObjectPrivileges, ObjectRef, PrivilegeGrant } from './privileges';
import type { MaskingPolicy, RlsPolicy } from './securityPolicies';

/**
 * Demo governance fixtures (M8b1): datashares with objects+consumers, users
 * (incl. a federated one and rdsdb), RBAC roles (incl. a sys:* built-in). Lets
 * the whole tree — and its degradation badges — be seen with no real cluster.
 */

export const DEMO_NAMESPACE = 'a1b2c3d4-1111-2222-3333-444455556666';

export const DEMO_GOV_DATASHARES: Datashare[] = [
  { name: 'sales_share', direction: 'outbound', producerNamespace: DEMO_NAMESPACE, publicAccessible: false },
  { name: 'marketing_inbound', direction: 'inbound', producerAccount: '210987654321', producerNamespace: 'mkt-ns-guid', publicAccessible: false },
  { name: 'public_ref_data', direction: 'outbound', producerNamespace: DEMO_NAMESPACE, publicAccessible: true },
];

const DEMO_OBJECTS: Record<string, DatashareObject[]> = {
  sales_share: [
    { objectType: 'schema', objectName: 'tickit' },
    { objectType: 'table', objectName: 'tickit.sales' },
    { objectType: 'table', objectName: 'tickit.event' },
    { objectType: 'view', objectName: 'tickit.v_sales_by_month' },
  ],
  marketing_inbound: [
    { objectType: 'schema', objectName: 'mkt' },
    { objectType: 'table', objectName: 'mkt.campaigns' },
  ],
  public_ref_data: [{ objectType: 'table', objectName: 'ref.country_codes' }],
};

const DEMO_CONSUMERS: Record<string, DatashareConsumer[]> = {
  sales_share: [
    { consumerAccount: '555566667777', consumerNamespace: 'bi-team-ns', consumerRegion: 'us-east-1' },
    { consumerAccount: '123456789012', consumerNamespace: 'analytics-ns', consumerRegion: 'us-west-2' },
  ],
  marketing_inbound: [],
  public_ref_data: [],
};

export const DEMO_USERS: DbUser[] = [
  { name: 'admin', superuser: true, createDb: true, federated: false, system: false },
  { name: 'etl', superuser: false, createDb: true, federated: false, system: false },
  { name: 'analyst', superuser: false, createDb: false, federated: false, system: false },
  { name: 'bi_service', superuser: false, createDb: false, federated: false, system: false },
  { name: 'IAMR:redshift_readonly', superuser: false, createDb: false, federated: true, system: false },
  { name: 'rdsdb', superuser: true, createDb: true, federated: false, system: true },
];

export const DEMO_ROLES: DbRole[] = [
  { name: 'sys:secadmin', owner: undefined, system: true },
  { name: 'sys:operator', owner: undefined, system: true },
  { name: 'analyst_role', owner: 'admin', system: false },
  { name: 'etl_role', owner: 'admin', system: false },
];

/**
 * Demo privileges for tickit.sales — deliberately includes a grant to an RBAC
 * ROLE (the DBeaver-PRO gap) and a column-level grant (invisible in
 * SVV_RELATION_PRIVILEGES) so both differentiators are visible in demo.
 */
const DEMO_PRIVS: Record<string, PrivilegeGrant[]> = {
  'tickit.sales': [
    { grantee: 'PUBLIC', granteeType: 'public', privilege: 'SELECT', withGrantOption: false },
    { grantee: 'analyst_role', granteeType: 'role', privilege: 'SELECT', withGrantOption: false },
    { grantee: 'etl_role', granteeType: 'role', privilege: 'INSERT', withGrantOption: false },
    { grantee: 'etl_role', granteeType: 'role', privilege: 'UPDATE', withGrantOption: false },
    { grantee: 'bi_service', granteeType: 'user', privilege: 'SELECT', withGrantOption: true },
    { grantee: 'analyst_role', granteeType: 'role', privilege: 'SELECT', withGrantOption: false, column: 'pricepaid' },
  ],
  tickit: [
    { grantee: 'PUBLIC', granteeType: 'public', privilege: 'USAGE', withGrantOption: false },
    { grantee: 'analyst_role', granteeType: 'role', privilege: 'USAGE', withGrantOption: false },
    { grantee: 'etl_role', granteeType: 'role', privilege: 'CREATE', withGrantOption: false },
  ],
};

function demoObjectKey(ref: ObjectRef): string {
  return ref.kind === 'schema' ? ref.schema : `${ref.schema}.${ref.name ?? ''}`;
}

export const DEMO_RLS_POLICIES: RlsPolicy[] = [
  { name: 'sales_by_region', schema: 'tickit', attachedTo: ['tickit.sales'] },
];
export const DEMO_MASKING_POLICIES: MaskingPolicy[] = [
  { name: 'mask_email', inputColumns: 'email' },
  { name: 'mask_price', inputColumns: 'pricepaid' },
];
/** analyst_role is a member of etl_role (transitive inheritance in demo). */
export const DEMO_USER_ROLE_GRANTS: UserRoleGrant[] = [
  { user: 'analyst', role: 'analyst_role' },
  { user: 'etl', role: 'etl_role' },
];
export const DEMO_ROLE_ROLE_GRANTS: RoleRoleGrant[] = [
  { grantee: 'analyst_role', held: 'etl_role' },
];
/** Object owners (for effective-permissions owner short-circuit). */
export const DEMO_OWNERS: Record<string, string> = { 'tickit.sales': 'admin', tickit: 'admin' };

export class DemoGovernanceSource implements GovernanceSource {
  readonly supported = true;
  async listDatashares(): Promise<Datashare[]> { return DEMO_GOV_DATASHARES; }
  async listDatashareObjects(name: string): Promise<DatashareObject[]> { return DEMO_OBJECTS[name] ?? []; }
  async listDatashareConsumers(name: string): Promise<DatashareConsumer[]> { return DEMO_CONSUMERS[name] ?? []; }
  async listUsers(): Promise<DbUser[]> { return DEMO_USERS; }
  async listRoles(): Promise<DbRole[]> { return DEMO_ROLES; }
  async currentNamespace(): Promise<string | undefined> { return DEMO_NAMESPACE; }
  async objectPrivileges(ref: ObjectRef): Promise<ObjectPrivileges> {
    return { grants: DEMO_PRIVS[demoObjectKey(ref)] ?? [], columnGrantsBestEffort: false, source: 'show-grants' };
  }
  async listRlsPolicies(): Promise<RlsPolicy[]> { return DEMO_RLS_POLICIES; }
  async listMaskingPolicies(): Promise<MaskingPolicy[]> { return DEMO_MASKING_POLICIES; }
  async listUserRoleGrants(): Promise<UserRoleGrant[]> { return DEMO_USER_ROLE_GRANTS; }
  async listRoleRoleGrants(): Promise<RoleRoleGrant[]> { return DEMO_ROLE_ROLE_GRANTS; }
}
