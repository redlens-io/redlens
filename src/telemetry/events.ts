/**
 * The telemetry event catalog (S6) — the only thing RedLens is allowed to send.
 *
 * Allowlist, not denylist. In a database tool almost every artifact is customer
 * data: the SQL, the table names, the error messages, the results. A denylist
 * ("strip the sensitive fields") fails the first time somebody adds
 * `{ error: err.message }` in good faith — and a Redshift error message carries
 * table names and sometimes values inside it.
 *
 * So the emitter accepts nothing it was not told about in advance, and the only
 * value that ever leaves is a command id drawn from a fixed, finite list. There
 * is no free-text field anywhere in the payload: customer data cannot get in,
 * not because we are careful, but because there is nowhere to put it.
 */

export type TelemetryEventName = 'activate' | 'command';

/** Property names permitted per event. Anything else is dropped. */
const ALLOWED_PROPERTIES: Record<TelemetryEventName, readonly string[]> = {
  activate: [],
  command: ['id'],
};

export interface SanitizedEvent {
  name: TelemetryEventName;
  properties: Record<string, string>;
}

/**
 * Validate an event before it can be sent. Returns undefined when the event
 * must be dropped — the caller never gets to send "most of" a payload.
 *
 * @param knownCommandIds the ids declared in package.json. A command id is only
 *   emitted if it is one of ours, so a caller cannot smuggle a string through
 *   the one field that exists.
 */
export function sanitizeEvent(
  name: string,
  properties: Record<string, unknown> | undefined,
  knownCommandIds: ReadonlySet<string>,
): SanitizedEvent | undefined {
  if (name !== 'activate' && name !== 'command') {
    return undefined;
  }
  const allowed = ALLOWED_PROPERTIES[name];
  const out: Record<string, string> = {};

  for (const key of allowed) {
    const value = properties?.[key];
    if (typeof value !== 'string') {
      return undefined; // a required field is missing or not a string
    }
    if (name === 'command' && key === 'id' && !knownCommandIds.has(value)) {
      return undefined; // not one of our commands — never forward it
    }
    out[key] = value;
  }

  // Anything the caller passed beyond the allowlist is a bug or an attempt to
  // widen the payload. Dropping the whole event is safer than quietly trimming
  // it, because it fails loudly in tests instead of shipping a partial leak.
  for (const key of Object.keys(properties ?? {})) {
    if (!allowed.includes(key)) {
      return undefined;
    }
  }
  return { name, properties: out };
}

/** Everything RedLens will never send, kept next to the code for the README. */
export const NEVER_SENT = [
  'SQL text',
  'schema, table or column names',
  'connection endpoints, database names, AWS account ids or namespace GUIDs',
  'error messages',
  'query results or row counts',
  'user or machine identifiers beyond what VS Code itself attaches',
] as const;
