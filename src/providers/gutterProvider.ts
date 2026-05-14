import * as vscode from 'vscode';
import * as path from 'path';
import { parseDocument } from '../parser';
import { AiContextAnnotation } from '../types';

type SourceCategory = 'ai' | 'human' | 'unknown';

function getCategory(ann: AiContextAnnotation): SourceCategory {
  // Use the most recent block that carries a source value.
  const source = [...ann.blocks].reverse().find(b => b.source)?.source;
  if (!source) return 'unknown';
  if (source.startsWith('ai.')) return 'ai';
  if (source === 'human') return 'human';
  return 'unknown';
}

export class GutterProvider implements vscode.Disposable {
  private readonly decorations: Record<SourceCategory, vscode.TextEditorDecorationType>;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(context: vscode.ExtensionContext) {
    const icon = (name: string) =>
      vscode.Uri.file(path.join(context.extensionPath, 'images', name));

    this.decorations = {
      ai:      vscode.window.createTextEditorDecorationType({ gutterIconPath: icon('gutter-ai.svg'),      gutterIconSize: 'contain' }),
      human:   vscode.window.createTextEditorDecorationType({ gutterIconPath: icon('gutter-human.svg'),   gutterIconSize: 'contain' }),
      unknown: vscode.window.createTextEditorDecorationType({ gutterIconPath: icon('gutter-unknown.svg'), gutterIconSize: 'contain' }),
    };

    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(editor => {
        if (editor) this.update(editor);
      }),
      vscode.workspace.onDidChangeTextDocument(e => {
        const editor = vscode.window.activeTextEditor;
        if (editor?.document === e.document) this.update(editor);
      }),
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('provenance.gutterIcons')) {
          const editor = vscode.window.activeTextEditor;
          if (editor) this.update(editor);
        }
      }),
    );

    if (vscode.window.activeTextEditor) {
      this.update(vscode.window.activeTextEditor);
    }
  }

  update(editor: vscode.TextEditor): void {
    const enabled = vscode.workspace
      .getConfiguration('provenance')
      .get<boolean>('gutterIcons', true);

    const categories: SourceCategory[] = ['ai', 'human', 'unknown'];

    if (!enabled) {
      categories.forEach(c => editor.setDecorations(this.decorations[c], []));
      return;
    }

    const annotations = parseDocument(editor.document);
    const ranges: Record<SourceCategory, vscode.DecorationOptions[]> = {
      ai: [], human: [], unknown: [],
    };

    for (const ann of annotations) {
      const cat = getCategory(ann);
      for (const block of ann.blocks) {
        for (let line = block.startLine; line <= block.endLine; line++) {
          ranges[cat].push({ range: new vscode.Range(line, 0, line, 0) });
        }
      }
    }

    categories.forEach(c => editor.setDecorations(this.decorations[c], ranges[c]));
  }

  dispose(): void {
    Object.values(this.decorations).forEach(d => d.dispose());
    this.disposables.forEach(d => d.dispose());
  }
}
