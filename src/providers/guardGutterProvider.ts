/**
 * <pvnc>
 *     reason: Provide gutter shield icons on guard marker lines and an optional background tint for the interior of guarded regions
 *     source: ai.claude
 * </pvnc>
 */
import * as vscode from 'vscode';
import * as path from 'path';
import { parseDocument } from '../parser';
import { parseGuards } from '../guardParser';

export class GuardGutterProvider implements vscode.Disposable {
  private readonly markerDecoration: vscode.TextEditorDecorationType;
  private readonly malformedDecoration: vscode.TextEditorDecorationType;
  private regionDecoration: vscode.TextEditorDecorationType;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(context: vscode.ExtensionContext) {
    const icon = vscode.Uri.file(path.join(context.extensionPath, 'images', 'gutter-guard.svg'));

    this.markerDecoration = vscode.window.createTextEditorDecorationType({
      gutterIconPath: icon,
      gutterIconSize: 'contain',
    });

    this.malformedDecoration = vscode.window.createTextEditorDecorationType({
      gutterIconPath: icon,
      gutterIconSize: 'contain',
      after: {
        contentText: ' ⚠ malformed guard',
        color: new vscode.ThemeColor('editorWarning.foreground'),
        margin: '0 0 0 1em',
      },
    });

    this.regionDecoration = this.buildRegionDecoration();

    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(editor => {
        if (editor) this.update(editor);
      }),
      vscode.workspace.onDidChangeTextDocument(e => {
        const editor = vscode.window.activeTextEditor;
        if (editor?.document === e.document) this.update(editor);
      }),
      vscode.workspace.onDidChangeConfiguration(e => {
        if (
          e.affectsConfiguration('provenance.codeGuard.gutterHighlight') ||
          e.affectsConfiguration('provenance.codeGuard.regionTint') ||
          e.affectsConfiguration('provenance.codeGuard.regionTintColour')
        ) {
          this.regionDecoration.dispose();
          this.regionDecoration = this.buildRegionDecoration();
          const editor = vscode.window.activeTextEditor;
          if (editor) this.update(editor);
        }
      }),
    );

    if (vscode.window.activeTextEditor) {
      this.update(vscode.window.activeTextEditor);
    }
  }

  private buildRegionDecoration(): vscode.TextEditorDecorationType {
    const tintEnabled = vscode.workspace
      .getConfiguration('provenance.codeGuard')
      .get<boolean>('regionTint', true);
    const colour = vscode.workspace
      .getConfiguration('provenance.codeGuard')
      .get<string>('regionTintColour', '#ff000011');

    return vscode.window.createTextEditorDecorationType(
      tintEnabled ? { backgroundColor: colour, isWholeLine: true } : {},
    );
  }

  update(editor: vscode.TextEditor): void {
    const cfg = vscode.workspace.getConfiguration('provenance.codeGuard');
    const enabled = cfg.get<boolean>('enabled', true);
    const gutterEnabled = cfg.get<boolean>('gutterHighlight', true);

    if (!enabled) {
      editor.setDecorations(this.markerDecoration, []);
      editor.setDecorations(this.malformedDecoration, []);
      editor.setDecorations(this.regionDecoration, []);
      return;
    }

    const annotations = parseDocument(editor.document);
    const regions = parseGuards(editor.document, annotations);

    const markerRanges: vscode.Range[] = [];
    const malformedRanges: vscode.Range[] = [];
    const regionRanges: vscode.Range[] = [];

    for (const region of regions) {
      if (region.isMalformed) {
        malformedRanges.push(new vscode.Range(region.startLine, 0, region.startLine, 0));
        continue;
      }

      if (gutterEnabled) {
        markerRanges.push(new vscode.Range(region.startLine, 0, region.startLine, 0));
        if (region.endLine !== undefined) {
          markerRanges.push(new vscode.Range(region.endLine, 0, region.endLine, 0));
        }
      }

      if (region.endLine !== undefined) {
        for (let line = region.startLine + 1; line < region.endLine; line++) {
          regionRanges.push(new vscode.Range(line, 0, line, 0));
        }
      }
    }

    editor.setDecorations(this.markerDecoration, markerRanges);
    editor.setDecorations(this.malformedDecoration, malformedRanges);
    editor.setDecorations(this.regionDecoration, regionRanges);
  }

  dispose(): void {
    this.markerDecoration.dispose();
    this.malformedDecoration.dispose();
    this.regionDecoration.dispose();
    this.disposables.forEach(d => d.dispose());
  }
}
