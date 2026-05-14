import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

// Unique sentinel used to detect whether our block is already present in a file.
const SENTINEL = 'provenance — standing instructions';

const INSTRUCTIONS = `\
# Provenance — standing instructions

This project uses the Provenance annotation convention to embed traceability
directly into source code. Follow these rules on every code change, without
being asked.

## When modifying existing code

1. Read all \`<pvnc>\` / \`<provenance>\` blocks that annotate the code you are
   about to change before making any edits.
2. After making the change, add a **new** \`<pvnc>\` block immediately before
   the affected line or method. Never replace or remove existing blocks.
3. The new block must include:
   - \`requirement:\` — use the ticket/issue ID the user mentions, or \`UNKNOWN\` if
     none is given.
   - \`reason:\` — one sentence describing *why* the change was made (not what).
   - \`source:\` — \`human\`, \`ai.claude\`, \`ai.copilot\`, etc.
4. If the changed code must not be simplified in future, add \`do-not-change:\` with
   a short justification.

## When adding new code

Add a \`<pvnc>\` block immediately before the new function, method, or
logical block. Same fields as above.

## Annotation format

\`\`\`python
"""
<pvnc>
    requirement: TICKET-123 (github)
    reason: Plain English explanation of why this code exists or changed
    source: ai.claude
</pvnc>
"""
\`\`\`

Adjust the comment style to match the language (\`/** */\` for Java/TS/JS,
\`# ...\` for Ruby/shell, etc.). Always indent the keys by 4 spaces inside the
tags. Both \`<pvnc>\` and \`<provenance>\` are valid tag names.

## What not to do

- Do not remove or rewrite existing \`<pvnc>\` / \`<provenance>\` blocks.
- Do not add annotations to lines you did not change.
- Do not remove or simplify code marked with \`do-not-change\` without explicit instruction.
`;

interface TargetFile {
  /** Path relative to workspace root */
  rel: string;
  /** Human-readable label */
  label: string;
}

const TARGETS: TargetFile[] = [
  { rel: 'CLAUDE.md',                          label: 'Claude Code' },
  { rel: '.github/copilot-instructions.md',    label: 'GitHub Copilot' },
  { rel: '.cursorrules',                       label: 'Cursor' },
];

export async function setupInstructions(): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders?.length) {
    vscode.window.showErrorMessage('Provenance: No workspace folder open.');
    return;
  }

  const root = workspaceFolders[0].uri.fsPath;
  const created: string[] = [];
  const updated: string[] = [];
  const skipped: string[] = [];

  for (const target of TARGETS) {
    const abs = path.join(root, target.rel);
    const dir = path.dirname(abs);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (!fs.existsSync(abs)) {
      fs.writeFileSync(abs, INSTRUCTIONS, 'utf8');
      created.push(target.label);
      continue;
    }

    const existing = fs.readFileSync(abs, 'utf8');
    if (existing.includes(SENTINEL)) {
      skipped.push(target.label);
      continue;
    }

    // Append with a blank-line separator, preserving whatever was already there.
    const separator = existing.endsWith('\n\n') ? '' : existing.endsWith('\n') ? '\n' : '\n\n';
    fs.writeFileSync(abs, existing + separator + INSTRUCTIONS, 'utf8');
    updated.push(target.label);
  }

  const parts: string[] = [];
  if (created.length) parts.push(`Created: ${created.join(', ')}.`);
  if (updated.length) parts.push(`Updated: ${updated.join(', ')}.`);
  if (skipped.length) parts.push(`Already configured (skipped): ${skipped.join(', ')}.`);

  const touched = [...created, ...updated];
  const message = parts.join(' ');

  if (touched.length === 0) {
    vscode.window.showInformationMessage(`Provenance: ${message}`);
    return;
  }

  const action = await vscode.window.showInformationMessage(
    `Provenance: ${message}`,
    'Open files',
  );

  if (action === 'Open files') {
    for (const target of TARGETS) {
      const abs = path.join(root, target.rel);
      if (touched.includes(target.label)) {
        const doc = await vscode.workspace.openTextDocument(abs);
        await vscode.window.showTextDocument(doc, { preview: false });
      }
    }
  }
}
