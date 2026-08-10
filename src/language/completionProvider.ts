import * as vscode from 'vscode';
import { computeSuggestions, introspectionPlan, parseAliases, type CompletionCache, type Suggestion } from './completion';
import type { MetadataService } from '../metadata/metadataService';

const KIND_MAP: Record<Suggestion['kind'], vscode.CompletionItemKind> = {
  schema: vscode.CompletionItemKind.Module,
  table: vscode.CompletionItemKind.Struct,
  column: vscode.CompletionItemKind.Field,
  keyword: vscode.CompletionItemKind.Keyword,
  function: vscode.CompletionItemKind.Function,
};

export function registerCompletionProvider(metadata: MetadataService): vscode.Disposable {
  const provider: vscode.CompletionItemProvider = {
    async provideCompletionItems(document, position) {
      // Even with no connection, still offer the static SQL keywords/functions —
      // they need no database (UXD-028). Only schema/table/column suggestions
      // require a source, so we warm the cache only when there is one.
      const hasSource = metadata.hasSource();
      if (hasSource) {
        // Warm the schema/table cache in the background; suggestions come from
        // whatever is already loaded so typing never blocks on the database.
        void warmCache(metadata, document, position);
      }

      const linePrefix = document.getText(new vscode.Range(position.line, 0, position.line, position.character));
      const cache: CompletionCache = hasSource
        ? {
          schemas: metadata.cachedSchemas(),
          tables: (s) => metadata.cachedTables(s),
          columns: (s, t) => metadata.cachedColumns(s, t),
        }
        : { schemas: [], tables: () => [], columns: () => [] };
      const aliases = parseAliases(document.getText());
      return computeSuggestions(linePrefix, cache, aliases).map((s) => {
        const item = new vscode.CompletionItem(s.label, KIND_MAP[s.kind]);
        item.detail = s.detail;
        if (s.kind === 'function') {
          item.insertText = new vscode.SnippetString(`${s.label}($0)`);
        }
        return item;
      });
    },
  };
  return vscode.languages.registerCompletionItemProvider({ language: 'sql' }, provider, '.', '"');
}

async function warmCache(metadata: MetadataService, document: vscode.TextDocument, position: vscode.Position): Promise<void> {
  try {
    const schemas = await metadata.listSchemas();
    const linePrefix = document.getText(new vscode.Range(position.line, 0, position.line, position.character));
    const qualifier = /([A-Za-z_][\w$]*)\.$/.exec(linePrefix)?.[1];
    if (qualifier !== undefined && schemas.includes(qualifier)) {
      await metadata.listTables(qualifier);
    } else {
      // introspection-levels: 'names' avoids prefetching tables for every schema
      // (cheap on huge Redshift catalogs); 'full' preloads the first few.
      const level = vscode.workspace.getConfiguration('redlens').get<'names' | 'full'>('introspectionLevel', 'names');
      const { prefetchSchemas } = introspectionPlan(level);
      await Promise.all(schemas.slice(0, prefetchSchemas).map((s) => metadata.listTables(s)));
      if (qualifier !== undefined) {
        for (const schema of schemas) {
          const table = metadata.cachedTables(schema).find((t) => t.name === qualifier);
          if (table !== undefined) {
            await metadata.listColumns(schema, qualifier);
            break;
          }
        }
      }
    }
  } catch {
    // Cache warming is best-effort; completion falls back to keywords.
  }
}
