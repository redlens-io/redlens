import * as net from 'node:net';
import * as fs from 'node:fs';
import { Client, type ConnectConfig } from 'ssh2';

/**
 * Local port-forward through an SSH bastion (PLAN §5.1). Most real Redshift
 * clusters are private; this makes the pg-wire fast path reachable. Opens a
 * local listener that forwards each connection to the cluster host/port via
 * the bastion, and hands back the local port for PgWireTransport to use.
 */
export interface SshTunnelConfig {
  bastionHost: string;
  bastionPort: number;
  username: string;
  /** Path to a private key file, OR the key contents. Exactly one auth path. */
  privateKeyPath?: string;
  password?: string;
  /** Final destination reachable FROM the bastion (the cluster endpoint). */
  destHost: string;
  destPort: number;
  /**
   * Where accepted bastion host keys are remembered (S-07). Required: without
   * it the tunnel refuses to connect rather than trusting an unverified host.
   */
  hostKeys: HostKeyStore;
}

/** Trust-on-first-use store for bastion host keys. */
export interface HostKeyStore {
  /** Fingerprint previously accepted for this bastion, if any. */
  get(hostId: string): string | undefined;
  /** Persist a fingerprint the user just accepted. */
  remember(hostId: string, fingerprint: string): Promise<void>;
  /** Ask the user whether to trust a bastion seen for the first time. */
  confirmUnknown(hostId: string, fingerprint: string): Promise<boolean>;
}

export type HostKeyVerdict = 'trusted' | 'unknown' | 'changed';

/**
 * Pure decision: what to do with the key the bastion just presented. Split out
 * so the interesting case — a key that CHANGED — is unit-testable without a
 * network. A changed key is either the bastion being rebuilt or someone sitting
 * in the middle, and only the user can tell those apart, so we stop.
 */
export function classifyHostKey(known: string | undefined, presented: string): HostKeyVerdict {
  if (known === undefined) return 'unknown';
  return known === presented ? 'trusted' : 'changed';
}

export class SshTunnel {
  private client: Client | undefined;
  private server: net.Server | undefined;
  private localPort: number | undefined;
  /** Set when the handshake was refused over the host key, so open() can say so. */
  private hostKeyError: Error | undefined;

  constructor(private readonly config: SshTunnelConfig) {}

  /** Establishes the SSH connection and local listener; resolves the local port. */
  async open(): Promise<number> {
    const client = new Client();
    const connectConfig = this.buildConnectConfig();

    await new Promise<void>((resolve, reject) => {
      client
        .on('ready', () => resolve())
        // A rejected host key surfaces from ssh2 as a generic handshake failure,
        // which would send the user hunting for a credentials problem they do
        // not have. Prefer the reason we already know.
        .on('error', (err) =>
          reject(this.hostKeyError ?? new Error(`SSH bastion connection failed: ${err.message}`)),
        )
        .connect(connectConfig);
    });
    this.client = client;

    const server = net.createServer((socket) => {
      client.forwardOut('127.0.0.1', 0, this.config.destHost, this.config.destPort, (err, stream) => {
        if (err) {
          socket.destroy();
          return;
        }
        socket.pipe(stream).pipe(socket);
        socket.on('error', () => stream.destroy());
        stream.on('error', () => socket.destroy());
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });
    this.server = server;
    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('SSH tunnel: could not determine local port');
    }
    this.localPort = address.port;
    return this.localPort;
  }

  getLocalPort(): number | undefined {
    return this.localPort;
  }

  /** Identity a host key is remembered against. */
  private hostId(): string {
    return `${this.config.bastionHost}:${this.config.bastionPort}`;
  }

  private async verifyHostKey(fingerprint: string): Promise<boolean> {
    const id = this.hostId();
    const verdict = classifyHostKey(this.config.hostKeys.get(id), fingerprint);
    if (verdict === 'trusted') return true;
    if (verdict === 'changed') {
      // Never offer to "accept anyway" here. If this is a genuine rebuild the
      // user can forget the old key deliberately; if it is not, one careless
      // click would hand over the bastion and the warehouse password.
      this.hostKeyError = new Error(
        `The SSH host key for ${id} has CHANGED. Either the bastion was rebuilt, or the connection ` +
          'is being intercepted. RedLens will not connect until you remove the remembered key for ' +
          'this host and confirm the new fingerprint out of band. Presented: ' +
          `SHA256:${fingerprint}`,
      );
      return false;
    }
    const accepted = await this.config.hostKeys.confirmUnknown(id, fingerprint);
    if (!accepted) {
      this.hostKeyError = new Error(`Bastion host key for ${id} was not accepted.`);
      return false;
    }
    await this.config.hostKeys.remember(id, fingerprint);
    return true;
  }

  buildConnectConfig(): ConnectConfig {
    const base: ConnectConfig = {
      host: this.config.bastionHost,
      port: this.config.bastionPort,
      username: this.config.username,
      readyTimeout: 15_000,
      // S-07: without a hostVerifier, ssh2 accepts whatever host key it is
      // handed. That is the whole protection SSH offers against someone sitting
      // in the path: they present their own key, we hand them the bastion
      // credentials, and every byte of the tunnelled session — the warehouse
      // password included — goes through them. Trust-on-first-use, the same
      // model as OpenSSH: remember the key, and refuse loudly if it ever changes.
      hostHash: 'sha256',
      // @types/ssh2 declares the fingerprint verifier as returning boolean even
      // in its two-argument (asynchronous) form, where ssh2 actually ignores the
      // return value and waits for the callback. Asking the user about an unknown
      // host is inherently async, so we use the callback form and cast past the
      // inaccurate signature rather than pretend the decision is synchronous.
      hostVerifier: ((fingerprint: string, verify: (ok: boolean) => void): void => {
        void this.verifyHostKey(fingerprint).then(verify, () => verify(false));
      }) as unknown as ConnectConfig['hostVerifier'],
    };
    if (this.config.privateKeyPath !== undefined && this.config.privateKeyPath.length > 0) {
      base.privateKey = this.config.privateKeyPath.includes('\n')
        ? this.config.privateKeyPath
        : fs.readFileSync(this.config.privateKeyPath);
    } else if (this.config.password !== undefined) {
      base.password = this.config.password;
    }
    return base;
  }

  async close(): Promise<void> {
    if (this.server !== undefined) {
      await new Promise<void>((resolve) => this.server?.close(() => resolve()));
      this.server = undefined;
    }
    this.client?.end();
    this.client = undefined;
    this.localPort = undefined;
  }
}
