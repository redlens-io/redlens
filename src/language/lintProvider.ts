import * as vscode from 'vscode';
import { lintSql, type LintSeverity } from './linter';

const SEVERITY: Record<LintSeverity, vscode.DiagnosticSeverity> = {
  warning: vscode.DiagnosticSeverity.Warning,
  info: vscode.DiagnosticSeverity.Information,
  hint: vscode.DiagnosticSeverity.Hint,
};

/** Live SQL diagnostics + quick-fixes (M2 `sql-linting`). */
export function registerLinter(context: vscode.ExtensionContext): void {
  const collection = vscode.languages.createDiagnosticCollection('redlens');
  context.subscriptions.push(collection);

  const lint = (doc: vscode.TextDocument) => {
    if (doc.languageId !== 'sql') {
      return;
    }
    const diagnostics = lintSql(doc.getText()).map((issue) => {
      const range = new vscode.Range(doc.positionAt(issue.start), doc.positionAt(issue.end));
      const d = new vscode.Diagnostic(range, issue.message, SEVERITY[issue.severity]);
      d.code = issue.code;
      d.source = 'RedLens';
      return d;
    });
    collection.set(doc.uri, diagnostics);
  };

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(lint),
    vscode.workspace.onDidChangeTextDocument((e) => lint(e.document)),
    vscode.workspace.onDidCloseTextDocument((doc) => collection.delete(doc.uri)),
    vscode.languages.registerCodeActionsProvider({ language: 'sql' }, {
      provideCodeActions(document, _range, ctx) {
        const actions: vscode.CodeAction[] = [];
        for (const d of ctx.diagnostics) {
          if (d.code === 'unsafe-delete' || d.code === 'unsafe-update') {
            const fix = new vscode.CodeAction('Add WHERE clause…', vscode.CodeActionKind.QuickFix);
            fix.diagnostics = [d];
            // Insert a snippet with the cursor after WHERE so the user types the
            // condition. The warning correctly STAYS until a real condition is
            // present (linter now requires one) — no false "fixed" signal (UXD-027).
            fix.edit = new vscode.WorkspaceEdit();
            fix.edit.set(document.uri, [
              new vscode.SnippetTextEdit(new vscode.Range(d.range.end, d.range.end), new vscode.SnippetString(' WHERE $0')),
            ]);
            actions.push(fix);
          }
        }
        return actions;
      },
    }),
  );
  vscode.workspace.textDocuments.forEach(lint);
}
