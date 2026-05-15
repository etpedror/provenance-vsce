/**
 * <pvnc>
 *     reason: Expose the Code Guard diff check as a VS Code command so users can run it from the command palette in any workspace, without needing Python or a CI environment
 *     source: ai.claude
 * </pvnc>
 */
import * as vscode from 'vscode';
import { execSync } from 'child_process';
import { parseGuards } from '../guardParser';
import { parseDocument } from '../parser';
import { RawTextDocument } from '../rawTextDocument';

interface Violation {
  filepath: string;
  blockId: string;
  guardStart: number;
  guardEnd: number;
  changedLines: number[];
}

interface CheckResult {
  violations: Violation[];
  stale: string[];
  malformed: string[];
  base: string;
  head: string;
}

// ── Git helpers ───────────────────────────────────────────────────────────────

function git(root: string, ...args: string[]): string {
  try {
    return execSync(['git', ...args].join(' '), {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`git ${args[0]} failed: ${msg}`);
  }
}

function resolveBase(root: string): string {
  for (const ref of ['origin/HEAD', 'origin/main', 'origin/master']) {
    try {
      git(root, 'rev-parse', '--verify', ref);
      return ref;
    } catch { /* try next */ }
  }
  throw new Error('Cannot resolve a base ref. Make sure the repo has a remote tracking branch.');
}

function parseDiff(diffText: string): Map<string, Set<number>> {
  const changes = new Map<string, Set<number>>();
  let currentFile: string | null = null;
  let currentLine = 0;
  const hunkRe = /^\+(\d+)(?:,\d+)? /;

  for (const raw of diffText.split('\n')) {
    if (raw.startsWith('+++ ')) {
      const path = raw.slice(4).replace(/^b\//, '');
      currentFile = path === '/dev/null' ? null : path;
      if (currentFile && !changes.has(currentFile)) changes.set(currentFile, new Set());
      continue;
    }
    if (raw.startsWith('--- ') || raw.startsWith('diff ')) continue;
    if (raw.startsWith('@@')) {
      const m = hunkRe.exec(raw.slice(3));
      currentLine = m ? parseInt(m[1], 10) - 1 : 0;
      continue;
    }
    if (!currentFile) continue;
    if (raw.startsWith('+')) {
      currentLine++;
      changes.get(currentFile)!.add(currentLine);
    } else if (!raw.startsWith('-')) {
      currentLine++;
    }
  }
  return changes;
}

function getRemovedDeclarations(root: string, base: string, head: string): Set<string> {
  const log = git(root, 'log', `${base}..${head}`, '--format=%B', '--', '.');
  const re = /pvnc\.guard_removed\s*:\s*(\S+)/g;
  const ids = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(log)) !== null) ids.add(m[1]);
  return ids;
}

// ── Core check ────────────────────────────────────────────────────────────────

async function runCheck(root: string, base: string, head: string): Promise<CheckResult> {
  const diffText = git(root, 'diff', `${base}...${head}`, '--unified=0');
  const changedByFile = parseDiff(diffText);
  const removed = getRemovedDeclarations(root, base, head);

  const violations: Violation[] = [];
  const malformed: string[] = [];
  const touchedIds = new Set<string>();

  for (const [filepath, changedLines] of changedByFile) {
    let content: string;
    try {
      content = git(root, 'show', `${head}:${filepath}`);
    } catch { continue; } // deleted file

    const uri = vscode.Uri.file(`${root}/${filepath}`);
    const rawDoc = new RawTextDocument(uri, Buffer.from(content, 'utf8'));
    const annotations = parseDocument(rawDoc);
    const guards = parseGuards(rawDoc, annotations);

    for (const guard of guards) {
      if (guard.isMalformed) {
        const kind = guard.isOrphanedEnd ? 'orphaned guard_end' : 'unclosed guard_start';
        malformed.push(`${filepath}: ${kind} \`${guard.blockId}\``);
        continue;
      }

      const interior = new Set<number>();
      for (let l = guard.startLine + 2; l < (guard.endLine ?? 0) + 1; l++) interior.add(l);
      const hit = [...changedLines].filter(l => interior.has(l)).sort((a, b) => a - b);
      if (!hit.length) continue;

      touchedIds.add(guard.blockId);
      if (!removed.has(guard.blockId)) {
        violations.push({
          filepath,
          blockId: guard.blockId,
          guardStart: guard.startLine + 1,
          guardEnd: (guard.endLine ?? guard.startLine) + 1,
          changedLines: hit,
        });
      }
    }
  }

  const stale = [...removed].filter(id => !touchedIds.has(id));
  return { violations, stale, malformed, base, head };
}

// ── Output rendering ──────────────────────────────────────────────────────────

function renderResult(result: CheckResult, channel: vscode.OutputChannel): void {
  channel.clear();
  channel.appendLine(`Provenance Code Guard — ${result.base}...${result.head}`);
  channel.appendLine('');

  if (result.violations.length === 0) {
    channel.appendLine('✅ No violations.');
  } else {
    channel.appendLine(`❌ ${result.violations.length} violation(s):\n`);
    for (const v of result.violations) {
      channel.appendLine(`  Guard   : ${v.blockId}`);
      channel.appendLine(`  File    : ${v.filepath}`);
      channel.appendLine(`  Region  : lines ${v.guardStart}–${v.guardEnd}`);
      channel.appendLine(`  Changed : ${v.changedLines.join(', ')}`);
      channel.appendLine(`  Fix     : commit  pvnc.guard_removed: ${v.blockId} : <reason>  before this change`);
      channel.appendLine('');
    }
  }

  if (result.stale.length) {
    channel.appendLine('⚠️  Stale guard_removed (declared but no guard changed):');
    result.stale.forEach(id => channel.appendLine(`   pvnc.guard_removed: ${id}`));
    channel.appendLine('');
  }

  if (result.malformed.length) {
    channel.appendLine('⚠️  Malformed guards:');
    result.malformed.forEach(m => channel.appendLine(`   ${m}`));
    channel.appendLine('');
  }

  channel.show(true);
}

// ── Command entry point ───────────────────────────────────────────────────────

let outputChannel: vscode.OutputChannel | undefined;

export async function runCodeGuardCheck(): Promise<void> {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) {
    vscode.window.showErrorMessage('Provenance: No workspace folder open.');
    return;
  }

  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel('Provenance Code Guard');
  }

  outputChannel.clear();
  outputChannel.appendLine('Running Code Guard check…');
  outputChannel.show(true);

  let base: string;
  try {
    base = resolveBase(root);
  } catch (e: unknown) {
    vscode.window.showErrorMessage(`Provenance Code Guard: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }

  try {
    const result = await runCheck(root, base, 'HEAD');
    renderResult(result, outputChannel);

    if (result.violations.length > 0) {
      vscode.window.showWarningMessage(
        `Code Guard: ${result.violations.length} violation(s) found. See the Provenance Code Guard output channel.`,
        'Show output',
      ).then(a => a && outputChannel!.show(true));
    } else {
      vscode.window.showInformationMessage('Code Guard: ✅ No violations.');
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    outputChannel.appendLine(`\nError: ${msg}`);
    vscode.window.showErrorMessage(`Provenance Code Guard: ${msg}`);
  }
}
