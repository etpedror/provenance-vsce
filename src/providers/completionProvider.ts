import * as vscode from 'vscode';

const KNOWN_SYSTEMS = ['github', 'jira', 'ado', 'linear', 'confluence'] as const;

// Keys that work inside <pvnc> blocks or as pvnc.<key> inline annotations.
// Ticket systems (github, jira, …) are also valid but listed separately.
const FIELD_COMPLETIONS: vscode.CompletionItem[] = [
  makeItem('reason',        'Why this code exists or changed',                         'reason: ${1:explanation}',                                              vscode.CompletionItemKind.Text),
  makeItem('source',        'Authorship: human, ai.claude, ai.copilot, …',             'source: ${1|human,ai.claude,ai.copilot,ai.codex,ai.gemini,ai.cursor|}', vscode.CompletionItemKind.EnumMember),
  makeItem('invariant',     'A rule that must never be violated',                       'invariant: ${1:rule}',                                                  vscode.CompletionItemKind.Constant),
  makeItem('do-not-change', 'Flags load-bearing complexity — warns on edit',           'do-not-change: ${1:reason}',                                            vscode.CompletionItemKind.Event),
  makeItem('see-also',      'Cross-references: file paths or IDs (comma-separated)',   'see-also: ${1:path/to/file.py}',                                        vscode.CompletionItemKind.Reference),
];

const SYSTEM_COMPLETIONS: vscode.CompletionItem[] = [
  makeItem('github',     'GitHub issue',           'github: ${1:issue-number}',    vscode.CompletionItemKind.Field),
  makeItem('jira',       'Jira ticket',            'jira: ${1:PROJ-123}',          vscode.CompletionItemKind.Field),
  makeItem('ado',        'Azure DevOps work item', 'ado: ${1:work-item-id}',       vscode.CompletionItemKind.Field),
  makeItem('linear',     'Linear issue',           'linear: ${1:TEAM-123}',        vscode.CompletionItemKind.Field),
  makeItem('confluence', 'Confluence page',        'confluence: ${1:page/path}',   vscode.CompletionItemKind.Field),
];

const BLOCK_COMPLETIONS = [...SYSTEM_COMPLETIONS, ...FIELD_COMPLETIONS];

function makeItem(
  key: string,
  detail: string,
  snippet: string,
  kind: vscode.CompletionItemKind,
): vscode.CompletionItem {
  const item = new vscode.CompletionItem(key, kind);
  item.detail = detail;
  item.insertText = new vscode.SnippetString(snippet);
  item.documentation = new vscode.MarkdownString(`**\`${key}\`** — ${detail}`);
  item.sortText = `0_${key}`;
  return item;
}

export class AiContextCompletionProvider implements vscode.CompletionItemProvider {
  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.CompletionItem[] | undefined {
    const lineText = document.lineAt(position).text;
    const textBeforeCursor = lineText.slice(0, position.character);

    // Inline pvnc.* annotation: // pvnc.<partial-key>  or  # pvnc.<partial-key>
    if (/^[ \t]*(?:[#*]|\/\/)\s*pvnc\.[\w-]*$/.test(textBeforeCursor)) {
      return BLOCK_COMPLETIONS;
    }

    if (!this.insideAiContextBlock(document, position)) return undefined;

    // At the start of a line inside a block — suggest keys and ticket systems.
    if (/^[ \t*#/]*[\w-]*$/.test(textBeforeCursor)) {
      return BLOCK_COMPLETIONS;
    }

    return undefined;
  }

  private insideAiContextBlock(document: vscode.TextDocument, position: vscode.Position): boolean {
    const text = document.getText();
    const offset = document.offsetAt(position);

    const pvncBefore = text.lastIndexOf('<pvnc>', offset);
    const provBefore = text.lastIndexOf('<provenance>', offset);
    const before = Math.max(pvncBefore, provBefore);
    if (before === -1) return false;

    const pvncClose = text.indexOf('</pvnc>', before);
    const provClose = text.indexOf('</provenance>', before);
    const closeInBetween = [pvncClose, provClose].filter(n => n !== -1).reduce((a, b) => Math.min(a, b), Infinity);
    return closeInBetween > offset;
  }
}

export const TRIGGER_CHARACTERS = ['\n', ' ', '-', '.'];

void KNOWN_SYSTEMS; // referenced by setupPvncConfig for system list
