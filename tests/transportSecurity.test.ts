import { describe, expect, it } from 'vitest';
import { classifyHostKey, SshTunnel } from '../src/transport/sshTunnel';
import { explainTlsFailure } from '../src/transport/pgWire';

/**
 * The two transport findings from the S3 audit, pinned so they cannot regress.
 *
 * S-07: ssh2 accepts any host key unless you give it a hostVerifier. Without one
 * the entire point of SSH — knowing you reached the machine you meant — is gone,
 * and whoever answers instead receives the bastion credentials and every byte of
 * the tunnelled session, warehouse password included.
 *
 * S-08: `ssl: true` was paired with `rejectUnauthorized: false`, i.e. encrypt but
 * trust anybody. That defeats a passive eavesdropper and nothing else: an active
 * attacker presents their own certificate and reads it all.
 */

const store = {
  get: () => undefined,
  remember: async () => undefined,
  confirmUnknown: async () => false,
};

describe('SSH host key verification (S-07)', () => {
  it('the tunnel always installs a host verifier', () => {
    const cfg = new SshTunnel({
      bastionHost: 'bastion.example', bastionPort: 22, username: 'u',
      privateKeyPath: '/dev/null', destHost: 'db', destPort: 5439, hostKeys: store,
    }).buildConnectConfig();
    expect(cfg.hostVerifier, 'no hostVerifier means every host key is accepted').toBeDefined();
    expect(cfg.hostHash).toBe('sha256');
  });

  it('a first-seen host is unknown, not trusted', () => {
    expect(classifyHostKey(undefined, 'aa:bb')).toBe('unknown');
  });

  it('a matching key is trusted', () => {
    expect(classifyHostKey('aa:bb', 'aa:bb')).toBe('trusted');
  });

  it('a changed key is reported as changed, never as unknown', () => {
    // The dangerous case: treating this as "unknown" would prompt the user to
    // accept it like any first connection, which is exactly what an interceptor
    // needs. It must be distinguishable so the tunnel can refuse outright.
    expect(classifyHostKey('aa:bb', 'ff:ee')).toBe('changed');
  });
});

describe('TLS certificate verification (S-08)', () => {
  it('passes through errors that are not certificate failures', () => {
    const original = Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' });
    expect(explainTlsFailure(original)).toBe(original);
  });

  it('turns an OpenSSL code into something a user can act on', () => {
    const err = Object.assign(new Error('self signed certificate'), { code: 'SELF_SIGNED_CERT_IN_CHAIN' });
    const explained = explainTlsFailure(err);
    expect(explained.message).toContain('SELF_SIGNED_CERT_IN_CHAIN');
    expect(explained.message).toMatch(/sslInsecure/);
    expect(explained.message).toMatch(/intercepted/i);
  });

  it('covers the certificate failures a real deployment hits', () => {
    for (const code of ['DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
      'CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID']) {
      const explained = explainTlsFailure(Object.assign(new Error('x'), { code }));
      expect(explained.message, code).toContain(code);
    }
  });
});
