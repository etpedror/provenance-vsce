import * as vscode from 'vscode';
import { PvncConfig } from '../pvncConfig';

// Keys that work inside <pvnc> blocks or as pvnc.<key> inline annotations.
// Ticket systems (github, jira, …) are also valid but listed separately.
const FIELD_COMPLETIONS: vscode.CompletionItem[] = [
  makeItem('reason',        'Why this code exists or changed',                         'reason: ${1:explanation}',                                              vscode.CompletionItemKind.Text),
  makeItem('source',        'Authorship: human, ai.claude, ai.copilot, …',             'source: ${1|human,ai.claude,ai.copilot,ai.codex,ai.gemini,ai.cursor|}', vscode.CompletionItemKind.EnumMember),
  makeItem('invariant',     'A rule that must never be violated',                       'invariant: ${1:rule}',                                                  vscode.CompletionItemKind.Constant),
  makeItem('do-not-change', 'Flags load-bearing complexity — warns on edit',           'do-not-change: ${1:reason}',                                            vscode.CompletionItemKind.Event),
  makeItem('see-also',      'Cross-references: file paths or IDs (comma-separated)',   'see-also: ${1:path/to/file.py}',                                        vscode.CompletionItemKind.Reference),
];

const SYSTEM_SNIPPETS: Record<string, { detail: string; snippet: string }> = {
  github:     { detail: 'GitHub issue',           snippet: 'github: ${1:issue-number}'  },
  jira:       { detail: 'Jira ticket',            snippet: 'jira: ${1:PROJ-123}'        },
  ado:        { detail: 'Azure DevOps work item', snippet: 'ado: ${1:work-item-id}'     },
  linear:     { detail: 'Linear issue',           snippet: 'linear: ${1:TEAM-123}'      },
  confluence: { detail: 'Confluence page',        snippet: 'confluence: ${1:page/path}' },
};

function configuredSystemCompletions(config: PvncConfig): vscode.CompletionItem[] {
  return Object.keys(config)
    .filter(k => k in SYSTEM_SNIPPETS)
    .map(k => makeItem(k, SYSTEM_SNIPPETS[k].detail, SYSTEM_SNIPPETS[k].snippet, vscode.CompletionItemKind.Field));
}

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
  private readonly config: PvncConfig;

  constructor(config: PvncConfig) {
    this.config = config;
  }

  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.CompletionItem[] | undefined {
    const lineText = document.lineAt(position).text;
    const textBeforeCursor = lineText.slice(0, position.character);
    const completions = [...configuredSystemCompletions(this.config), ...FIELD_COMPLETIONS];

    // Inline pvnc.* annotation: // pvnc.<partial-key>  or  # pvnc.<partial-key>
    if (/^[ \t]*(?:[#*]|\/\/)\s*pvnc\.[\w-]*$/.test(textBeforeCursor)) {
      return completions;
    }

    if (!this.insideAiContextBlock(document, position)) return undefined;

    // At the start of a line inside a block — suggest keys and ticket systems.
    if (/^[ \t*#/]*[\w-]*$/.test(textBeforeCursor)) {
      return completions;
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

