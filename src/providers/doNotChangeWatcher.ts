import * as vscode from 'vscode';
import { parseDocument } from '../parser';
import { AiContextAnnotation } from '../types';

export class DoNotChangeWatcher implements vscode.Disposable {
  private readonly disposable: vscode.Disposable;
  /** Per-document debounce timers — fire 300 ms after the last keystroke. */
  private readonly debounce = new Map<string, ReturnType<typeof setTimeout>>();

  constructor() {
    this.disposable = vscode.workspace.onDidChangeTextDocument(e =>
      this.onDocumentChange(e),
    );
  }

  private onDocumentChange(e: vscode.TextDocumentChangeEvent): void {
    if (
      !vscode.workspace
        .getConfiguration('provenance')
        .get<boolean>('warnOnDoNotChange', true)
    ) {
      return;
    }

    const key = e.document.uri.toString();
    const existing = this.debounce.get(key);
    if (existing !== undefined) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.debounce.delete(key);
      this.checkChanges(e.document, e.contentChanges);
    }, 300);

    this.debounce.set(key, timer);
  }

  private checkChanges(
    document: vscode.TextDocument,
    changes: readonly vscode.TextDocumentContentChangeEvent[],
  ): void {
    const annotations = parseDocument(document).filter(a => a.hasDoNotChange);
    if (annotations.length === 0) return;

    for (const change of changes) {
      const hit = this.findGuardedAnnotation(
        change.range.start.line,
        annotations,
      );
      if (hit) {
        const reasons = hit.blocks
          .filter(b => b.doNotChange !== undefined)
          .map(b => (b.doNotChange ? b.doNotChange : 'no reason given'))
          .join('; ');

        vscode.window.showWarningMessage(
          `This block is marked do-not-change (reason: ${reasons}). Proceed with intention.`,
        );
        return; // one warning per change batch is enough
      }
    }
  }

  private findGuardedAnnotation(
    changedLine: number,
    annotations: AiContextAnnotation[],
  ): AiContextAnnotation | undefined {
    return annotations.find(
      a =>
        changedLine >= a.guardedStartLine && changedLine <= a.guardedEndLine,
    );
  }

  dispose(): void {
    this.debounce.forEach(t => clearTimeout(t));
    this.debounce.clear();
    this.disposable.dispose();
  }
}
