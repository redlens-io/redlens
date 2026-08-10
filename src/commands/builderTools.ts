import * as vscode from 'vscode';
import { gatedCommand } from '../licensing/gate';
import { QueryBuilderPanel, type TableRef } from '../query/queryBuilderPanel';
import { GeoMapPanel } from '../geo/geoMapPanel';
import { collectShapes, pickGeometryColumn } from '../geo/geoParse';
import { geoToSvg } from '../geo/geoSvg';
import { queryAll } from '../query/collect';
import { quoteIdent } from '../query/runner';
import type { ConnectionManager } from '../connections/connectionManager';
import type { MetadataService } from '../metadata/metadataService';

/** M7 batch 4 (closes M7): visual-query-builder + gis-map-viewer. */
export function registerBuilderTools(
  context: vscode.ExtensionContext,
  manager: ConnectionManager,
  metadata: MetadataService,
): void {
  const mapPanel = new GeoMapPanel();
  const builder = new QueryBuilderPanel({
    loadColumns: async (schema, table) => (await metadata.listColumns(schema, table)).map((c) => c.name),
    onOpen: (sql) => { void openSql(sql); },
    onRun: (sql) => { void runSql(sql); },
  });
  context.subscriptions.push(mapPanel, builder);

  context.subscriptions.push(
    gatedCommand('redlens.queryBuilder', async () => {
      if (manager.getActive() === undefined) {
        void vscode.window.showInformationMessage('RedLens: connect first to build a query.');
        return;
      }
      const tables = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: 'RedLens: loading tables…' },
        () => gatherTables(metadata),
      );
      if (tables.length === 0) {
        void vscode.window.showInformationMessage('RedLens: no tables found to build a query from.');
        return;
      }
      await builder.show(tables);
    }),

    gatedCommand('redlens.mapView', async () => {
      const active = manager.getActive();
      if (active === undefined) {
        void vscode.window.showInformationMessage('RedLens: connect first to view geometry on a map.');
        return;
      }
      const items: (vscode.QuickPickItem & TableRef)[] = [];
      for (const schema of await metadata.listSchemas()) {
        for (const t of await metadata.listTables(schema)) {
          items.push({ label: `${schema}.${t.name}`, schema, table: t.name });
        }
      }
      if (items.length === 0) { // avoid a dead-end empty picker (UXD-013)
        void vscode.window.showInformationMessage('RedLens: no tables found to map.');
        return;
      }
      const pick = await vscode.window.showQuickPick(items, { title: 'RedLens: map which table? (needs a WKT/GeoJSON column)' });
      if (pick === undefined) return;
      try {
        const { columns, rows } = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Window, title: `RedLens: reading ${pick.schema}.${pick.table}…` },
          () => queryAll(active.transport, `SELECT * FROM ${quoteIdent(pick.schema)}.${quoteIdent(pick.table)} LIMIT 2000`),
        );
        const gcol = pickGeometryColumn(columns, rows);
        if (gcol < 0) {
          void vscode.window.showInformationMessage(
            'RedLens: no geometry column detected. Provide WKT or GeoJSON as text — on Redshift wrap the GEOMETRY column with ST_AsText(geom) or ST_AsGeoJSON(geom).',
          );
          return;
        }
        const shapes = collectShapes(rows.map((r) => r[gcol] as string));
        mapPanel.show(geoToSvg(shapes), `${pick.schema}.${pick.table} · ${columns[gcol]!.name} (${shapes.length} shapes)`);
      } catch (err) {
        void vscode.window.showErrorMessage(`RedLens: map view failed — ${err instanceof Error ? err.message : String(err)}`);
      }
    }),
  );
}

async function gatherTables(metadata: MetadataService): Promise<TableRef[]> {
  const out: TableRef[] = [];
  for (const schema of await metadata.listSchemas()) {
    for (const t of await metadata.listTables(schema)) {
      out.push({ schema, table: t.name });
    }
  }
  return out;
}

async function openSql(sql: string): Promise<void> {
  const doc = await vscode.workspace.openTextDocument({ language: 'sql', content: sql + '\n' });
  await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
}

async function runSql(sql: string): Promise<void> {
  const doc = await vscode.workspace.openTextDocument({ language: 'sql', content: sql + '\n' });
  await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
  await vscode.commands.executeCommand('redlens.runQuery');
}
