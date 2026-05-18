/**
 * <pvnc>
 *     reason: Embed full Provenance instructions directly into CLAUDE.md / copilot / cursor files instead of writing a pointer to .pvnc/PROVENANCE.md — agents do not reliably follow indirection, so the instructions must be inline
 *     source: ai.claude
 * </pvnc>
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

// ── Sentinel tags ─────────────────────────────────────────────────────────────

const SENTINEL_START = '<!-- PROVENANCE:START -->';

// Legacy sentinels — detect files written by older versions of the extension.
const LEGACY_POINTER_START = '<!-- provenance-pointer -->';
const LEGACY_FULL_TEXT     = 'provenance — standing instructions';

// ── Inline instructions block ─────────────────────────────────────────────────

export const INSTRUCTIONS_BLOCK = `\
<!-- PROVENANCE:START -->
<!-- DO NOT EDIT THIS BLOCK. To remove it, run the VS Code command: Provenance: Remove AI Instructions -->
> [!IMPORTANT]
> **Provenance** — Follow these annotation rules on every code change, without being asked.
>
> **When modifying existing code**
> 1. Read all \`<pvnc>\` / \`<provenance>\` blocks that annotate the code you are about to change.
> 2. After making the change, add a **new** \`<pvnc>\` block immediately before the affected line or method. Never replace or remove existing blocks.
> 3. The new block must include:
>    - A ticket reference: \`github: 123\`, \`jira: PROJ-42\`, \`ado: 45678\` (omit if no ticket).
>    - \`reason:\` — one sentence describing *why* the change was made (not what).
>    - \`source:\` — \`human\`, \`ai.claude\`, \`ai.copilot\`, etc.
> 4. If the changed code must not be simplified in future, add \`do-not-change:\` with a short justification.
>
> **When adding new code**
> Add a \`<pvnc>\` block immediately before the new function, method, or logical block. Same fields as above.
>
> **Annotation format**
> \`\`\`typescript
> /**
>  * <pvnc>
>  *     github: 123
>  *     reason: Plain English explanation of why this code exists or changed
>  *     source: ai.claude
>  * </pvnc>
>  */
> \`\`\`
> Any ticket system name is a valid key (\`jira\`, \`ado\`, \`linear\`, \`confluence\`, …).
> Adjust the comment style to match the language (\`/** */\` for Java/TS/JS, \`# ...\` for Ruby/shell, etc.).
> Always indent keys by 4 spaces inside the tags. Both \`<pvnc>\` and \`<provenance>\` are valid tag names.
>
> **What not to do**
> - Do not remove or rewrite existing \`<pvnc>\` / \`<provenance>\` blocks.
> - Do not add annotations to lines you did not change.
> - Do not remove or simplify code marked with \`do-not-change\` without explicit instruction.
>
> **Code Guard rules**
> Code Guard regions are marked with \`pvnc.guard_start: <block-id>\` and \`pvnc.guard_end: <block-id>\` comments.
> 1. Never modify code between \`pvnc.guard_start\` and \`pvnc.guard_end\` markers.
> 2. If asked to modify a guarded region, inform the user and request explicit confirmation referencing the block ID.
> 3. If proceeding with permission, the **first** commit must be: \`pvnc.guard_removed: <block-id> : <reason>\`
> 4. The **second** commit makes the change. Optionally re-guard with a new block ID and a new \`<pvnc>\` annotation.
<!-- PROVENANCE:END -->
`;

// ── Regex patterns ────────────────────────────────────────────────────────────

/** Matches the current inline block (including trailing newline if present). */
const BLOCK_RE = /<!-- PROVENANCE:START -->[\s\S]*?<!-- PROVENANCE:END -->\n?/;

/** Matches the legacy pointer block (including trailing newline if present). */
const LEGACY_RE = /<!-- provenance-pointer -->[\s\S]*?<!-- \/provenance-pointer -->\n?/;

// ── Target agent files ────────────────────────────────────────────────────────

interface TargetFile {
  rel: string;
  label: string;
}

const TARGETS: TargetFile[] = [
  { rel: 'CLAUDE.md',                          label: 'Claude Code' },
  { rel: '.github/copilot-instructions.md',    label: 'GitHub Copilot' },
  { rel: '.cursorrules',                       label: 'Cursor' },
];

// ── File helpers ──────────────────────────────────────────────────────────────

/**
 * Replace the instructions block in-place if present (current or legacy), or
 * prepend it. Returns a verb describing what happened.
 */
function resetInstructionsInFile(abs: string): 'replaced' | 'upgraded' | 'prepended' | 'created' {
  if (!fs.existsSync(abs)) {
    fs.writeFileSync(abs, INSTRUCTIONS_BLOCK, 'utf8');
    return 'created';
  }

  const existing = fs.readFileSync(abs, 'utf8');

  if (BLOCK_RE.test(existing)) {
    fs.writeFileSync(abs, existing.replace(BLOCK_RE, INSTRUCTIONS_BLOCK), 'utf8');
    return 'replaced';
  }

  if (LEGACY_RE.test(existing)) {
    fs.writeFileSync(abs, existing.replace(LEGACY_RE, INSTRUCTIONS_BLOCK), 'utf8');
    return 'upgraded';
  }

  // No block found — prepend.
  const sep = existing.startsWith('\n') ? '' : '\n';
  fs.writeFileSync(abs, INSTRUCTIONS_BLOCK + sep + existing, 'utf8');
  return 'prepended';
}

/**
 * Strip any Provenance block (current or legacy) from a file.
 * Returns true if a block was removed.
 */
function removeInstructionsFromFile(abs: string): boolean {
  if (!fs.existsSync(abs)) return false;

  const existing = fs.readFileSync(abs, 'utf8');
  let updated = existing.replace(BLOCK_RE, '');
  updated = updated.replace(LEGACY_RE, '');

  if (updated === existing) return false;

  // Collapse leading blank lines left behind after removal.
  updated = updated.replace(/^\n+/, '');
  fs.writeFileSync(abs, updated, 'utf8');
  return true;
}

// ── Commands ──────────────────────────────────────────────────────────────────

export async function resetInstructions(): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders?.length) {
    vscode.window.showErrorMessage('Provenance: No workspace folder open.');
    return;
  }

  const root = workspaceFolders[0].uri.fsPath;
  const results: string[] = [];

  for (const target of TARGETS) {
    const abs = path.join(root, target.rel);
    const dir = path.dirname(abs);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const outcome = resetInstructionsInFile(abs);
    const verb = outcome === 'created' ? 'created'
               : outcome === 'upgraded' ? 'upgraded'
               : outcome === 'replaced' ? 'refreshed'
               : 'restored';
    results.push(`${target.label} (${verb})`);
  }

  const action = await vscode.window.showInformationMessage(
    `Provenance: Reset complete — ${results.join(', ')}.`,
    'Open files',
  );

  if (action === 'Open files') {
    for (const target of TARGETS) {
      const abs = path.join(root, target.rel);
      const doc = await vscode.workspace.openTextDocument(abs);
      await vscode.window.showTextDocument(doc, { preview: false });
    }
  }
}

export async function setupInstructions(): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders?.length) {
    vscode.window.showErrorMessage('Provenance: No workspace folder open.');
    return;
  }

  const root = workspaceFolders[0].uri.fsPath;

  const created: string[] = [];
  const upgraded: string[] = [];
  const updated: string[] = [];
  const skipped: string[] = [];

  for (const target of TARGETS) {
    const abs = path.join(root, target.rel);
    const dir = path.dirname(abs);

    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    if (!fs.existsSync(abs)) {
      fs.writeFileSync(abs, INSTRUCTIONS_BLOCK, 'utf8');
      created.push(target.label);
      continue;
    }

    const existing = fs.readFileSync(abs, 'utf8');

    // Already has current inline block — nothing to do.
    if (existing.includes(SENTINEL_START)) {
      skipped.push(target.label);
      continue;
    }

    // Has legacy pointer — auto-upgrade to inline block.
    if (LEGACY_RE.test(existing)) {
      fs.writeFileSync(abs, existing.replace(LEGACY_RE, INSTRUCTIONS_BLOCK), 'utf8');
      upgraded.push(target.label);
      continue;
    }

    // Has old full-text instructions (very old format) — skip to avoid double-write.
    if (existing.includes(LEGACY_FULL_TEXT)) {
      skipped.push(target.label);
      continue;
    }

    // Existing file with no Provenance entry — prepend.
    const separator = existing.startsWith('\n') ? '' : '\n';
    fs.writeFileSync(abs, INSTRUCTIONS_BLOCK + separator + existing, 'utf8');
    updated.push(target.label);
  }

  const parts: string[] = [];
  if (created.length)  parts.push(`Created: ${created.join(', ')}.`);
  if (upgraded.length) parts.push(`Upgraded: ${upgraded.join(', ')}.`);
  if (updated.length)  parts.push(`Updated: ${updated.join(', ')}.`);
  if (skipped.length)  parts.push(`Already configured (skipped): ${skipped.join(', ')}.`);

  const touched = [...created, ...upgraded, ...updated];
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

export async function removeInstructions(): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders?.length) {
    vscode.window.showErrorMessage('Provenance: No workspace folder open.');
    return;
  }

  const root = workspaceFolders[0].uri.fsPath;
  const removed: string[] = [];
  const notFound: string[] = [];

  for (const target of TARGETS) {
    const abs = path.join(root, target.rel);
    if (removeInstructionsFromFile(abs)) {
      removed.push(target.label);
    } else {
      notFound.push(target.label);
    }
  }

  const parts: string[] = [];
  if (removed.length)  parts.push(`Removed from: ${removed.join(', ')}.`);
  if (notFound.length) parts.push(`Not found in: ${notFound.join(', ')}.`);

  vscode.window.showInformationMessage(`Provenance: ${parts.join(' ')}`);
}
