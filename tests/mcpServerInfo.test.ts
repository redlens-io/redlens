import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildServerInfo, DEV_VERSION } from '../mcp-server/serverInfo';

/**
 * The MCP server tells every client who it is during `initialize`. That string
 * was hardcoded to '0.0.1' and had been since the first commit, while the
 * extension shipped 0.9.0 — so VS Code registered the definition as 0.9.0
 * (`McpStdioServerDefinition` gets `packageJSON.version`) and the process it
 * launched then introduced itself as something else entirely.
 *
 * Nothing breaks: no client refuses a version mismatch. It is simply wrong
 * information, given to the exact audience — AI agents — that has no way to
 * question it, and it would have drifted further with every release.
 *
 * Found while diagnosing a live "the MCP is broken" report on 2026-07-30. The
 * report turned out to be Copilot in Ask mode (MCP tools only run in Agent
 * mode); this was the real defect underneath.
 */

const pkgVersion = (JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }).version;

describe('MCP server identity', () => {
  it('advertises the version the extension actually ships', () => {
    expect(buildServerInfo(pkgVersion).version).toBe(pkgVersion);
    expect(buildServerInfo(pkgVersion).name).toBe('redlens-redshift');
  });

  it('falls back to an obviously-not-a-release version when the build did not inject one', () => {
    // A fallback that looks like a real version is worse than no fallback: it
    // is indistinguishable from a shipped build in a bug report.
    expect(buildServerInfo(undefined).version).toBe(DEV_VERSION);
    expect(buildServerInfo('').version).toBe(DEV_VERSION);
    expect(DEV_VERSION).toMatch(/dev/);
  });

  it('keeps no literal version in the server entry point', () => {
    // The guard that would have caught the original defect: a version literal
    // in index.ts cannot be kept in step with package.json by anything but
    // memory, and memory is what failed here.
    const src = readFileSync('mcp-server/index.ts', 'utf8');
    expect(src).not.toMatch(/version:\s*['"][0-9]/);
  });
});
