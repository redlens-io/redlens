import { describe, expect, it } from 'vitest';
import {
  isSafeAwsName, isSafeRegion, parseRedshiftEndpoint, resolveTarget,
  type CloudWatchTarget,
} from '../src/aws/target';

/**
 * Working out which warehouse a connection points at.
 *
 * These tests came across from `cloudWatch.test.ts` in the Fase O split, with
 * their code: the metrics they used to sit beside are a paid feature and moved
 * to the Pro package, but resolution is shared — the FREE Properties section of
 * the Cluster view depends on exactly this, so it stays open and stays tested
 * here.
 */

describe('endpoint parsing', () => {
  it('recovers cluster and region from a provisioned endpoint', () => {
    expect(parseRedshiftEndpoint('redlens-dw.abc123xyz.us-east-1.redshift.amazonaws.com')).toEqual({
      region: 'us-east-1', clusterIdentifier: 'redlens-dw',
    });
  });

  it('recovers workgroup and region from a serverless endpoint', () => {
    expect(parseRedshiftEndpoint('analytics.123456789012.mx-central-1.redshift-serverless.amazonaws.com')).toEqual({
      region: 'mx-central-1', workgroupName: 'analytics',
    });
  });

  it('is case-insensitive and tolerates a trailing dot', () => {
    expect(parseRedshiftEndpoint('DW.Abc.US-EAST-1.Redshift.amazonaws.com.').clusterIdentifier).toBe('dw');
  });

  it('returns nothing for hosts that are not Redshift endpoints', () => {
    for (const host of ['localhost', '127.0.0.1', 'db.internal.corp', '', 'redshift.amazonaws.com']) {
      expect(parseRedshiftEndpoint(host)).toEqual({});
    }
  });
});

describe('target resolution', () => {
  it('reads a Data API profile straight from its configuration', () => {
    expect(resolveTarget({ kind: 'data-api', dataApi: { region: 'us-east-1', workgroupName: 'wg' } }).target)
      .toMatchObject({ kind: 'serverless', workgroupName: 'wg' });
    expect(resolveTarget({ kind: 'data-api', dataApi: { region: 'us-east-1', clusterIdentifier: 'c1' } }).target)
      .toMatchObject({ kind: 'provisioned', clusterIdentifier: 'c1' });
  });

  it('falls back to the endpoint host for pg-wire profiles', () => {
    const r = resolveTarget({ kind: 'direct', host: 'dw.abc.eu-west-1.redshift.amazonaws.com' });
    expect(r.target).toEqual({ kind: 'provisioned', region: 'eu-west-1', clusterIdentifier: 'dw' });
  });

  it('lets explicit aws settings win over the parsed host', () => {
    const r = resolveTarget({
      kind: 'direct+ssh',
      host: 'dw.abc.eu-west-1.redshift.amazonaws.com',
      aws: { region: 'us-east-2', clusterIdentifier: 'other-dw' },
    });
    expect(r.target).toEqual({ kind: 'provisioned', region: 'us-east-2', clusterIdentifier: 'other-dw' });
  });

  it('reports why it cannot resolve, instead of guessing', () => {
    expect(resolveTarget({ kind: 'demo' }).reason).toBe('not-redshift');
    expect(resolveTarget({ kind: 'compat', host: 'localhost' }).reason).toBe('not-redshift');
    expect(resolveTarget({ kind: 'direct', host: 'bastion.internal' }).reason).toBe('no-identity');
    expect(resolveTarget({ kind: 'direct', host: 'bastion.internal' }).target).toBeUndefined();
  });
});
