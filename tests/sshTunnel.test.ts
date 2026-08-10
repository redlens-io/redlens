import { describe, expect, it } from 'vitest';
import { SshTunnel } from '../src/transport/sshTunnel';

/** The tunnel refuses to build without a host-key store (S-07); these tests
 *  only inspect the connect config, so a store that is never consulted is
 *  enough — and keeping it explicit documents that the store is mandatory. */
const noHostKeys = {
  get: () => undefined,
  remember: async () => undefined,
  confirmUnknown: async () => false,
};


describe('SshTunnel.buildConnectConfig', () => {
  it('uses an inline private key when the string contains newlines', () => {
    const t = new SshTunnel({
      bastionHost: 'bastion', bastionPort: 22, username: 'ec2-user',
      privateKeyPath: '-----BEGIN KEY-----\nabc\n-----END KEY-----',
      destHost: 'cluster', destPort: 5439,
    hostKeys: noHostKeys,
    });
    const cfg = t.buildConnectConfig();
    expect(cfg.host).toBe('bastion');
    expect(cfg.username).toBe('ec2-user');
    expect(cfg.privateKey).toContain('BEGIN KEY');
  });

  it('falls back to password auth when no key is given', () => {
    const t = new SshTunnel({
      bastionHost: 'b', bastionPort: 2222, username: 'u', password: 'secret',
      destHost: 'c', destPort: 5439,
    hostKeys: noHostKeys,
    });
    const cfg = t.buildConnectConfig();
    expect(cfg.password).toBe('secret');
    expect(cfg.port).toBe(2222);
    expect(cfg.privateKey).toBeUndefined();
  });
});
