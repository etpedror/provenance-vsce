/**
 * <pvnc>
 *     reason: Install pre-commit and post-commit git hooks so contributions_commit.jsonl merges into contributions_all.jsonl on commit and resets cleanly for the next session
 *     source: ai.claude
 * </pvnc>
 */
import * as fs from 'fs';
import * as path from 'path';

const HOOK_MARKER = '# provenance-managed';

const PRE_COMMIT_BODY = `\
${HOOK_MARKER}
PVNC_COMMIT=".pvnc/contributions_commit.jsonl"
PVNC_ALL=".pvnc/contributions_all.jsonl"
if [ -f "$PVNC_COMMIT" ] && [ -s "$PVNC_COMMIT" ]; then
  # Merge commit entries into the all-time log and stage both files.
  cat "$PVNC_COMMIT" >> "$PVNC_ALL"
  git add "$PVNC_COMMIT" "$PVNC_ALL"
fi
`;

const POST_COMMIT_BODY = `\
${HOOK_MARKER}
# Clear the commit-scoped log so the next session starts fresh.
> ".pvnc/contributions_commit.jsonl"
`;

function hooksDir(root: string): string {
  return path.join(root, '.git', 'hooks');
}

function injectOrCreate(hookPath: string, body: string): void {
  if (!fs.existsSync(hookPath)) {
    // Create a new hook file.
    const content = `#!/bin/sh\n${body}`;
    fs.writeFileSync(hookPath, content, { mode: 0o755 });
    return;
  }

  const existing = fs.readFileSync(hookPath, 'utf8');

  // Already injected — replace the block to pick up any wording changes.
  if (existing.includes(HOOK_MARKER)) {
    // Replace from the marker to the next blank line that follows the block.
    const updated = existing.replace(
      new RegExp(`${HOOK_MARKER}[\\s\\S]*?(?=\\n(?:#|$)|$)`, 'm'),
      body.trimEnd(),
    );
    fs.writeFileSync(hookPath, updated, { mode: 0o755 });
    return;
  }

  // Append to existing hook.
  fs.writeFileSync(hookPath, existing.trimEnd() + '\n\n' + body, { mode: 0o755 });
}

export function installGitHooks(root: string): void {
  const dir = hooksDir(root);
  if (!fs.existsSync(dir)) return; // Not a git repo or non-standard layout.

  injectOrCreate(path.join(dir, 'pre-commit'),  PRE_COMMIT_BODY);
  injectOrCreate(path.join(dir, 'post-commit'), POST_COMMIT_BODY);
}
