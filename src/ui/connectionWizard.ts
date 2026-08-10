import * as vscode from 'vscode';
import { newProfileId, validateProfile, COMPAT_DEFAULTS, type ConnectionProfile, type ProfileKind } from '../connections/profile';
import { createConnection } from '../transport/factory';
import type { HostKeyStore } from '../transport/sshTunnel';
import type { ConnectionStore } from '../connections/connectionStore';

interface KindChoice extends vscode.QuickPickItem {
  profileKind: ProfileKind;
  defaults: Partial<ConnectionProfile>;
}


/**
 * Multi-step QuickInput wizard (native VS Code idiom: themed, keyboard-first).
 * UX rules applied (PLAN §7.5): contextual defaults per connection kind, test
 * before save with an actionable error, never a blank field without a hint.
 * The richer webview dialog (auto-discovery of clusters) lands with Data API.
 */
export async function runAddConnectionWizard(
  store: ConnectionStore,
  hostKeys?: HostKeyStore,
): Promise<ConnectionProfile | undefined> {
  const kindChoices: KindChoice[] = [
    {
      label: '$(database) Amazon Redshift — direct connection',
      description: 'Cluster endpoint over the Postgres wire protocol (port 5439)',
      profileKind: 'direct',
      defaults: { port: 5439, database: 'dev', ssl: true },
    },
    {
      label: '$(beaker) Local Postgres (compat mode)',
      description: 'For testing RedLens without a cluster — e.g. a local docker Postgres',
      profileKind: 'compat',
      defaults: COMPAT_DEFAULTS,
    },
    {
      label: '$(cloud) Amazon Redshift — Data API (IAM, no network setup)',
      description: 'HTTPS + IAM via ~/.aws; works with provisioned clusters and serverless workgroups',
      profileKind: 'data-api',
      defaults: { database: 'dev' },
    },
    {
      label: '$(remote) Amazon Redshift — direct via SSH bastion',
      description: 'Postgres wire tunneled through a bastion host (for private clusters)',
      profileKind: 'direct+ssh',
      defaults: { port: 5439, database: 'dev', ssl: true },
    },
    {
      label: '$(rocket) Demo — explore RedLens without a database',
      description: 'Browsable tickit sample warehouse from local fixtures; zero credentials',
      profileKind: 'demo',
      defaults: {},
    },
  ];

  const kindChoice = await vscode.window.showQuickPick(kindChoices, {
    title: 'RedLens: Add Connection — What are you connecting to?',
    placeHolder: 'Pick a connection type',
    ignoreFocusOut: true,
  });
  if (kindChoice === undefined) {
    return undefined;
  }

  if (kindChoice.profileKind === 'demo') {
    const demoProfile: ConnectionProfile = {
      id: newProfileId(),
      name: 'Demo (tickit fixtures)',
      kind: 'demo',
      host: 'demo',
      port: 1,
      database: 'tickit',
      username: 'demo',
      ssl: false,
    };
    await store.saveProfile(demoProfile, undefined);
    void vscode.window.showInformationMessage('RedLens: demo connection ready — open the RedLens explorer to browse tickit.');
    return demoProfile;
  }

  if (kindChoice.profileKind === 'data-api') {
    return runDataApiWizard(store);
  }

  const d = kindChoice.defaults;

  // No fixed 'N/6' step numbers: direct+ssh appends four more prompts after the
  // password step, so a fixed total was misleading (UXD-046). Use plain names.
  const host = await promptText('Host', d.host ?? '', 'cluster-name.abc123.us-east-1.redshift.amazonaws.com');
  if (host === undefined) return undefined;

  const portRaw = await promptText('Port', String(d.port ?? 5439), '5439', (v) => {
    const n = Number.parseInt(v, 10);
    return Number.isInteger(n) && n >= 1 && n <= 65535 ? undefined : 'Port must be an integer between 1 and 65535';
  });
  if (portRaw === undefined) return undefined;

  const database = await promptText('Database', d.database ?? 'dev', 'dev');
  if (database === undefined) return undefined;

  const username = await promptText('Username', d.username ?? '', 'awsuser');
  if (username === undefined) return undefined;

  const password = await vscode.window.showInputBox({
    title: 'RedLens: Add Connection — Password',
    prompt: 'Stored in VS Code Secret Storage, never in settings',
    password: true,
    ignoreFocusOut: true,
  });
  if (password === undefined) return undefined;

  const profile: ConnectionProfile = {
    id: newProfileId(),
    name: `${username}@${host.split('.')[0] ?? host}/${database}`,
    kind: kindChoice.profileKind,
    host: host.trim(),
    port: Number.parseInt(portRaw, 10),
    database: database.trim(),
    username: username.trim(),
    ssl: d.ssl ?? true,
  };

  if (kindChoice.profileKind === 'direct+ssh') {
    const ssh = await promptSshOptions();
    if (ssh === undefined) {
      return undefined;
    }
    profile.ssh = ssh;
  }

  const problems = validateProfile(profile);
  if (problems.length > 0) {
    void vscode.window.showErrorMessage(`RedLens: invalid connection — ${problems.map((p) => p.message).join('; ')}`);
    return undefined;
  }

  const ok = await testConnection(profile, password, hostKeys);
  if (!ok) {
    const retry = await vscode.window.showWarningMessage(
      'RedLens: could not connect with these settings.',
      'Save anyway',
      'Discard',
    );
    if (retry !== 'Save anyway') {
      return undefined;
    }
  }

  await store.saveProfile(profile, password);
  void vscode.window.showInformationMessage(`RedLens: connection "${profile.name}" saved.`);
  return profile;
}

async function runDataApiWizard(store: ConnectionStore): Promise<ConnectionProfile | undefined> {
  const region = await promptText('Data API — AWS Region', 'us-east-1', 'us-east-1');
  if (region === undefined) return undefined;

  const engineType = await vscode.window.showQuickPick(
    [
      { label: '$(server) Provisioned cluster', value: 'cluster' as const },
      { label: '$(cloud) Serverless workgroup', value: 'serverless' as const },
    ],
    { title: 'RedLens: Data API — cluster or serverless?', ignoreFocusOut: true },
  );
  if (engineType === undefined) return undefined;

  const target = await promptText(
    engineType.value === 'cluster' ? 'Data API — Cluster identifier' : 'Data API — Workgroup name',
    '',
    engineType.value === 'cluster' ? 'my-redshift-cluster' : 'my-workgroup',
  );
  if (target === undefined) return undefined;

  const database = await promptText('Data API — Database', 'dev', 'dev');
  if (database === undefined) return undefined;

  const dbUser = engineType.value === 'cluster'
    ? await vscode.window.showInputBox({ title: 'RedLens: Data API — DB user (optional, for temporary credentials)', ignoreFocusOut: true })
    : undefined;

  const profile: ConnectionProfile = {
    id: newProfileId(),
    name: `data-api:${target.trim()}/${database.trim()}`,
    kind: 'data-api',
    host: target.trim(),
    port: 5439,
    database: database.trim(),
    username: dbUser?.trim() ?? 'iam',
    ssl: true,
    dataApi: {
      region: region.trim(),
      clusterIdentifier: engineType.value === 'cluster' ? target.trim() : undefined,
      workgroupName: engineType.value === 'serverless' ? target.trim() : undefined,
      dbUser: dbUser?.trim() === '' ? undefined : dbUser?.trim(),
    },
  };
  await store.saveProfile(profile, undefined);
  void vscode.window.showInformationMessage(
    `RedLens: Data API connection "${profile.name}" saved. It uses your ~/.aws credentials (validated on first query).`,
  );
  return profile;
}

async function promptSshOptions(): Promise<import('../connections/profile').SshOptions | undefined> {
  const bastionHost = await promptText('SSH bastion — Host', '', 'bastion.example.com');
  if (bastionHost === undefined) return undefined;
  const bastionPortRaw = await promptText('SSH bastion — Port', '22', '22', (v) => {
    const n = Number.parseInt(v, 10);
    return Number.isInteger(n) && n >= 1 && n <= 65535 ? undefined : 'Port must be 1–65535';
  });
  if (bastionPortRaw === undefined) return undefined;
  const username = await promptText('SSH bastion — Username', 'ec2-user', 'ec2-user');
  if (username === undefined) return undefined;
  const privateKeyPath = await promptText('SSH bastion — Private key path', '', '~/.ssh/id_ed25519');
  if (privateKeyPath === undefined) return undefined;
  return {
    bastionHost: bastionHost.trim(),
    bastionPort: Number.parseInt(bastionPortRaw, 10),
    username: username.trim(),
    privateKeyPath: privateKeyPath.trim() === '' ? undefined : privateKeyPath.trim(),
  };
}

async function promptText(
  step: string,
  value: string,
  placeholder: string,
  validate?: (v: string) => string | undefined,
): Promise<string | undefined> {
  return vscode.window.showInputBox({
    title: `RedLens: Add Connection (${step})`,
    value,
    placeHolder: placeholder,
    ignoreFocusOut: true,
    validateInput: (v) => {
      if (v.trim().length === 0) {
        return 'Required';
      }
      return validate?.(v);
    },
  });
}

async function testConnection(
  profile: ConnectionProfile,
  password: string,
  hostKeys?: HostKeyStore,
): Promise<boolean> {
  return vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `RedLens: testing connection to ${profile.name}…` },
    async () => {
      let created;
      try {
        created = await createConnection(profile, password, hostKeys);
        await created.transport.connect();
        const id = await created.transport.execute('SELECT 1');
        created.transport.releaseResult(id);
        return true;
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        void vscode.window.showErrorMessage(`RedLens: connection test failed — ${friendlyPgError(detail)}`);
        return false;
      } finally {
        await created?.transport.dispose();
        await created?.cleanup?.();
      }
    },
  );
}

/** Translate the most common driver errors into actionable language (§7.5 #3). */
export function friendlyPgError(raw: string): string {
  if (/ECONNREFUSED/i.test(raw)) {
    return `nothing is listening at that host/port. Check the endpoint and that the database is running. (${raw})`;
  }
  if (/ETIMEDOUT|timeout/i.test(raw)) {
    return `the host did not respond — usually a network/VPN/firewall issue, or a private cluster that needs an SSH tunnel. (${raw})`;
  }
  if (/password authentication failed/i.test(raw)) {
    return `wrong username or password. (${raw})`;
  }
  if (/database .* does not exist/i.test(raw)) {
    return `that database does not exist on the server. (${raw})`;
  }
  if (/ENOTFOUND|EAI_AGAIN/i.test(raw)) {
    return `host not found — check the endpoint for typos. (${raw})`;
  }
  return raw;
}
