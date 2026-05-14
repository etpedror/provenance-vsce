import * as vscode from 'vscode';
import { TextDocumentLike } from './types';

/**
 * <pvnc>
 *     requirement: UNKNOWN
 *     reason: Provide a TextDocumentLike that wraps raw file bytes so analyzeWorkspace can parse files without opening them as editor buffers
 *     source: ai.claude
 * </pvnc>
 */
export class RawTextDocument implements TextDocumentLike {
  readonly version = 0;
  readonly languageId: string;
  private readonly _text: string;
  private readonly _lines: string[];
  private readonly _lineOffsets: number[];

  constructor(readonly uri: vscode.Uri, bytes: Uint8Array) {
    this._text = new TextDecoder().decode(bytes);

    const ext = uri.fsPath.split('.').pop()?.toLowerCase() ?? '';
    this.languageId = ext === 'md' || ext === 'mdx' ? 'markdown' : ext;

    this._lines = [];
    this._lineOffsets = [0];
    let lineStart = 0;
    for (let i = 0; i <= this._text.length; i++) {
      if (i === this._text.length || this._text[i] === '\n') {
        const end = i > 0 && this._text[i - 1] === '\r' ? i - 1 : i;
        this._lines.push(this._text.slice(lineStart, end));
        if (i < this._text.length) this._lineOffsets.push(i + 1);
        lineStart = i + 1;
      }
    }
  }

  get lineCount(): number { return this._lines.length; }
  getText(): string { return this._text; }
  lineAt(line: number): { readonly text: string } { return { text: this._lines[line] ?? '' }; }

  positionAt(offset: number): { readonly line: number; readonly character: number } {
    const clamped = Math.max(0, Math.min(offset, this._text.length));
    let lo = 0, hi = this._lineOffsets.length - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (this._lineOffsets[mid] <= clamped) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo, character: clamped - this._lineOffsets[lo] };
  }

  offsetAt(position: { readonly line: number; readonly character: number }): number {
    const line = Math.max(0, Math.min(position.line, this._lines.length - 1));
    return this._lineOffsets[line] + Math.max(0, Math.min(position.character, this._lines[line].length));
  }
}
