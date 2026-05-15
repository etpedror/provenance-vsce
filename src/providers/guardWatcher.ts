/**
 * <pvnc>
 *     reason: Warn users when they edit lines within a pvnc.guard_start/end region before they have committed a guard_removed declaration
 *     source: ai.claude
 * </pvnc>
 */
import * as vscode from 'vscode';
import { parseDocument } from '../parser';
import { findGuardForLine, parseGuards } from '../guardParser';

export class GuardWatcher implements vscode.Disposable {
  private readonly disposable: vscode.Disposable;
  private readonly debounce = new Map<string, ReturnType<typeof setTimeout>>();

  constructor() {
    this.disposable = vscode.workspace.onDidChangeTextDocument(e =>
      this.onDocumentChange(e),
    );
  }

  private onDocumentChange(e: vscode.TextDocumentChangeEvent): void {
    if (
      !vscode.workspace
        .getConfiguration('provenance.codeGuard')
        .get<boolean>('warnOnEdit', true) ||
      !vscode.workspace
        .getConfiguration('provenance.codeGuard')
        .get<boolean>('enabled', true)
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
    const annotations = parseDocument(document);
    const regions = parseGuards(document, annotations).filter(r => !r.isMalformed && r.endLine !== undefined);
    if (regions.length === 0) return;

    for (const change of changes) {
      const hit = findGuardForLine(change.range.start.line, regions);
      if (hit) {
        const msg =
          `⛔ Code Guard active — \`${hit.blockId}\`\n` +
          `This region is protected. To modify it, commit a \`pvnc.guard_removed\` declaration first.\n` +
          `Run "Provenance: Remove guard" to scaffold the commit message.`;

        vscode.window
          .showWarningMessage(msg, 'Scaffold removal')
          .then(action => {
            if (action === 'Scaffold removal') {
              vscode.commands.executeCommand('provenance.removeGuard', hit.blockId);
            }
          });
        return;
      }
    }
  }

  dispose(): void {
    this.debounce.forEach(t => clearTimeout(t));
    this.debounce.clear();
    this.disposable.dispose();
  }
}
