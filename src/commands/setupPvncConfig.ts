import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { loadPvncConfig, PvncConfig } from '../pvncConfig';

/**
 * <pvnc>
 *     requirement: UNKNOWN
 *     reason: Let users create .pvnc/config.json interactively rather than manually editing JSON
 *     source: ai.claude
 * </pvnc>
 */
export async function setupPvncConfig(): Promise<void> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    vscode.window.showErrorMessage('Provenance: No workspace folder open.');
    return;
  }

  const configPath = path.join(workspaceRoot, '.pvnc', 'config.json');
  const existing = fs.existsSync(configPath);
  if (existing) {
    const overwrite = await vscode.window.showWarningMessage(
      '.pvnc/config.json already exists. Overwrite it?',
      { modal: true },
      'Overwrite',
    );
    if (overwrite !== 'Overwrite') return;
  }

  const system = await vscode.window.showQuickPick(
    [
      { label: 'github',  description: 'GitHub Issues' },
      { label: 'jira',    description: 'Jira' },
      { label: 'ado',     description: 'Azure DevOps' },
      { label: 'linear',  description: 'Linear' },
    ],
    { placeHolder: 'Default ticket system for this workspace' },
  );
  if (!system) return;

  const config: PvncConfig = { defaultSystem: system.label };

  if (system.label === 'github') {
    const detected = detectGitHubRemote(workspaceRoot);

    const owner = await vscode.window.showInputBox({
      prompt: 'GitHub owner (user or org)',
      value: detected?.owner ?? '',
      validateInput: v => (v.trim() ? undefined : 'Required'),
    });
    if (owner === undefined) return;

    const repo = await vscode.window.showInputBox({
      prompt: 'GitHub repository name',
      value: detected?.repo ?? '',
      validateInput: v => (v.trim() ? undefined : 'Required'),
    });
    if (repo === undefined) return;

    config.github = { owner: owner.trim(), repo: repo.trim() };
  }

  if (system.label === 'jira') {
    const baseUrl = await vscode.window.showInputBox({
      prompt: 'Jira base URL',
      placeHolder: 'https://yourcompany.atlassian.net',
      validateInput: v => (v.trim() ? undefined : 'Required'),
    });
    if (baseUrl === undefined) return;

    const project = await vscode.window.showInputBox({
      prompt: 'Default project key (optional)',
      placeHolder: 'e.g. PROJ',
    });
    if (project === undefined) return;

    config.jira = { baseUrl: baseUrl.trim(), ...(project.trim() ? { project: project.trim() } : {}) };
  }

  if (system.label === 'ado') {
    const organisation = await vscode.window.showInputBox({
      prompt: 'Azure DevOps organisation',
      placeHolder: 'e.g. myorg',
      validateInput: v => (v.trim() ? undefined : 'Required'),
    });
    if (organisation === undefined) return;

    const project = await vscode.window.showInputBox({
      prompt: 'Default project (optional)',
      placeHolder: 'e.g. MyProject',
    });
    if (project === undefined) return;

    config.ado = { organisation: organisation.trim(), ...(project.trim() ? { project: project.trim() } : {}) };
  }

  fs.mkdirSync(path.join(workspaceRoot, '.pvnc'), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');

  const open = await vscode.window.showInformationMessage(
    `.pvnc/config.json created for ${system.label}.`,
    'Open file',
  );
  if (open === 'Open file') {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(configPath));
    await vscode.window.showTextDocument(doc);
  }
}

function detectGitHubRemote(workspaceRoot: string): { owner: string; repo: string } | undefined {
  try {
    const raw = fs.readFileSync(path.join(workspaceRoot, '.git', 'config'), 'utf8');
    const m = raw.match(
      /url\s*=\s*(?:https:\/\/github\.com\/|git@github\.com:)([^/\n]+)\/([^/\n.]+?)(?:\.git)?\s*$/m,
    );
    if (m) return { owner: m[1], repo: m[2] };
  } catch { }
  return undefined;
}
