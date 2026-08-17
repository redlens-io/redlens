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

/**
 * The funnel D3 asks for — install → trial → activation → purchase — plus the
 * two operational events that were already here.
 *
 * Every one of these is a COUNT with no free text. "How many people who
 * installed started a trial, and how many of those activated a licence" is
 * answerable from names alone; nothing about WHO, WHAT they queried, or WHERE
 * their warehouse is can be reconstructed from any of it.
 */
export type TelemetryEventName =
  | 'activate'
  | 'command'
  /** First ever activation on this machine — the top of the funnel. */
  | 'install'
  /** The 14-day trial began. */
  | 'trial-started'
  /** A licence key verified successfully. The bottom of the funnel: a purchase
   *  that Polar recorded is not the same as one that WORKED on a machine, and
   *  the gap between those two numbers is the only way to see a broken
   *  activation path before customers report it. */
  | 'licence-activated';

/** Property names permitted per event. Anything else is dropped. */
const ALLOWED_PROPERTIES: Record<TelemetryEventName, readonly string[]> = {
  activate: [],
  command: ['id'],
  install: [],
  'trial-started': [],
  // The PLAN only — never the email, the key, the seat count or the machine id.
  // Knowing that Team licences activate is useful; knowing whose is not.
  'licence-activated': ['plan'],
};

/** The only values `licence-activated.plan` may carry. */
const ALLOWED_PLANS = new Set(['pro', 'team', 'enterprise']);

/** Narrows an arbitrary string to the catalogue, so the check and the type
 *  agree — a name that passes here is one the allowlist has an entry for. */
function isKnownEvent(name: string): name is TelemetryEventName {
  return Object.prototype.hasOwnProperty.call(ALLOWED_PROPERTIES, name);
}

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
  if (!isKnownEvent(name)) {
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
    if (name === 'licence-activated' && key === 'plan' && !ALLOWED_PLANS.has(value)) {
      return undefined; // the plan is a closed set; anything else is not ours
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
