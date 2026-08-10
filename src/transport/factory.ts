import { RedshiftDataClient } from '@aws-sdk/client-redshift-data';
import { DemoTransport } from './demoTransport';
import { PgWireTransport } from './pgWire';
import { DataApiTransport } from './dataApi';
import { SshTunnel, type HostKeyStore } from './sshTunnel';
import { FixtureMetadataSource } from '../demo/fixtures';
import type { BufferedTransport } from './types';
import type { ConnectionProfile } from '../connections/profile';
import type { MetadataSource } from '../metadata/types';

export interface CreatedConnection {
  transport: BufferedTransport;
  /** Only for transports whose metadata does not come from SQL (demo). */
  metadataSource?: MetadataSource;
  /** Torn down on disconnect (SSH tunnel). */
  cleanup?: () => Promise<void>;
}

/**
 * Builds a live connection for a profile. Async because the SSH tunnel must be
 * established before the pg client can reach the (now-local) forwarded port.
 */
export async function createConnection(
  profile: ConnectionProfile,
  password: string,
  hostKeys?: HostKeyStore,
): Promise<CreatedConnection> {
  switch (profile.kind) {
    case 'demo':
      return { transport: new DemoTransport(), metadataSource: new FixtureMetadataSource() };

    case 'data-api': {
      const opts = profile.dataApi;
      if (opts === undefined) {
        throw new Error('Data API profile is missing its configuration');
      }
      const client = new RedshiftDataClient({ region: opts.region });
      return {
        transport: new DataApiTransport(
          {
            database: profile.database,
            region: opts.region,
            clusterIdentifier: opts.clusterIdentifier,
            workgroupName: opts.workgroupName,
            dbUser: opts.dbUser,
            secretArn: opts.secretArn,
          },
          { client },
        ),
      };
    }

    case 'direct+ssh': {
      if (profile.ssh === undefined) {
        throw new Error('SSH profile is missing its bastion configuration');
      }
      if (hostKeys === undefined) {
        // Fail closed: no store means no way to verify the bastion, and an
        // unverified bastion sees the warehouse password in clear (S-07).
        throw new Error('SSH connections require the host-key store; this build wired it incorrectly.');
      }
      const tunnel = new SshTunnel({
        bastionHost: profile.ssh.bastionHost,
        bastionPort: profile.ssh.bastionPort,
        username: profile.ssh.username,
        privateKeyPath: profile.ssh.privateKeyPath,
        destHost: profile.host,
        destPort: profile.port,
        hostKeys,
      });
      const localPort = await tunnel.open();
      return {
        transport: new PgWireTransport({
          host: '127.0.0.1',
          port: localPort,
          database: profile.database,
          user: profile.username,
          password,
          ssl: profile.ssl,
          sslInsecure: profile.sslInsecure,
        }),
        cleanup: () => tunnel.close(),
      };
    }

    case 'direct':
    case 'compat':
      return {
        transport: new PgWireTransport({
          host: profile.host,
          port: profile.port,
          database: profile.database,
          user: profile.username,
          password,
          ssl: profile.ssl,
          sslInsecure: profile.sslInsecure,
        }),
      };
  }
}
