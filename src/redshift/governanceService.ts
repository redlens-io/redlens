import * as vscode from 'vscode';
import { queryAll } from '../query/collect';
import {
  GovernanceSource,
  SqlGovernanceSource,
  UnsupportedGovernanceSource,
  isRedshiftKind,
} from './governance';
import { DemoGovernanceSource } from './governanceFixtures';
import { objectLabel, type ObjectRef } from './privileges';
import { resolveEffectivePermissions, type EffectivePermissions } from './effectivePermissions';
import type { ActiveConnection, ConnectionManager } from '../connections/connectionManager';

export interface EffectiveResult {
  perms: EffectivePermissions;
  /** True when role membership could not be read (superuser-gated) → partial. */
  partial: boolean;
}

/**
 * Picks the governance source for the active connection and caches list reads
 * (invalidated on connection change / refresh). Parallels MetadataService.
 *  - demo    → fixtures
 *  - redshift kinds (direct / data-api / direct+ssh) -> live SVV_ / PG_USER
 *  - compat  → unsupported (plain Postgres has no svv_datashares/svv_roles)
 */
export class GovernanceService implements vscode.Disposable {
  private source: GovernanceSource | undefined;
  private readonly cache = new Map<string, Promise<unknown>>();
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changeEmitter.event;
  private readonly sub: vscode.Disposable;

  constructor(manager: ConnectionManager) {
    this.sub = manager.onDidChangeActive((active) => this.reset(active));
  }

  private reset(active: ActiveConnection | undefined): void {
    this.cache.clear();
    if (active === undefined) {
      this.source = undefined;
    } else if (active.profile.kind === 'demo') {
      this.source = new DemoGovernanceSource();
    } else if (isRedshiftKind(active.profile.kind)) {
      const t = active.transport;
      this.source = new SqlGovernanceSource((sql) => queryAll(t, sql));
    } else {
      this.source = new UnsupportedGovernanceSource();
    }
    this.changeEmitter.fire();
  }

  /** Whether the current connection exposes the governance surface at all. */
  supported(): boolean {
    return this.source?.supported ?? false;
  }

  get(): GovernanceSource | undefined {
    return this.source;
  }

  /** Memoize a keyed read so tree expansions don't re-query on every render. */
  private memo<T>(key: string, load: () => Promise<T>): Promise<T> {
    let hit = this.cache.get(key) as Promise<T> | undefined;
    if (hit === undefined) {
      hit = load().catch((err) => {
        // Do not cache failures — a transient permission/timeout should retry.
        this.cache.delete(key);
        throw err;
      });
      this.cache.set(key, hit);
    }
    return hit;
  }

  datashares() {
    return this.memo('datashares', () => this.require().listDatashares());
  }
  datashareObjects(name: string) {
    return this.memo(`ds-obj:${name}`, () => this.require().listDatashareObjects(name));
  }
  datashareConsumers(name: string) {
    return this.memo(`ds-con:${name}`, () => this.require().listDatashareConsumers(name));
  }
  users() {
    return this.memo('users', () => this.require().listUsers());
  }
  roles() {
    return this.memo('roles', () => this.require().listRoles());
  }
  currentNamespace() {
    return this.memo('ns', () => this.require().currentNamespace());
  }
  objectPrivileges(ref: ObjectRef) {
    const key = ref.kind === 'schema' ? `priv:s:${ref.schema}` : `priv:t:${ref.schema}.${ref.name}`;
    return this.memo(key, () => this.require().objectPrivileges(ref));
  }
  rlsPolicies() {
    return this.memo('rls', () => this.require().listRlsPolicies());
  }
  maskingPolicies() {
    return this.memo('masking', () => this.require().listMaskingPolicies());
  }

  /**
   * Assemble effective permissions for a user on an object (b4 moat). Role
   * membership is superuser-gated; if it can't be read we resolve with empty
   * membership (only direct + PUBLIC grants) and flag the result partial.
   */
  async effectivePermissions(ref: ObjectRef, userName: string): Promise<EffectiveResult> {
    const src = this.require();
    const [priv, users] = await Promise.all([this.objectPrivileges(ref), this.users()]);
    let userRoles: string[] = [];
    let roleToRoles: Record<string, string[]> = {};
    let partial = false;
    try {
      const [ug, rg] = await Promise.all([src.listUserRoleGrants(), src.listRoleRoleGrants()]);
      userRoles = ug.filter((g) => g.user === userName).map((g) => g.role);
      roleToRoles = {};
      for (const g of rg) (roleToRoles[g.grantee] ??= []).push(g.held);
    } catch {
      partial = true; // membership needs superuser/ACCESS SYSTEM TABLE
    }
    const user = users.find((u) => u.name === userName);
    const perms = resolveEffectivePermissions(objectLabel(ref), {
      user: { name: userName, superuser: user?.superuser ?? false },
      grants: priv.grants,
      userRoles,
      roleToRoles,
    });
    return { perms, partial };
  }

  private require(): GovernanceSource {
    if (this.source === undefined) {
      throw new Error('No active connection');
    }
    return this.source;
  }

  invalidate(): void {
    this.cache.clear();
    this.changeEmitter.fire();
  }

  dispose(): void {
    this.sub.dispose();
    this.changeEmitter.dispose();
  }
}
