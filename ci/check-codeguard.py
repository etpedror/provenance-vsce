#!/usr/bin/env python3
"""
Provenance Code Guard checker.

Analyses a git diff for modifications to guarded regions (pvnc.guard_start /
pvnc.guard_end) and verifies that a pvnc.guard_removed declaration exists in a
preceding commit for every violation.

Exit codes:
  0  Clean — no violations
  1  One or more guard violations found
  2  Invocation or git error

Usage:
  check-codeguard.py [--base <ref>] [--head <ref>] [--github-output]

  --base   Base ref to diff from (default: origin/HEAD, falls back to origin/main)
  --head   Head ref to diff to   (default: HEAD)
  --github-output
           Emit $GITHUB_OUTPUT and $GITHUB_STEP_SUMMARY entries for use inside a
           GitHub Actions step.
"""

import argparse
import re
import subprocess
import sys
from dataclasses import dataclass, field
from typing import Optional

# ── Regexes ───────────────────────────────────────────────────────────────────

GUARD_START_RE  = re.compile(r'pvnc\.guard_start\s*:\s*(\S+)')
GUARD_END_RE    = re.compile(r'pvnc\.guard_end\s*:\s*(\S+)')
GUARD_REMOVED_RE = re.compile(r'pvnc\.guard_removed\s*:\s*(\S+)')
HUNK_HEADER_RE  = re.compile(r'^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@')

# ── Data classes ──────────────────────────────────────────────────────────────

@dataclass
class GuardRegion:
    block_id: str
    start_line: int          # 1-based, inclusive (guard_start marker line)
    end_line: Optional[int]  # 1-based, inclusive (guard_end marker line); None = malformed


@dataclass
class Violation:
    filepath: str
    block_id: str
    guard_start: int
    guard_end: int
    changed_lines: list[int]

# ── Git helpers ───────────────────────────────────────────────────────────────

def git(*args: str, check: bool = True) -> str:
    result = subprocess.run(
        ['git', *args],
        capture_output=True,
        text=True,
    )
    if check and result.returncode != 0:
        print(f'git error ({" ".join(args)}):\n{result.stderr.strip()}', file=sys.stderr)
        sys.exit(2)
    return result.stdout


def resolve_base(base: str) -> str:
    """Return base if it resolves, else try common fallbacks."""
    for ref in [base, 'origin/main', 'origin/master']:
        r = subprocess.run(['git', 'rev-parse', '--verify', ref],
                           capture_output=True, text=True)
        if r.returncode == 0:
            return ref
    print('Cannot resolve a base ref. Pass --base explicitly.', file=sys.stderr)
    sys.exit(2)

# ── Parsing ───────────────────────────────────────────────────────────────────

def parse_guards(content: str) -> list[GuardRegion]:
    """Return all guard regions (1-based line numbers) from file content."""
    regions: list[GuardRegion] = []
    open_starts: dict[str, int] = {}

    for lineno, line in enumerate(content.splitlines(), 1):
        m = GUARD_START_RE.search(line)
        if m:
            block_id = m.group(1)
            if block_id in open_starts:
                # Nested — flag previous as malformed and reset.
                regions.append(GuardRegion(block_id, open_starts.pop(block_id), None))
            open_starts[block_id] = lineno
            continue

        m = GUARD_END_RE.search(line)
        if m:
            block_id = m.group(1)
            if block_id in open_starts:
                regions.append(GuardRegion(block_id, open_starts.pop(block_id), lineno))

    for block_id, start in open_starts.items():
        regions.append(GuardRegion(block_id, start, None))

    return regions


def parse_diff(diff_text: str) -> dict[str, set[int]]:
    """
    Parse unified diff output into {filepath: {new_line_numbers_changed}}.
    Only + lines (additions / modifications) are recorded; 1-based.
    """
    changes: dict[str, set[int]] = {}
    current_file: Optional[str] = None
    current_line = 0

    for raw in diff_text.splitlines():
        if raw.startswith('diff --git '):
            current_file = None
            current_line = 0
            continue
        if raw.startswith('+++ '):
            path = raw[4:]
            if path.startswith('b/'):
                path = path[2:]
            if path != '/dev/null':
                current_file = path
                changes.setdefault(current_file, set())
            continue
        if raw.startswith('--- '):
            continue
        m = HUNK_HEADER_RE.match(raw)
        if m:
            current_line = int(m.group(1)) - 1
            continue
        if current_file is None:
            continue
        if raw.startswith('+'):
            current_line += 1
            changes[current_file].add(current_line)
        elif not raw.startswith('-'):
            current_line += 1

    return changes


def get_removed_declarations(base: str, head: str) -> set[str]:
    """Collect block IDs declared via pvnc.guard_removed in commits base..head."""
    log = git('log', f'{base}..{head}', '--format=%B', '--', '.')
    return {m.group(1) for line in log.splitlines() if (m := GUARD_REMOVED_RE.search(line))}


def file_content_at(ref: str, filepath: str) -> Optional[str]:
    result = subprocess.run(
        ['git', 'show', f'{ref}:{filepath}'],
        capture_output=True,
        text=True,
    )
    return result.stdout if result.returncode == 0 else None

# ── Core check ────────────────────────────────────────────────────────────────

def check(base: str, head: str) -> tuple[list[Violation], list[str], list[str]]:
    """
    Returns:
      violations          — guarded regions modified without a guard_removed
      stale_declarations  — guard_removed declared but no change made
      malformed_guards    — guard_start without matching guard_end in changed files
    """
    diff_text = git('diff', f'{base}...{head}', '--unified=0')
    changed = parse_diff(diff_text)
    removed = get_removed_declarations(base, head)

    violations: list[Violation] = []
    malformed: list[str] = []
    touched_ids: set[str] = set()

    for filepath, changed_lines in changed.items():
        content = file_content_at(head, filepath)
        if content is None:
            continue  # deleted file

        guards = parse_guards(content)

        for guard in guards:
            if guard.end_line is None:
                malformed.append(f'{filepath}: pvnc.guard_start `{guard.block_id}` has no matching guard_end')
                continue

            interior = set(range(guard.start_line + 1, guard.end_line))
            hit = sorted(changed_lines & interior)
            if not hit:
                continue

            touched_ids.add(guard.block_id)
            if guard.block_id not in removed:
                violations.append(Violation(
                    filepath=filepath,
                    block_id=guard.block_id,
                    guard_start=guard.start_line,
                    guard_end=guard.end_line,
                    changed_lines=hit,
                ))

    stale = sorted(removed - touched_ids)
    return violations, stale, malformed

# ── Output helpers ────────────────────────────────────────────────────────────

def build_summary(violations: list[Violation], stale: list[str], malformed: list[str]) -> str:
    lines: list[str] = []

    if violations:
        lines.append(f'## ❌ Code Guard — {len(violations)} violation(s)\n')
        for v in violations:
            lines.append(f'**`{v.block_id}`** in `{v.filepath}` (guard lines {v.guard_start}–{v.guard_end})')
            lines.append(f'Changed lines: {", ".join(str(l) for l in v.changed_lines)}')
            lines.append(f'Fix: commit `pvnc.guard_removed: {v.block_id} : <reason>` in a prior commit.\n')
    else:
        lines.append('## ✅ Code Guard — no violations\n')

    if stale:
        lines.append('### ⚠️ Stale guard_removed declaration(s)')
        lines.append('These were declared but no guarded region was actually changed:')
        for bid in stale:
            lines.append(f'- `pvnc.guard_removed: {bid}`')
        lines.append('')

    if malformed:
        lines.append('### ⚠️ Malformed guards detected')
        for msg in malformed:
            lines.append(f'- {msg}')
        lines.append('')

    lines.append('*[Provenance Code Guard](https://github.com/etpedror/provenance-vsce)*')
    return '\n'.join(lines)


def emit_github_output(violations: list[Violation], stale: list[str], malformed: list[str]) -> None:
    import os
    output_file = os.environ.get('GITHUB_OUTPUT', '')
    summary_file = os.environ.get('GITHUB_STEP_SUMMARY', '')

    result = 'fail' if violations else 'pass'
    violation_count = str(len(violations))

    if output_file:
        with open(output_file, 'a') as f:
            f.write(f'result={result}\n')
            f.write(f'violation_count={violation_count}\n')

    if summary_file:
        with open(summary_file, 'a') as f:
            f.write(build_summary(violations, stale, malformed))

# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description='Provenance Code Guard checker',
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument('--base', default='', help='Base ref (default: origin/HEAD or origin/main)')
    parser.add_argument('--head', default='HEAD', help='Head ref (default: HEAD)')
    parser.add_argument('--github-output', action='store_true',
                        help='Write GITHUB_OUTPUT and GITHUB_STEP_SUMMARY entries')
    args = parser.parse_args()

    base = resolve_base(args.base or 'origin/HEAD')
    head = args.head

    print(f'Provenance Code Guard — {base}...{head}')

    violations, stale, malformed = check(base, head)

    if violations:
        print(f'\n❌ {len(violations)} violation(s):\n')
        for v in violations:
            print(f'  Guard   : {v.block_id}')
            print(f'  File    : {v.filepath}')
            print(f'  Region  : lines {v.guard_start}–{v.guard_end}')
            print(f'  Changed : {", ".join(str(l) for l in v.changed_lines)}')
            print(f'  Fix     : commit  pvnc.guard_removed: {v.block_id} : <reason>  before this change\n')
    else:
        print('\n✅ No violations.')

    if stale:
        print('⚠️  Stale guard_removed (declared but no guard changed):')
        for bid in stale:
            print(f'   pvnc.guard_removed: {bid}')
        print()

    if malformed:
        print('⚠️  Malformed guards (guard_start without guard_end):')
        for msg in malformed:
            print(f'   {msg}')
        print()

    if args.github_output:
        emit_github_output(violations, stale, malformed)

    sys.exit(1 if violations else 0)


if __name__ == '__main__':
    main()
