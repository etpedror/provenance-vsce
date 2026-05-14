import * as vscode from 'vscode';
import { ALLOWED_KEYS } from '../parser';

// One CompletionItem per allowed key, with documentation and a snippet for each.
const KEY_COMPLETIONS: vscode.CompletionItem[] = [
  makeItem(
    'requirement',
    'Work item that drove this code',
    'requirement: ${1:ID} (${2:jira}, ${3:2024-Q1})',
    vscode.CompletionItemKind.Field,
  ),
  makeItem(
    'reason',
    'Human-readable explanation of why this code exists',
    'reason: ${1:explanation}',
    vscode.CompletionItemKind.Text,
  ),
  makeItem(
    'invariant',
    'A rule that must never be violated',
    'invariant: ${1:rule}',
    vscode.CompletionItemKind.Constant,
  ),
  makeItem(
    'do-not-change',
    'Flags intentional, load-bearing complexity — triggers a warning on edit',
    'do-not-change: ${1:reason}',
    vscode.CompletionItemKind.Event,
  ),
  makeItem(
    'source',
    'Authorship: human, ai.claude, ai.copilot, ai.codex, …',
    'source: ${1|human,ai.claude,ai.copilot,ai.codex,ai.gemini,ai.cursor|}',
    vscode.CompletionItemKind.EnumMember,
  ),
  makeItem(
    'see-also',
    'Cross-references: file paths and/or requirement IDs (comma-separated)',
    'see-also: ${1:path/to/file.py#symbol, TICKET-123}',
    vscode.CompletionItemKind.Reference,
  ),
];

function makeItem(
  key: string,
  detail: string,
  snippet: string,
  kind: vscode.CompletionItemKind,
): vscode.CompletionItem {
  const item = new vscode.CompletionItem(key, kind);
  item.detail = detail;
  item.insertText = new vscode.SnippetString(snippet);
  item.documentation = new vscode.MarkdownString(
    `**\`${key}\`** — ${detail}\n\nSee the [ai-context spec](https://github.com/your-org/ai-context-spec) for full reference.`,
  );
  // Sort completions to the top within the suggestion list.
  item.sortText = `0_${key}`;
  return item;
}

// Completion items for the system attribute inside a requirement value.
const SYSTEM_COMPLETIONS: vscode.CompletionItem[] = ['jira', 'github', 'ado', 'linear'].map(s => {
  const item = new vscode.CompletionItem(s, vscode.CompletionItemKind.EnumMember);
  item.sortText = `0_${s}`;
  return item;
});

export class AiContextCompletionProvider implements vscode.CompletionItemProvider {
  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.CompletionItem[] | undefined {
    if (!this.insideAiContextBlock(document, position)) return undefined;

    const lineText = document.lineAt(position).text;
    const textBeforeCursor = lineText.slice(0, position.character);

    // Inside a requirement value after the opening paren — suggest system names.
    if (/requirement:\s*\S+\s*\([\w]*$/.test(textBeforeCursor)) {
      return SYSTEM_COMPLETIONS;
    }

    // At the start of a line (allowing comment markers) — suggest keys.
    if (/^[ \t*#/]*[\w-]*$/.test(textBeforeCursor)) {
      return KEY_COMPLETIONS;
    }

    return undefined;
  }

  /**
   * Returns true when `position` sits between an <pvnc> open and close tag
   * by scanning backwards and forwards from the cursor line.
   */
  private insideAiContextBlock(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): boolean {
    const text = document.getText();
    const offset = document.offsetAt(position);

    // Find the nearest <pvnc> or <provenance> open tag before the cursor.
    const pvncBefore = text.lastIndexOf('<pvnc>', offset);
    const provBefore = text.lastIndexOf('<provenance>', offset);
    const before = Math.max(pvncBefore, provBefore);
    if (before === -1) return false;

    // Make sure there is no closing tag between that open and the cursor.
    const pvncClose = text.indexOf('</pvnc>', before);
    const provClose = text.indexOf('</provenance>', before);
    const closeInBetween = [pvncClose, provClose].filter(n => n !== -1).reduce((a, b) => Math.min(a, b), Infinity);
    return closeInBetween > offset;
  }
}

// Exported for use in package.json triggerCharacters registration.
export const TRIGGER_CHARACTERS = ['\n', ' ', '-'];

// Sanity-check: completion provider covers all allowed keys.
const _: typeof ALLOWED_KEYS[number] = KEY_COMPLETIONS[0].label as typeof ALLOWED_KEYS[number];
void _;
