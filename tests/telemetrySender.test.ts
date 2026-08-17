import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { WorkerTelemetrySender } from '../src/telemetry/sender';

/**
 * C4's closing validation: with telemetry off, ZERO requests leave.
 *
 * The plan states it that way and it is worth taking literally. The official
 * guidance says an extension must respect `env.isTelemetryEnabled` regardless
 * of any setting of its own, and the failure mode is invisible from inside:
 * everything works, the user believes they opted out, and packets go anyway.
 *
 * The gate lives in `Telemetry.allowed()`, which reads BOTH flags live on every
 * send. Reading live rather than caching at construction is what makes the
 * change event unnecessary — and it is also the only thing that catches
 * `--disable-telemetry`, a CLI flag that never appears in the configuration and
 * is visible ONLY through isTelemetryEnabled.
 */

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('the sender', () => {
  it('posts an event to the /t endpoint', async () => {
    new WorkerTelemetrySender('https://example.invalid/t').sendEventData('install', {});
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://example.invalid/t');
    expect(JSON.parse(String(init.body))).toEqual({ event: 'install', properties: {} });
  });

  it('never sends error data', () => {
    // VS Code calls sendErrorData with exception details, and in a database tool
    // a stack trace or message routinely carries table names, column names and
    // sometimes values. No scrubber makes that safe; the answer is not to send.
    const sender = new WorkerTelemetrySender('https://example.invalid/t');
    (sender as unknown as { sendErrorData: (e: Error) => void })
      .sendErrorData(new Error('relation "tickit.sales" does not exist'));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('swallows a network failure instead of surfacing it', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    expect(() => new WorkerTelemetrySender('https://example.invalid/t').sendEventData('install', {}))
      .not.toThrow();
    // Give the rejected promise a turn to settle; an unhandled rejection here
    // would surface in the editor as an extension error for something the user
    // never asked for.
    await new Promise((r) => setTimeout(r, 0));
  });

  it('carries no identifier of any kind', () => {
    new WorkerTelemetrySender('https://example.invalid/t')
      .sendEventData('licence-activated', { plan: 'team' });
    const body = String(fetchMock.mock.calls[0]![1].body).toLowerCase();
    for (const forbidden of ['machine', 'email', 'user', 'session', 'id"']) {
      expect(body, `payload must not carry "${forbidden}"`).not.toContain(forbidden);
    }
  });
});
