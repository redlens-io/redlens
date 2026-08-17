import * as vscode from 'vscode';

/**
 * Ships events to the entitlement Worker's `/t` endpoint (C4).
 *
 * Everything about this is shaped by one rule: telemetry must never be able to
 * hurt the thing the user is actually doing.
 *
 *  - **It never throws and never retries.** A failed telemetry post is dropped
 *    silently. Retrying to deliver usage data from an editor is exactly the
 *    behaviour nobody wants, and a thrown error inside `logUsage` would surface
 *    as an extension error for something the user did not ask for.
 *  - **It never blocks.** Nothing awaits the send.
 *  - **It carries no identity.** No machine id, no email, no session id. The
 *    events are counts; correlating them to a person is not a capability that
 *    exists here, so it cannot be misused later.
 *
 * The gate on WHETHER to send lives in `Telemetry`, not here — this class is
 * reached only after both the global preference and the RedLens setting have
 * said yes.
 */
export class WorkerTelemetrySender implements vscode.TelemetrySender {
  constructor(private readonly endpoint: string) {}

  sendEventData(eventName: string, data?: Record<string, unknown>): void {
    void fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: eventName, properties: data ?? {} }),
    }).catch(() => {
      // Deliberately empty. See the note above: a telemetry failure is not the
      // user's problem and must not become visible as one.
    });
  }

  /**
   * Errors are NOT sent. VS Code calls this with exception data, and in a
   * database tool a stack trace or message routinely carries table names,
   * column names and sometimes values — the same argument that made the event
   * catalog an allowlist. There is no scrubber good enough to make this safe,
   * so the answer is not to send it.
   */
  sendErrorData(): void {
    // intentionally does nothing
  }
}
