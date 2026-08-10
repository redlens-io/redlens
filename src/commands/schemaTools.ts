import * as vscode from 'vscode';
import { gatedCommand } from '../licensing/gate';
import { generateMockInserts } from '../schema/mockData';
import { layoutErd, erdToSvg, type ErdTable, type ErdFk } from '../schema/erdLayout';
import { ErdPanel } from '../schema/erdPanel';
import { csvToInserts } from '../schema/csvImport';
import { createTableTemplate } from '../schema/tableDesigner';
import { queryAll } from '../query/collect';
import { maskRows } from '../pii/piiMask';
import { readPiiConfig } from '../pii/piiSettings';
import { quoteIdent } from '../query/runner';
import { tableNodeToPreviewArgs } from '../explorer/explorerProvider';
import type { ResultSnapshot } from '../grid/compareResults';
import type { ConnectionManager } from '../connections/connectionManager';
import type { MetadataService } from '../metadata/metadataService';

/** M7 schema/DDL utilities: schema-compare and mock-data-generator (more land in
 * later M7 batches). */
export function registerSchemaTools(
  context: vscode.ExtensionContext,
  manager: ConnectionManager,
  metadata: MetadataService,
): void {
  const erdPanel = new ErdPanel();
  context.subscriptions.push(erdPanel);

  context.subscriptions.push(
    gatedCommand('redlens.schemaDiagram', async () => {
      if (manager.getActive() === undefined) {
        void vscode.window.showInformationMessage('RedLens: connect first to draw the ERD.');
        return;
      }
      const schemas = await metadata.listSchemas();
      const schema = schemas.length === 1 ? schemas[0]
        : await vscode.window.showQuickPick(schemas, { title: 'RedLens: ERD for which schema?' });
      if (schema === undefined) return;
      try {
        const tableInfos = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Window, title: `RedLens: building ERD for ${schema}…` },
          () => metadata.listTables(schema),
        );
        const erdTables: ErdTable[] = [];
        const fks: ErdFk[] = [];
        for (const t of tableInfos) {
          const cols = await metadata.listColumns(schema, t.name);
          const tfks = await metadata.listForeignKeys(schema, t.name);
          erdTables.push({ name: t.name, columns: cols.map((c) => ({ name: c.name, typeName: c.typeName })) });
          for (const fk of tfks) {
            if (fk.refSchema === schema) {
              fks.push({ from: t.name, to: fk.refTable });
            }
          }
        }
        if (erdTables.length === 0) {
          void vscode.window.showInformationMessage(`RedLens: schema ${schema} has no tables to diagram.`);
          return;
        }
        erdPanel.show(erdToSvg(layoutErd(erdTables, fks)), schema);
      } catch (err) {
        void vscode.window.showErrorMessage(`RedLens: ERD failed — ${message(err)}`);
      }
    }),

    gatedCommand('redlens.importCsv', async () => {
      const uris = await vscode.window.showOpenDialog({
        title: 'RedLens: pick a CSV/TSV file to import',
        canSelectMany: false,
        filters: { 'CSV/TSV': ['csv', 'tsv', 'txt'] },
      });
      if (uris === undefined || uris.length === 0) return;
      const text = Buffer.from(await vscode.workspace.fs.readFile(uris[0]!)).toString('utf8');
      const headerChoice = await vscode.window.showQuickPick(['First row is a header', 'No header (use col1, col2, …)'], {
        title: 'RedLens: does the file have a header row?',
        ignoreFocusOut: true, // consistent with the file dialog + target-table prompt (UXD-014)
      });
      if (headerChoice === undefined) return;
      const base = uris[0]!.path.split('/').pop()?.replace(/\.[^.]+$/, '') ?? 'imported';
      const target = await vscode.window.showInputBox({
        title: 'RedLens: target table (schema.table)', value: `public.${base}`, ignoreFocusOut: true,
      });
      if (target === undefined || !target.includes('.')) {
        if (target !== undefined) void vscode.window.showWarningMessage('RedLens: use schema.table.');
        return;
      }
      const [schema, table] = target.split('.', 2) as [string, string];
      const sql = `-- Import of ${uris[0]!.path.split('/').pop()} into ${schema}.${table} — review before running\n\n`
        + csvToInserts(text, schema, table, { hasHeader: headerChoice.startsWith('First'), maxRows: 5000 });
      const doc = await vscode.workspace.openTextDocument({ language: 'sql', content: sql + '\n' });
      await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
    }),

    gatedCommand('redlens.newTable', async () => {
      const target = await vscode.window.showInputBox({
        title: 'RedLens: new table name (schema.table)', value: 'public.my_table', ignoreFocusOut: true,
      });
      if (target === undefined || !target.includes('.')) {
        if (target !== undefined) void vscode.window.showWarningMessage('RedLens: use schema.table.');
        return;
      }
      const [schema, table] = target.split('.', 2) as [string, string];
      const doc = await vscode.workspace.openTextDocument({ language: 'sql', content: createTableTemplate(schema, table) + '\n' });
      await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
    }),

    gatedCommand('redlens.generateMockData', async (node: unknown) => {
      const args = tableNodeToPreviewArgs(node);
      if (args === undefined) {
        void vscode.window.showInformationMessage('RedLens: right-click a table in the explorer to generate mock data.');
        return;
      }
      const countText = await vscode.window.showInputBox({
        title: `RedLens: how many mock rows for ${args.schema}.${args.table}?`, value: '20', ignoreFocusOut: true,
      });
      if (countText === undefined) return;
      const count = Number.parseInt(countText, 10);
      if (!Number.isFinite(count) || count <= 0) {
        void vscode.window.showWarningMessage('RedLens: enter a positive row count.');
        return;
      }
      try {
        const columns = (await metadata.listColumns(args.schema, args.table)).map((c) => ({ name: c.name, typeName: c.typeName }));
        const sql = `-- Mock data for ${args.schema}.${args.table} (${count} rows) — review before inserting\n\n`
          + generateMockInserts(args.schema, args.table, columns, count, 1);
        const doc = await vscode.workspace.openTextDocument({ language: 'sql', content: sql + '\n' });
        await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
      } catch (err) {
        void vscode.window.showErrorMessage(`RedLens: mock data failed — ${message(err)}`);
      }
    }),
  );
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
