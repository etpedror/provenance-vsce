import * as vscode from 'vscode';

const TICKET_SYSTEMS = ['jira', 'github', 'ado', 'linear'] as const;
const SOURCE_OPTIONS = ['human', 'ai.claude', 'ai.copilot', 'ai.codex', 'ai.gemini', 'ai.cursor', 'ai.other'] as const;

const BLOCK_DOC_LANGS = new Set([
  'java', 'typescript', 'typescriptreact', 'javascript', 'javascriptreact',
  'cs', 'c', 'cpp', 'go', 'kotlin', 'swift', 'rust', 'php',
]);

const HASH_COMMENT_LANGS = new Set(['python', 'ruby', 'shellscript', 'yaml', 'r']);

export async function addAnnotation(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage('Provenance: No active editor.');
    return;
  }

  const id = await vscode.window.showInputBox({
    prompt: 'Requirement ID',
    placeHolder: 'e.g. USER-1042 or GH-99',
    validateInput: v => (v.trim() ? undefined : 'ID is required'),
  });
  if (id === undefined) return;

  const system = await vscode.window.showQuickPick([...TICKET_SYSTEMS], {
    placeHolder: 'Ticket system',
  });
  if (system === undefined) return;

  const reason = await vscode.window.showInputBox({
    prompt: 'Reason (human-readable — leave blank to omit)',
    placeHolder: 'e.g. HMRC compliance — audited 2024-03',
  });
  if (reason === undefined) return;

  const source = await vscode.window.showQuickPick([...SOURCE_OPTIONS], {
    placeHolder: 'Authored by',
  });
  if (source === undefined) return;

  const snippet = buildSnippet(
    editor.document.languageId,
    id.trim(),
    system,
    reason.trim(),
    source,
  );

  const insertPos = new vscode.Position(editor.selection.active.line, 0);
  await editor.insertSnippet(new vscode.SnippetString(snippet), insertPos);
}

function buildSnippet(
  languageId: string,
  id: string,
  system: string,
  reason: string,
  source: string,
): string {
  const today = new Date().toISOString().split('T')[0];
  const lines: string[] = [
    `<pvnc>`,
    `    requirement: ${id} (${system}, ${today})`,
    ...(reason ? [`    reason: ${reason}`] : []),
    `    source: ${source}`,
    `</pvnc>`,
  ];

  if (languageId === 'python') {
    return `"""\n${lines.join('\n')}\n"""\n$0`;
  }

  if (BLOCK_DOC_LANGS.has(languageId)) {
    const inner = lines.map(l => ` * ${l}`).join('\n');
    return `/**\n${inner}\n */\n$0`;
  }

  if (HASH_COMMENT_LANGS.has(languageId)) {
    return lines.map(l => `# ${l}`).join('\n') + '\n$0';
  }

  return lines.join('\n') + '\n$0';
}
