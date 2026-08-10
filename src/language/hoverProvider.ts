import * as vscode from 'vscode';
import type { MetadataService } from '../metadata/metadataService';

/** Hover for SQL identifiers (M2 real-intellisense): table → its columns; column → its type. */
export function registerHoverProvider(metadata: MetadataService): vscode.Disposable {
  return vscode.languages.registerHoverProvider({ language: 'sql' }, {
    provideHover(document, position) {
      if (!metadata.hasSource()) {
        return undefined;
      }
      const range = document.getWordRangeAtPosition(position, /[A-Za-z_][\w$]*/);
      if (range === undefined) {
        return undefined;
      }
      const word = document.getText(range);
      const md = new vscode.MarkdownString();

      // Table?
      for (const schema of metadata.cachedSchemas()) {
        const table = metadata.cachedTables(schema).find((t) => t.name === word);
        if (table !== undefined) {
          const cols = metadata.cachedColumns(schema, table.name);
          md.appendMarkdown(`**${schema}.${table.name}** (${table.kind})\n\n`);
          md.appendMarkdown(cols.length > 0 ? cols.map((c) => `- \`${c.name}\` ${c.typeName}${c.nullable ? '' : ' NOT NULL'}`).join('\n') : '_columns not loaded yet_');
          return new vscode.Hover(md, range);
        }
      }

      // Column? report the first table where it appears.
      for (const schema of metadata.cachedSchemas()) {
        for (const table of metadata.cachedTables(schema)) {
          const col = metadata.cachedColumns(schema, table.name).find((c) => c.name === word);
          if (col !== undefined) {
            md.appendMarkdown(`\`${col.name}\` **${col.typeName}**${col.nullable ? '' : ' NOT NULL'} — in ${schema}.${table.name}`);
            return new vscode.Hover(md, range);
          }
        }
      }
      return undefined;
    },
  });
}
