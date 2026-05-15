import * as fs from 'fs';
import * as path from 'path';

/**
 * <pvnc>
 *     requirement: UNKNOWN
 *     reason: Centralise workspace-level ticket system config so providers can resolve issue IDs without requiring per-user VS Code settings
 *     source: ai.claude
 * </pvnc>
 */
export interface PvncConfig {
  defaultSystem?: string;
  github?: { owner: string; repo: string };
  jira?: { baseUrl: string; project?: string };
  ado?: { organisation: string; project?: string };
}

export function loadPvncConfig(workspaceRoot: string): PvncConfig {
  try {
    const raw = fs.readFileSync(path.join(workspaceRoot, '.pvnc', 'config.json'), 'utf8');
    return JSON.parse(raw) as PvncConfig;
  } catch { }

  const github = detectGitHubRemote(workspaceRoot);
  return github ? { defaultSystem: 'github', github } : {};
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
