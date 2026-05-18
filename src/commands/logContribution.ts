/**
 * <pvnc>
 *     reason: Expose provenance.logContribution as a VS Code command so AI agents can explicitly record their contributions to the two-tier JSONL store without needing inline annotations
 *     source: ai.claude
 * </pvnc>
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { getStore } from '../contributions/store';
import { EventType } from '../contributions/types';

export interface LogContributionArgs {
  /** Who made the change. Required. e.g. 'ai.claude', 'ai.copilot'. */
  source: string;
  /** Repo-relative file path. Defaults to the active editor's file. */
  file?: string;
  /** Net lines added/removed. */
  lines_delta?: number;
  /** Total lines in the file. Auto-detected from disk if omitted. */
  file_lines?: number;
  /** Defaults to 'edit'. */
  event?: EventType;
  /** Guard block ID — required when event is 'guard_removed' or 'guard_added'. */
  guard_id?: string;
  /** Optional ticket reference, e.g. 'github:42'. */
  ticket?: string;
}

function repoRelative(absPath: string, root: string): string {
  return absPath.startsWith(root)
    ? absPath.slice(root.length).replace(/^[\\/]/, '').replace(/\\/g, '/')
    : absPath.replace(/\\/g, '/');
}

function countLines(absPath: string): number | null {
  try {
    const content = fs.readFileSync(absPath, 'utf8');
    return content.split('\n').length;
  } catch {
    return null;
  }
}

export async function logContribution(args: LogContributionArgs): Promise<void> {
  const store = getStore();
  if (!store) {
    vscode.window.showWarningMessage('Provenance: contribution store not initialised.');
    return;
  }

  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';

  // Resolve the target file.
  let absFile: string | undefined;
  if (args.file) {
    absFile = path.isAbsolute(args.file)
      ? args.file
      : path.join(root, args.file);
  } else {
    absFile = vscode.window.activeTextEditor?.document.uri.fsPath;
  }

  if (!absFile) {
    vscode.window.showWarningMessage('Provenance: no file specified and no active editor.');
    return;
  }

  const relFile  = repoRelative(absFile, root);
  const fileLines = args.file_lines ?? countLines(absFile);

  store.append({
    source:      args.source,
    file:        relFile,
    lines_delta: args.lines_delta ?? null,
    file_lines:  fileLines,
    event:       args.event ?? 'edit',
    guard_id:    args.guard_id,
    ticket:      args.ticket,
  });
}
