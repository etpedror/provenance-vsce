# Provenance

[![Tests](https://github.com/etpedror/provenance-vsce/actions/workflows/tests.yml/badge.svg)](https://github.com/etpedror/provenance-vsce/actions/workflows/tests.yml)
[![Package](https://github.com/etpedror/provenance-vsce/actions/workflows/vsix.yml/badge.svg)](https://github.com/etpedror/provenance-vsce/actions/workflows/vsix.yml)
[![Publish](https://github.com/etpedror/provenance-vsce/actions/workflows/publish.yml/badge.svg)](https://github.com/etpedror/provenance-vsce/actions/workflows/publish.yml)

> Embed requirement and compliance traceability directly in your code — giving
> AI assistants and future developers the context they need to understand
> *why* code exists, not just *what* it does.

When an LLM helps with a codebase it has no institutional memory. It cannot know
why a piece of code was written, what requirement drove it, or why an apparently
redundant condition must not be removed. That context lives in Jira tickets, PRs,
and Slack threads — invisible at the point of consumption.

**Provenance** solves this with a lightweight annotation convention that travels
with the code, and a VS Code extension that makes it visible, searchable, and
linked to live ticket data. For regions that must never change, **Code Guard**
adds structural fences with explicit boundaries, gutter indicators, and CI
enforcement.

---

## Two annotation formats

Both formats are parsed identically and work in every language. Use whichever
fits your style — they can coexist in the same file.

### Block format — `<provenance>`

A self-delimiting wrapper with `key: value` lines inside. The short alias
`<pvnc>` is also accepted. Place it in a doc comment or string literal
immediately before the code it annotates. Leading comment markers (`*`, `#`,
`//`) are stripped automatically.

```python
def calculate_tax(order):
    """
    <provenance>
        jira: USER-1042
        reason: Tax engine entry point — called by checkout and invoice flows
        invariant: Result must never be negative
        source: human
    </provenance>
    """
```

```typescript
/**
 * <provenance>
 *     github: 88
 *     reason: Stripe webhook signature verification required by PCI-DSS
 *     do-not-change: PCI-DSS compliance — audited 2025-01
 *     source: ai.claude
 * </provenance>
 */
```

Each block is independent — its own gutter icon, its own `source`, its own
`do-not-change` guard. Stack multiple blocks before a function to record the
full change history:

```python
    """
    <pvnc>
        jira: USER-1062 (2024-Q1)
        reason: HMRC food exemptions introduced — basic food is zero-rated
        source: human
    </pvnc>
    <pvnc>
        jira: USER-1092 (2025-Q3)
        reason: Sugar content threshold added — high-sugar foods excluded
        do-not-change: HMRC compliance — do not simplify this condition
        source: ai.claude
    </pvnc>
    """
    if order.category == "food" and order.sugar_content <= 2:
        ...
```

### Inline format — `pvnc.*`

One comment line per key — no wrapper needed. Works anywhere a line comment
works. Consecutive runs separated only by blank lines are grouped into a single
annotation. Use the ticket system name directly as the key suffix.

```python
# pvnc.jira: USER-1092
# pvnc.reason: Sugar content threshold — high-sugar foods excluded
# pvnc.do-not-change: HMRC compliance — audited 2024-03
# pvnc.source: ai.claude
if order.category == "food" and order.sugar_content <= 2:
    ...
```

```go
// pvnc.github: 88
// pvnc.reason: Signature verification required by PCI-DSS
// pvnc.source: human
func verifyWebhookSignature(payload []byte, sig string) bool {
```

```rust
// pvnc.jira: USER-1062
// pvnc.reason: HMRC food exemptions — zero-rated basic food
// pvnc.source: ai.copilot

// pvnc.jira: USER-1092
// pvnc.reason: Sugar threshold added — excludes high-sugar foods
// pvnc.dnc: HMRC compliance
// pvnc.source: ai.claude
fn apply_food_exemption(order: &Order) -> bool {
```

**Shorthands:** `pvnc.dnc` = `do-not-change` · `pvnc.inv` = `invariant` · `pvnc.see` = `see-also`

---

## Code Guard

Code Guard adds **structural fences** around regions that must not change. Where
`do-not-change:` is an advisory annotation (fuzzy scope, no enforcement), a guard
is an explicit start/end boundary with CI enforcement and a mandatory two-commit
removal workflow.

### Marking a guarded region

```python
# <pvnc>
#     jira: HMRC-001
#     reason: HMRC 2026-Q1 food exemption rules — audited annually
#     do-not-change: HMRC compliance
#     source: human
# </pvnc>
# pvnc.guard_start: block-hmrc-001
if order.category == "food" and order.sugar_content <= 2:
    tax = 0.0
if order.salt_content > 10:
    tax *= 1.05
# pvnc.guard_end: block-hmrc-001
```

- Block IDs are arbitrary strings — make them meaningful
- Block ID must match exactly between `guard_start` and `guard_end`
- Guards work in any language with line comments
- A `<pvnc>` annotation immediately before `guard_start` documents the requirement; the metrics panel distinguishes documented from undocumented guards

### Removing a guard (two-commit workflow)

Before modifying a guarded region, commit a removal declaration first:

```python
# pvnc.guard_removed: block-hmrc-001 : New HMRC directive 2026-Q2 supersedes previous rule
```

**Commit 1** — the `pvnc.guard_removed` declaration with reason  
**Commit 2** — the actual change, optionally replacing with a new guard

Run **`Provenance: Remove guard`** from the Command Palette to scaffold the
declaration and commit message automatically.

### `do-not-change` vs Code Guard

| | `do-not-change:` | Code Guard |
| --- | --- | --- |
| Type | Advisory annotation field | Structural fence |
| Scope | Inferred from proximity (up to 30 lines) | Explicit `guard_start` / `guard_end` |
| AI instruction | Soft warning | Hard boundary |
| CI enforcement | Optional | Built-in |
| Referenceable by ID | No | Yes |
| Removal ceremony | None | Two-commit workflow |

Use `do-not-change:` for lightweight, single-function protection with a documented
reason. Use Code Guard when you need precise boundaries, CI enforcement, and a
formal audit trail for the removal. They work best together — place a `<pvnc>`
block with `do-not-change:` immediately before `guard_start` to get both.

---

## CI enforcement for Code Guard

The `ci/` folder contains a Python script and ready-to-use pipeline files that
enforce the two-commit workflow on every pull request. All three platforms invoke
the same core logic — no duplication.

### Core script — `ci/check-codeguard.py`

```bash
python ci/check-codeguard.py [--base <ref>] [--head <ref>]
```

Analyses the diff between `base` and `head`, identifies any lines inside a
guarded region that were modified, and checks the commit history for a
`pvnc.guard_removed` declaration matching the block ID. Exits `0` (clean) or
`1` (violations). Also warns on stale declarations and malformed guards.

Copy `ci/check-codeguard.py` into your own repo to use it with any of the
integrations below.

### GitHub Actions

Copy `.github/workflows/codeguard.yml` into your repo. It triggers on every PR,
posts a summary comment (updating it on re-runs rather than adding duplicates),
and fails the check if any guard is violated.

### Azure DevOps

Copy `ci/azure-codeguard.yml` into your repo and reference it from your pipeline
settings. Requires no additional dependencies beyond Python 3.11+.

### Pre-commit (local enforcement)

Add to your `.pre-commit-config.yaml`:

```yaml
repos:
  - repo: https://github.com/etpedror/provenance-vsce
    rev: v1.1.0          # pin to a release tag
    hooks:
      - id: codeguard
```

The hook runs at `push` stage (not commit stage) because the two-commit workflow
needs the `guard_removed` commit to be in local history before the modifying
commit is pushed.

### CI check behaviour

| Condition | Result |
| --- | --- |
| Guard region modified, no preceding `guard_removed` | Fail — block PR |
| Guard region modified, `guard_removed` in prior commit | Pass |
| `guard_start` without matching `guard_end` | Warn — malformed guard |
| `guard_removed` declared but no change made | Warn — stale declaration |

---

## Ticket system keys

The ticket system name is the key. Any key not reserved by Provenance is treated
as a ticket system reference and will be looked up if the system is configured.

```text
github: 42
jira: PROJ-123
ado: 45678
linear: ENG-99
confluence: architecture/decisions/001
```

You can reference multiple systems in one block:

```text
<pvnc>
    jira: PROJ-123
    confluence: architecture/decisions/001
    reason: Refactored per ADR-001 agreed in planning
    source: human
</pvnc>
```

---

## Key reference

| Key | Block format | Inline shorthand | Description |
| --- | ------------ | ---------------- | ----------- |
| *(ticket system)* | `github: 42` · `jira: PROJ-1` · `ado: 123` · … | `pvnc.github:` · `pvnc.jira:` · … | Work item or page reference — any system name is valid |
| `reason` | `reason: ...` | `pvnc.reason:` | Human-readable explanation of why this code exists |
| `source` | `source: ...` | `pvnc.source:` | Authorship — `human`, `ai.claude`, `ai.copilot`, … |
| `invariant` | `invariant: ...` | `pvnc.inv:` | A rule that must never be violated |
| `do-not-change` | `do-not-change: ...` | `pvnc.dnc:` | Load-bearing complexity — triggers a warning on edit |
| `see-also` | `see-also: ...` | `pvnc.see:` | Cross-references: file paths or IDs (comma-separated) |

### `source` values

> **Privacy note:** `source` identifies the *type* of authorship — `human`, `ai.claude`, `ai.copilot` — never the individual. Provenance is about code accountability, not developer monitoring. Aggregate metrics answer governance questions without creating surveillance.

| Value | Meaning |
| ----- | ------- |
| `human` | Written by a person |
| `ai.claude` | Generated by Claude |
| `ai.copilot` | Generated by GitHub Copilot |
| `ai.codex` | Generated by OpenAI Codex |
| `ai.gemini` | Generated by Gemini |
| `ai.cursor` | Generated by Cursor |
| `ai.other` | Any other AI tool |

---

## Features

### Hover tooltips with live ticket data

Hovering over a provenance annotation surfaces its full content. When a ticket
system is configured, the extension fetches the live issue title and state and
shows it inline — no need to leave the editor.

```text
provenance
─────────────────────────────
github: 42  — Fix hover tooltip scope  🟢
Reason: Restrict hover to annotation comment lines only
Authored by: 🤖 ai.claude
```

Hovering over a `pvnc.guard_start` or `pvnc.guard_end` line shows the block ID,
the linked requirement from the associated `<pvnc>` annotation, and a reminder of
the removal workflow.

GitHub issues are fetched using your existing VS Code GitHub login — no token
setup required. Other systems require a PAT stored in VS Code's encrypted secret
storage (see workspace config below).

### Gutter icons

A small icon appears in the editor gutter next to every annotated line,
colour-coded by authorship: teal chip for AI, orange person for human, gray
shield when unspecified. `pvnc.guard_start` and `pvnc.guard_end` lines show
a distinct amber shield icon; malformed guards (missing end marker) show the
icon with a warning label.

### Code Guard region tint

Lines within a guarded region receive a configurable background tint (default:
faint red). Editing any interior line triggers a non-blocking warning with a
**Scaffold removal** button that launches the **Remove guard** command.

### Do-not-change warnings

Editing code immediately after a `do-not-change:` annotation shows a
non-blocking warning. The annotation is also highlighted in red in the hover
tooltip to make it unmissable.

### Provenance panel

The **Provenance** sidebar panel starts with a lazy index of opened files, then
updates as files are opened or edited. Use **Analyze Workspace** to run a full
scan and collect workspace-wide metrics: files with provenance, AI vs human
authorship split, estimated annotated code lines, `do-not-change` counts, and
guard region density.

A **Guards** section appears in the panel whenever guard regions are found,
listing each block ID, its file and line range, and whether it has a linked
`<pvnc>` annotation. Click any entry to navigate to the guard marker.

Use the **search icon** to filter annotations by ticket ID, system, author, or
reason text.

### Explorer badges

Opt-in file badges in the Explorer show authorship at a glance: `▲` for
AI-authored, `■` for human-authored, `◆` for mixed. Only shown for files
Provenance has already indexed.

### Add annotation command

**Command Palette → `Provenance: Add annotation`** scaffolds a block at the
cursor, prompting for ticket ID, system, reason, and authorship. The block is
wrapped in the correct comment style for the active language. Autocomplete
suggests all configured ticket system keys inside blocks and after `pvnc.`.

### Remove guard command

**Command Palette → `Provenance: Remove guard`** prompts for the block ID (pre-
filled from the active document if only one guard is present) and a removal
reason, then opens an output channel with the ready-to-paste `pvnc.guard_removed`
declaration and commit message. Copy either to the clipboard with one click.

### Set up workspace config

**Command Palette → `Provenance: Set up workspace config`** creates
`.pvnc/config.json` interactively, walking you through your ticket system
details. For GitHub, owner and repo are auto-detected from the git remote.
Commit this file so all team members share the same configuration.

### Set up AI assistant instructions

**Command Palette → `Provenance: Set up AI assistant instructions`** writes
standing instructions into your workspace for every major AI coding assistant,
including the Code Guard rules:

| File | Agent |
| ---- | ----- |
| `CLAUDE.md` | Claude Code |
| `.github/copilot-instructions.md` | GitHub Copilot |
| `.cursorrules` | Cursor |

Existing files are updated rather than overwritten — the block is appended
only if it is not already present.

---

## Workspace config — `.pvnc/config.json`

Create this file (or use the **Set up workspace config** command) to configure
ticket system integration. Commit it to share with your team — it contains no
credentials.

```json
{
  "defaultSystem": "github",
  "github": {
    "owner": "your-org",
    "repo": "your-repo"
  }
}
```

With `jira` or `ado`:

```json
{
  "defaultSystem": "jira",
  "jira": {
    "baseUrl": "https://yourcompany.atlassian.net",
    "project": "PROJ"
  },
  "ado": {
    "organisation": "yourorg",
    "project": "MyProject"
  }
}
```

Credentials (PATs, tokens) are stored separately in VS Code's encrypted secret
storage — never in this file.

---

## VS Code settings

```jsonc
{
  // Show gutter icons next to annotated lines (default: true)
  "provenance.gutterIcons": true,

  // Show opt-in Explorer badges for known files only (default: false)
  "provenance.explorerFileBadges": false,

  // Warn when editing code guarded by do-not-change (default: true)
  "provenance.warnOnDoNotChange": true,

  // Lines below an annotation treated as guarded for do-not-change (default: 30)
  "provenance.guardedRangeLines": 30,

  // ── Code Guard ───────────────────────────────────────────────────

  // Enable Code Guard features globally (default: true)
  "provenance.codeGuard.enabled": true,

  // Shield gutter icon on guard_start / guard_end lines (default: true)
  "provenance.codeGuard.gutterHighlight": true,

  // Background tint on lines inside a guarded region (default: true)
  "provenance.codeGuard.regionTint": true,

  // Colour for the region tint — supports rgba / 8-digit hex (default: "#ff000011")
  "provenance.codeGuard.regionTintColour": "#ff000011",

  // Warn when editing inside a guarded region (default: true)
  "provenance.codeGuard.warnOnEdit": true,

  // Reserved for CI / pre-commit hook integration (default: true)
  "provenance.codeGuard.ciStrictMode": true
}
```

---

## AI assistant instruction

Add this to your Cursor rules, Copilot instructions, or Claude project context
(or use the **Set up AI assistant instructions** command to do it automatically):

```text
When modifying code that contains <pvnc> / <provenance> blocks or pvnc.* comments:
1. Read all annotation entries before making any changes.
2. After making a change, add a new <pvnc> block immediately before the affected code.
3. Use the ticket system name as the key: github: 42, jira: PROJ-1, ado: 123.
   If no ticket exists, omit the ticket line.
4. Never remove or rewrite existing annotations.
5. Never remove or simplify code marked with do-not-change without explicit instruction.
6. Always include a source: key identifying the authorship of the new code.

Code Guard rules:
1. Never modify code between pvnc.guard_start and pvnc.guard_end markers.
2. If asked to modify a guarded region, inform the user and request explicit
   confirmation referencing the block ID before proceeding.
3. If proceeding with permission, generate a pvnc.guard_removed commit message
   as the first step before making any change:
   pvnc.guard_removed: <block-id> : <reason>
4. When replacing a guard after removal, generate a new pvnc.guard_start/end
   block with a new block ID and an accompanying <pvnc> annotation.
```

---

## Supported languages

Python · TypeScript · JavaScript · Java · C# · C/C++ · Rust · Go · Ruby · PHP · Kotlin · Swift · and any other language with line or block comments

Both the `<pvnc>` / `<provenance>` block and `pvnc.*` inline formats are
parser-agnostic — they work in any file regardless of comment style. Code Guard
markers are plain line comments and work in any language that supports them.

---

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

---

## Licence

MIT © 2026 Pedro Ribeiro
