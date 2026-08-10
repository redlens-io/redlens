import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  ALWAYS_FREE, FEATURE_TIERS, clusterSectionFeature, pitchFor, requiresPro, tierOf,
} from '../src/licensing/tiers';
import { allTools } from '../src/tools/catalog';

describe('the tier map is the only place that decides', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
    contributes: { commands: { command: string }[] };
  };

  it('classifies every command the extension declares', () => {
    const unclassified = pkg.contributes.commands
      .map((c) => c.command)
      .filter((id) => FEATURE_TIERS[id] === undefined);
    expect(unclassified, `commands with no tier: ${unclassified.join(', ')}`).toEqual([]);
  });

  it('names no command that does not exist somewhere', () => {
    const declared = new Set(pkg.contributes.commands.map((c) => c.command));
    // Four id families are deliberately not commands: MCP tools, Cluster view
    // sections, tree sections gated on expansion, and the chat participant.
    //
    // Since the open-core split there is a fifth exemption, and it is the more
    // interesting one: a Pro id may be absent from THIS manifest because the
    // Pro extension declares it. That is the split working, not a stale entry.
    // The corresponding guard — that Pro declares every one of them — lives in
    // the Pro package, which is the only place that can check it.
    const stale = Object.keys(FEATURE_TIERS)
      .filter((id) => !id.startsWith('redlens.mcp.')
        && !id.startsWith('redlens.cluster.section.')
        && !id.startsWith('redlens.governance.')
        && !id.startsWith('redlens.chat.'))
      .filter((id) => !declared.has(id))
      .filter((id) => !requiresPro(id));
    expect(stale, `tier map names Free commands that are gone: ${stale.join(', ')}`).toEqual([]);
  });

  it('gates the Pro surfaces that are not commands at all', () => {
    // Three Pro things have no command id, so the command gate never sees them.
    // Each is checked where it is reached; without that the tier is paperwork.
    // The participant itself moved to the Pro package in the Fase O split, and
    // the check that it is gated moved with it (packages/pro's own suite). What
    // stays here is the decision: this tier map is the public record of what is
    // paid, and it has to keep saying so even though the code is elsewhere.
    expect(tierOf('redlens.chat.participant')).toBe('pro');
  });

  it('gates the Pro features that are tree sections rather than commands', () => {
    // RLS/masking is Pro by the M8 decision but has no command id, so the
    // command gate never sees it — it is checked when the node expands. A tier
    // with no gate is a decision that only exists on paper.
    expect(tierOf('redlens.governance.securityPolicies')).toBe('pro');
    const explorer = readFileSync('src/explorer/explorerProvider.ts', 'utf8');
    expect(explorer, 'the Security policies section is not gated').toContain(
      "pro.isLocked('redlens.governance.securityPolicies')",
    );
  });

  it('treats an unknown feature as free — a missing entry must never lock anyone out', () => {
    expect(tierOf('redlens.somethingNobodyClassified')).toBe('free');
    expect(requiresPro('redlens.somethingNobodyClassified')).toBe(false);
  });
});

describe('the promises that cannot be walked back', () => {
  it('keeps every safety feature free', () => {
    for (const id of ['redlens.toggleReadOnly', 'redlens.toggleProduction', 'redlens.togglePiiSafeMode', 'redlens.toggleAutoCommit']) {
      expect(tierOf(id), `${id} must stay free`).toBe('free');
    }
  });

  it('never charges for connections, in any form', () => {
    for (const id of ALWAYS_FREE) {
      expect(tierOf(id), `${id} is in ALWAYS_FREE but marked pro`).toBe('free');
    }
  });

  it('keeps the entire result grid free — that is where DBeaver is fought', () => {
    for (const id of ['redlens.chartResults', 'redlens.toggleHeatmap', 'redlens.transposeResults',
      'redlens.groupResults', 'redlens.pinBaseline', 'redlens.compareResults', 'redlens.editTableData',
      'redlens.pasteRowsIntoGrid', 'redlens.commitGridEdits']) {
      expect(tierOf(id), `${id} must stay free`).toBe('free');
    }
  });

  it('keeps the governance tree and viewers free (the DBeaver CE kill shot)', () => {
    for (const id of ['redlens.datashares', 'redlens.showPrivileges', 'redlens.scriptGrants']) {
      expect(tierOf(id)).toBe('free');
    }
  });

  it('keeps MCP read-only basics free and the moat tools Pro', () => {
    expect(tierOf('redlens.mcp.list')).toBe('free');
    expect(tierOf('redlens.mcp.executeQuery')).toBe('free');
    expect(tierOf('redlens.mcp.explainQuery')).toBe('free');
    expect(tierOf('redlens.mcp.executeWrite')).toBe('pro');
    expect(tierOf('redlens.mcp.tableHealth')).toBe('pro');
  });
});

describe('the split Diego approved on 2026-07-26', () => {
  it('puts all five AI utilities in Pro', () => {
    for (const id of ['redlens.nlToSql', 'redlens.explainPlanAI', 'redlens.optimizeQuery',
      'redlens.fixLastError', 'redlens.describeObject']) {
      expect(tierOf(id), `${id} should be Pro`).toBe('pro');
    }
  });

  it('gives away Cluster properties and charges for the rest of the console', () => {
    expect(tierOf(clusterSectionFeature('properties'))).toBe('free');
    for (const section of ['parameters', 'network', 'snapshots', 'maintenance', 'logging', 'scheduled', 'limits', 'events', 'reserved']) {
      expect(tierOf(clusterSectionFeature(section)), section).toBe('pro');
    }
  });

  it('charges for the moat: dashboard, advisor and monitoring', () => {
    expect(tierOf('redlens.showDashboard')).toBe('pro');
    expect(tierOf('redlens.tableAdvisor')).toBe('pro');
    expect(tierOf('redlens.monitoring')).toBe('pro');
    // ...but sessions and locks stay free: that is incident triage, not advice.
    expect(tierOf('redlens.sessionsLocks')).toBe('free');
  });

  it('leaves a Free tier that is a complete daily loop', () => {
    const freeCommands = Object.entries(FEATURE_TIERS).filter(([, t]) => t === 'free');
    expect(freeCommands.length).toBeGreaterThan(45);
    // The loop itself, end to end.
    for (const id of ['redlens.addConnection', 'redlens.runQuery', 'redlens.showHistory',
      'redlens.previewTable', 'redlens.editTableData', 'redlens.importCsv', 'redlens.explainQuery']) {
      expect(tierOf(id), id).toBe('free');
    }
  });

  it('explains every Pro tool in the catalog with something specific', () => {
    for (const tool of allTools()) {
      if (requiresPro(tool.command)) {
        const pitch = pitchFor(tool.command);
        expect(pitch.length, `${tool.command} has no pitch`).toBeGreaterThan(20);
        expect(pitch).not.toMatch(/upgrade to continue/i);
      }
    }
  });
});
