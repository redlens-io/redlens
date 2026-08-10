import { describe, expect, it } from 'vitest';
import { DataApiTransport, decodeField } from '../src/transport/dataApi';

/** Fake RedshiftDataClient: routes by command constructor name. */
function fakeClient(script: {
  describeStates?: string[];
  error?: string;
  hasResult?: boolean;
  columns?: { name: string; typeName: string }[];
  records?: unknown[][][];
}) {
  let describeCall = 0;
  const states = script.describeStates ?? ['FINISHED'];
  let resultPage = 0;
  return {
    send(command: { constructor: { name: string }; input: Record<string, unknown> }) {
      const name = command.constructor.name;
      if (name === 'ExecuteStatementCommand') {
        return Promise.resolve({ Id: 'stmt-1' });
      }
      if (name === 'DescribeStatementCommand') {
        const state = states[Math.min(describeCall, states.length - 1)] ?? 'FINISHED';
        describeCall++;
        return Promise.resolve({ Status: state, Error: script.error, HasResultSet: script.hasResult ?? true });
      }
      if (name === 'GetStatementResultCommand') {
        const cols = (script.columns ?? []).map((c) => ({ name: c.name, typeName: c.typeName, nullable: 1 }));
        const pages = script.records ?? [];
        const page = pages[resultPage] ?? [];
        const hasMore = resultPage < pages.length - 1;
        const token = hasMore ? `t${resultPage}` : undefined;
        resultPage++;
        return Promise.resolve({
          ColumnMetadata: resultPage === 1 ? cols : undefined,
          Records: page,
          NextToken: token,
        });
      }
      if (name === 'CancelStatementCommand') {
        return Promise.resolve({ Status: true });
      }
      throw new Error(`unexpected command ${name}`);
    },
  };
}

const noSleep = () => Promise.resolve();

describe('DataApiTransport', () => {
  it('requires a cluster or workgroup to connect', async () => {
    const t = new DataApiTransport({ database: 'dev', region: 'us-east-1' }, { client: fakeClient({}) as never });
    await expect(t.connect()).rejects.toThrow(/cluster identifier or a serverless workgroup/);
  });

  it('accepts a serverless workgroup', async () => {
    const t = new DataApiTransport(
      { database: 'dev', region: 'us-east-1', workgroupName: 'wg-demo' },
      { client: fakeClient({}) as never },
    );
    await expect(t.connect()).resolves.toBeUndefined();
  });

  it('polls until FINISHED and re-parses typed string values', async () => {
    const client = fakeClient({
      describeStates: ['SUBMITTED', 'STARTED', 'FINISHED'],
      columns: [
        { name: 'n', typeName: 'int8' },
        { name: 'flag', typeName: 'bool' },
        { name: 'doc', typeName: 'super' },
      ],
      records: [[
        [{ stringValue: '42' }, { stringValue: 'true' }, { stringValue: '{"a":1}' }],
        [{ isNull: true }, { stringValue: 'f' }, { stringValue: 'not json' }],
      ]],
    });
    const t = new DataApiTransport(
      { database: 'dev', region: 'us-east-1', workgroupName: 'wg' },
      { client: client as never, sleep: noSleep },
    );
    const id = await t.execute('SELECT n, flag, doc FROM x');
    const page = await t.fetchPage(id);
    expect(page.columns.map((c) => c.name)).toEqual(['n', 'flag', 'doc']);
    expect(page.rows[0]).toEqual([42, true, { a: 1 }]);
    expect(page.rows[1]).toEqual([null, false, 'not json']);
    expect(t.getSummary(id).rowCount).toBe(2);
  });

  it('paginates via NextToken across pages', async () => {
    const client = fakeClient({
      columns: [{ name: 'n', typeName: 'int4' }],
      records: [
        [[{ stringValue: '1' }], [{ stringValue: '2' }]],
        [[{ stringValue: '3' }]],
      ],
    });
    const t = new DataApiTransport(
      { database: 'dev', region: 'us-east-1', clusterIdentifier: 'c1' },
      { client: client as never, sleep: noSleep },
    );
    const id = await t.execute('SELECT n FROM x');
    const page = await t.fetchPage(id);
    expect(page.rows.map((r) => r[0])).toEqual([1, 2, 3]);
  });

  it('throws with the server error on FAILED', async () => {
    const client = fakeClient({ describeStates: ['FAILED'], error: 'syntax error at or near' });
    const t = new DataApiTransport(
      { database: 'dev', region: 'us-east-1', workgroupName: 'wg' },
      { client: client as never, sleep: noSleep },
    );
    await expect(t.execute('SELCT 1')).rejects.toThrow(/FAILED: syntax error/);
  });
});

describe('decodeField', () => {
  it('handles the Data API field union', () => {
    expect(decodeField({ isNull: true }, 'int4')).toBeNull();
    expect(decodeField({ longValue: 7 }, 'int8')).toBe(7);
    expect(decodeField({ doubleValue: 1.5 }, 'float8')).toBe(1.5);
    expect(decodeField({ booleanValue: true }, 'bool')).toBe(true);
    expect(decodeField({ stringValue: '9' }, 'int4')).toBe(9);
  });
});
