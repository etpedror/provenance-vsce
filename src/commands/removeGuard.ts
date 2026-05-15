/**
 * <pvnc>
 *     reason: Scaffold the pvnc.guard_removed commit message so users can follow the two-commit workflow without remembering the exact syntax
 *     source: ai.claude
 * </pvnc>
 */
import * as vscode from 'vscode';
import { parseDocument } from '../parser';
import { parseGuards } from '../guardParser';

export async function removeGuard(prefilledBlockId?: string): Promise<void> {
  const editor = vscode.window.activeTextEditor;

  // Collect known guard IDs from the active document to offer as autocomplete.
  let knownIds: string[] = [];
  if (editor) {
    const annotations = parseDocument(editor.document);
    const regions = parseGuards(editor.document, annotations);
    knownIds = regions.filter(r => !r.isMalformed).map(r => r.blockId);
  }

  const blockId = prefilledBlockId ?? await vscode.window.showInputBox({
    prompt: 'Guard block ID to remove',
    placeHolder: knownIds.length > 0 ? knownIds[0] : 'block-hmrc-001',
    value: knownIds.length === 1 ? knownIds[0] : '',
    validateInput: v => v.trim() ? undefined : 'Block ID is required',
  });

  if (!blockId?.trim()) return;

  const reason = await vscode.window.showInputBox({
    prompt: 'Reason for removing the guard',
    placeHolder: 'New HMRC directive 2026-Q2 supersedes previous rule',
    validateInput: v => v.trim() ? undefined : 'Reason is required',
  });

  if (!reason?.trim()) return;

  const commentStyle = await detectCommentStyle(editor);
  const declaration = `${commentStyle} pvnc.guard_removed: ${blockId.trim()} : ${reason.trim()}`;
  const commitMsg = `pvnc.guard_removed: ${blockId.trim()} : ${reason.trim()}`;

  // Show the declaration line and commit message in an output channel.
  const channel = vscode.window.createOutputChannel('Provenance Guard Removal');
  channel.clear();
  channel.appendLine('── Step 1: add this line to your source file and commit it ──');
  channel.appendLine('');
  channel.appendLine(declaration);
  channel.appendLine('');
  channel.appendLine('── Suggested commit message ──');
  channel.appendLine('');
  channel.appendLine(commitMsg);
  channel.appendLine('');
  channel.appendLine('── Step 2: make your change in the next commit ──');
  channel.show(true);

  const action = await vscode.window.showInformationMessage(
    `Guard removal scaffolded for \`${blockId.trim()}\`. Copy the declaration to your file and commit it before making changes.`,
    'Copy declaration',
    'Copy commit message',
  );

  if (action === 'Copy declaration') {
    await vscode.env.clipboard.writeText(declaration);
  } else if (action === 'Copy commit message') {
    await vscode.env.clipboard.writeText(commitMsg);
  }
}

function detectCommentStyle(editor: vscode.TextEditor | undefined): string {
  if (!editor) return '//';
  switch (editor.document.languageId) {
    case 'python':
    case 'ruby':
    case 'shellscript':
    case 'yaml':
    case 'toml':
      return '#';
    default:
      return '//';
  }
}
