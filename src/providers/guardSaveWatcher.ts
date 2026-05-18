/**
 * <pvnc>
 *     reason: Log guard region removals and content changes to the contribution store on save, so structural compliance events are captured regardless of who made the change
 *     source: ai.claude
 * </pvnc>
 */
import * as vscode from 'vscode';
import * as cp from 'child_process';
import { getStore } from '../contributions/store';

const GUARD_START_RE = /^[ \t]*(?:[#*]|\/\/)\s*pvnc\.guard_start\s*:\s*(\S+)/m;
const GUARD_END_RE   = /^[ \t]*(?:[#*]|\/\/)\s*pvnc\.guard_end\s*:\s*(\S+)/m;

interface GuardSnapshot {
  /** blockId → content lines between start and end markers (exclusive). */
  regions: Map<string, string>;
  /** Total guard block IDs present. */
  blockIds: Set<string>;
}

function extractGuards(text: string): GuardSnapshot {
  const lines = text.split('\n');
  const regions = new Map<string, string>();
  const blockIds = new Set<string>();
  let current: string | null = null;
  const buf: string[] = [];

  for (const line of lines) {
    if (current === null) {
      const ms = GUARD_START_RE.exec(line);
      if (ms) { current = ms[1]; blockIds.add(ms[1]); buf.length = 0; }
    } else {
      const me = GUARD_END_RE.exec(line);
      if (me && me[1] === current) {
        regions.set(current, buf.join('\n'));
        current = null;
      } else {
        buf.push(line);
      }
    }
  }

  return { regions, blockIds };
}

function gitShow(root: string, relPath: string): string | null {
  try {
    return cp.execSync(`git show HEAD:"${relPath}"`, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null; // File not yet committed, or git unavailable.
  }
}

function repoRelative(absPath: string, root: string): string {
  return absPath.startsWith(root)
    ? absPath.slice(root.length).replace(/^[\\/]/, '').replace(/\\/g, '/')
    : absPath.replace(/\\/g, '/');
}

export class GuardSaveWatcher implements vscode.Disposable {
  private readonly disposable: vscode.Disposable;
  /**
   * Snapshot of guard region content as of the last save (or the committed HEAD
   * when the document was first seen). Keyed by document URI string.
   */
  private readonly snapshots = new Map<string, GuardSnapshot>();

  constructor() {
    this.disposable = vscode.workspace.onDidSaveTextDocument(doc =>
      this.onSave(doc),
    );
  }

  private onSave(doc: vscode.TextDocument): void {
    if (!getStore()) return;
    if (doc.languageId === 'markdown') return;

    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) return;

    const key     = doc.uri.toString();
    const relPath = repoRelative(doc.uri.fsPath, root);
    const current = extractGuards(doc.getText());

    // First time we see this document — baseline from git HEAD.
    if (!this.snapshots.has(key)) {
      const committed = gitShow(root, relPath);
      this.snapshots.set(key, committed ? extractGuards(committed) : current);
      // Nothing to compare yet on first open.
      return;
    }

    const baseline = this.snapshots.get(key)!;

    // Detect removed guard blocks.
    for (const blockId of baseline.blockIds) {
      if (!current.blockIds.has(blockId)) {
        this.logGuardEvent(relPath, 'guard_removed', blockId, doc.lineCount);
      }
    }

    // Detect added guard blocks.
    for (const blockId of current.blockIds) {
      if (!baseline.blockIds.has(blockId)) {
        this.logGuardEvent(relPath, 'guard_added', blockId, doc.lineCount);
      }
    }

    // Detect changed content within an existing guard block.
    for (const [blockId, content] of current.regions) {
      const baseContent = baseline.regions.get(blockId);
      if (baseContent !== undefined && baseContent !== content) {
        this.logGuardEvent(relPath, 'guard_removed', blockId, doc.lineCount);
      }
    }

    // Advance the snapshot so only genuine changes since the last save are reported.
    this.snapshots.set(key, current);
  }

  private logGuardEvent(
    file: string,
    event: 'guard_removed' | 'guard_added',
    guard_id: string,
    file_lines: number,
  ): void {
    getStore()?.append({
      source:      'unattributed',
      file,
      lines_delta: null,
      file_lines,
      event,
      guard_id,
    });
  }

  dispose(): void {
    this.snapshots.clear();
    this.disposable.dispose();
  }
}
