import { afterAll, describe, expect, it } from 'vitest';
import { SshTunnel } from '../src/transport/sshTunnel';
import { PgWireTransport } from '../src/transport/pgWire';

/** The tunnel refuses to build without a host-key store (S-07); these tests
 *  only inspect the connect config, so a store that is never consulted is
 *  enough — and keeping it explicit documents that the store is mandatory. */
const noHostKeys = {
  get: () => undefined,
  remember: async () => undefined,
  confirmUnknown: async () => false,
};


/**
 * Live SSH tunnel test (gate L9): the VM Lab is used as the bastion. The test
 * container SSHes to the VM host, which forwards to the pg-compat published
 * port — exercising the real ssh2 forward + PgWireTransport over it, exactly
 * as a private-cluster connection would. Runs only when REDLENS_SSH_HOST is set
 * (scripts/remote/ssh-test.sh wires the key + host-gateway).
 */
const HOST = process.env.REDLENS_SSH_HOST;

describe.runIf(Boolean(HOST))('SSH tunnel → pg-compat (live, VM as bastion)', () => {
  let tunnel: SshTunnel | undefined;
  let transport: PgWireTransport | undefined;

  afterAll(async () => {
    await transport?.dispose();
    await tunnel?.close();
  });

  it('forwards a pg connection through the bastion and runs a query', async () => {
    tunnel = new SshTunnel({
      bastionHost: HOST ?? '',
      bastionPort: Number.parseInt(process.env.REDLENS_SSH_PORT ?? '22', 10),
      username: process.env.REDLENS_SSH_USER ?? 'dbo',
      privateKeyPath: process.env.REDLENS_SSH_KEY ?? '/keys/bastion',
      destHost: process.env.REDLENS_SSH_DEST_HOST ?? '127.0.0.1',
      destPort: Number.parseInt(process.env.REDLENS_SSH_DEST_PORT ?? '15439', 10),
      // This test really connects, so it needs a store that accepts. Auto-accept
      // is fine for a lab bastion the test itself provisions; the *product*
      // default is the opposite (ask, then pin) — see tests/sshHostKey.test.ts.
      hostKeys: {
        get: () => undefined,
        remember: async () => undefined,
        confirmUnknown: async () => true,
      },
    });
    const localPort = await tunnel.open();
    expect(localPort).toBeGreaterThan(0);

    transport = new PgWireTransport({
      host: '127.0.0.1',
      port: localPort,
      database: 'redlens',
      user: 'redlens',
      password: 'redlens',
      ssl: false,
    });
    await transport.connect();
    // count(*) is int8 → Postgres returns it as a string over the wire; the
    // point of this test is that the tunnel carried the query and result.
    const id = await transport.execute('SELECT count(*) AS n FROM tickit.sales');
    const page = await transport.fetchPage(id);
    expect(Number(page.rows[0]?.[0])).toBe(40);
    transport.releaseResult(id);
  }, 30_000);
});
