/**
 * Who the MCP server says it is during `initialize` — the one thing every
 * client learns about it before any tool call.
 *
 * The version is injected at build time (see esbuild.mjs) instead of being
 * written here, because a literal in this file can only be kept in step with
 * package.json by remembering to, and it was not: it read '0.0.1' for the whole
 * of 0.x while VS Code registered the very same server as 0.9.0. No client
 * refuses a mismatch, so nothing ever failed — it was simply wrong information
 * handed to the audience least able to question it.
 */

/** Replaced by esbuild with a string literal; absent under vitest/ts. */
declare const __REDLENS_VERSION__: string | undefined;

export const SERVER_NAME = 'redlens-redshift';

/** Deliberately unmistakable: a fallback that looks shipped hides build bugs. */
export const DEV_VERSION = '0.0.0-dev';

/** The build-time version, or undefined when running from source. */
export function injectedVersion(): string | undefined {
  return typeof __REDLENS_VERSION__ === 'string' ? __REDLENS_VERSION__ : undefined;
}

export function buildServerInfo(injected: string | undefined): { name: string; version: string } {
  return { name: SERVER_NAME, version: injected && injected.length > 0 ? injected : DEV_VERSION };
}
