import * as vscode from 'vscode';
import { formatSql } from './formatter';

/** Registers Format Document (Shift+Alt+F / format-on-save) for SQL files. */
export function registerFormatProvider(): vscode.Disposable {
  return vscode.languages.registerDocumentFormattingEditProvider('sql', {
    provideDocumentFormattingEdits(document) {
      try {
        const original = document.getText();
        const formatted = formatSql(original);
        // No-op when already formatted (UXD-043): returning a full-range replace
        // for identical text still marks the doc dirty and pushes an empty undo
        // step (and resets selection/folds on format-on-save).
        if (formatted === original) {
          return [];
        }
        const fullRange = new vscode.Range(
          document.positionAt(0),
          document.positionAt(original.length),
        );
        return [vscode.TextEdit.replace(fullRange, formatted)];
      } catch (err) {
        void vscode.window.showWarningMessage(`RedLens: could not format SQL — ${err instanceof Error ? err.message : String(err)}`);
        return [];
      }
    },
  });
}
