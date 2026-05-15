# Changelog

All notable changes to this project will be documented in this file.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.1.0] — 2026-05-15

- **Code Guard** — structural fences around regions that must not change, using `pvnc.guard_start: <block-id>` and `pvnc.guard_end: <block-id>` line comment markers.
  - Amber shield gutter icon on marker lines; configurable background tint on interior lines.
  - Non-blocking edit warning with a **Scaffold removal** shortcut when any line inside a guard is modified.
  - Hover tooltip on marker lines showing block ID, linked `<pvnc>` annotation, and removal instructions.
  - **Guards** section in the Provenance sidebar panel listing all active guard regions with file, line range, and documentation status.
  - Guard metrics (`guardCount`, `documentedGuardCount`, `malformedGuardCount`) surfaced in the Metrics section and aggregated at workspace level.
  - Malformed guard detection — `guard_start` without a matching `guard_end` shows a warning decoration.
- **`Provenance: Remove guard` command** — prompts for block ID (pre-filled from the active document) and reason; outputs the ready-to-paste `pvnc.guard_removed` declaration and commit message to an output channel with one-click clipboard copy.
- **Code Guard rules** appended to AI assistant instruction files written by `Provenance: Set up AI assistant instructions`.
- **CI enforcement** — `ci/check-codeguard.py` core script plus ready-to-use integrations for GitHub Actions (`.github/workflows/codeguard.yml`), Azure DevOps (`ci/azure-codeguard.yml`), and pre-commit (`.pre-commit-hooks.yaml`).
- Six new settings under `provenance.codeGuard.*`: `enabled`, `gutterHighlight`, `regionTint`, `regionTintColour`, `warnOnEdit`, `ciStrictMode`.
- `provenance.guardMarkerForeground` theme colour for guard gutter icons.

---

## [1.0.4] — 2026-05-15

### Added

- **Ticket system keys** — ticket system name is now the key (`github: 42`, `jira: PROJ-1`, `ado: 123`). Any unknown key in a block or inline annotation is treated as a ticket system reference. The old `requirement: ID (system)` format is still parsed for backward compatibility.
- **Live ticket hover enrichment** — hovering a ticket key fetches the issue title and state from the configured system and shows it inline. GitHub uses VS Code's built-in auth; no token setup needed for public or private repos where you are already signed in.
- **`.pvnc/config.json`** — committed workspace config file for ticket system details (owner/repo, base URLs). Auto-detected from the git remote for GitHub if the file is absent.
- **`Provenance: Set up workspace config` command** — interactive wizard to create `.pvnc/config.json`, with auto-detection of GitHub owner/repo from the git remote.
- **Provenance output channel** — ticket fetch activity and errors are logged to the **Provenance** output channel for diagnostics.
- **Autocomplete filtered by config** — ticket system completions (inside `<pvnc>` blocks and after `pvnc.`) only show systems present in `.pvnc/config.json`.
- **Inline `pvnc.*` autocomplete** — `.` added as a trigger character; completions now work for `// pvnc.<key>` inline annotations as well as block format.
- **Do-not-change hover highlight** — `do-not-change` entries render in red with a left border in the hover tooltip.
- **Hover title** renamed from `ai-context` to `provenance`.

### Changed

- Hover tooltip now appears only over the annotation comment lines themselves, not over the guarded code below.
- `addAnnotation` command scaffolds the new `system: id` key format.
- AI assistant instruction templates updated to reflect the new annotation format.

### Performance

- **Workspace scan** (`Analyze Workspace`) now uses `workspace.fs.readFile` instead of `openTextDocument` — files are parsed without loading them into editor buffers, keeping memory usage flat regardless of workspace size.
- **Shared `TextDocumentLike` interface** — parser and metrics no longer depend on `vscode.TextDocument` directly, enabling the above without duplicating logic.
- **Debounced tree refresh** — the sidebar panel no longer re-renders on every keystroke; refresh is coalesced with a 300 ms debounce.

---

## [1.0.3] — 2026-05-14

- Publish workflow now guards against tags pushed from non-main branches.
- False-positive annotations no longer detected inside markdown fenced code blocks and string literals.

---

## [1.0.2] — 2026-05-14

- False-positive `do-not-change` warnings in markdown and string literals.

---

## [1.0.1] — 2026-05-14

- Minor parser edge cases for inline `pvnc.*` format.

---

## [1.0.0] — 2026-05-14

Initial release with block (`<pvnc>`) and inline (`pvnc.*`) annotation formats.
Gutter icons, hover tooltips, do-not-change warnings, sidebar panel, workspace metrics.
`Provenance: Add annotation` and `Provenance: Set up AI assistant instructions` commands.
Explorer file badges (opt-in).
