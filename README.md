# Provenance

[![Tests](https://github.com/etpedror/provenance-vsce/actions/workflows/tests.yml/badge.svg)](https://github.com/etpedror/provenance-vsce/actions/workflows/tests.yml)
[![VSIX](https://github.com/etpedror/provenance-vsce/actions/workflows/vsix.yml/badge.svg)](https://github.com/etpedror/provenance-vsce/actions/workflows/vsix.yml)
[![Publish](https://github.com/etpedror/provenance-vsce/actions/workflows/publish.yml/badge.svg)](https://github.com/etpedror/provenance-vsce/actions/workflows/publish.yml)

> Embed requirement and compliance traceability directly in your code — giving
> AI assistants and future developers the context they need to understand
> *why* code exists, not just *what* it does.

When an LLM helps with a codebase it has no institutional memory. It cannot know
why a piece of code was written, what requirement drove it, or why an apparently
redundant condition must not be removed. That context lives in Jira tickets, PRs,
and Slack threads — invisible at the point of consumption.

**Provenance** solves this with a lightweight annotation convention that travels
with the code, and a VS Code extension that makes it visible and searchable.

---

## Two annotation formats

Both formats are parsed identically and work in every language. Use whichever
fits your style — they can coexist in the same file.

### Block format — `<provenance>`

A self-delimiting wrapper with `key: value` lines inside. The short alias
`<pvnc>` is also accepted — both tag names are equivalent. Place it in a doc
comment or string literal immediately before the code it annotates. Leading
comment markers (`*`, `#`, `//`) are stripped automatically.

```python
def calculate_tax(order):
    """
    <provenance>
        requirement: USER-1042 (jira)
        reason: Tax engine entry point — called by checkout and invoice flows
        invariant: Result must never be negative
        source: human
    </provenance>
    """
```

```typescript
/**
 * <provenance>
 *     requirement: PAY-88 (github, 2025-01)
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
        requirement: USER-1062 (jira, 2024-Q1)
        reason: HMRC food exemptions introduced — basic food is zero-rated
        source: human
    </pvnc>
    <pvnc>
        requirement: USER-1092 (jira, 2025-Q3)
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
annotation, forming a changelog timeline. (Block format entries are always
independent — grouping applies to inline runs only.)

```python
# pvnc.req: USER-1092 (jira, 2025-Q3)
# pvnc.reason: Sugar content threshold — high-sugar foods excluded
# pvnc.do-not-change: HMRC compliance — audited 2024-03
# pvnc.source: ai.claude
if order.category == "food" and order.sugar_content <= 2:
    ...
```

```go
// pvnc.req: PAY-88 (github, 2025-01)
// pvnc.reason: Signature verification required by PCI-DSS
// pvnc.source: human
func verifyWebhookSignature(payload []byte, sig string) bool {
```

```rust
// pvnc.req: USER-1062
// pvnc.reason: HMRC food exemptions — zero-rated basic food
// pvnc.source: ai.copilot

// pvnc.req: USER-1092
// pvnc.reason: Sugar threshold added — excludes high-sugar foods
// pvnc.dnc: HMRC compliance
// pvnc.source: ai.claude
fn apply_food_exemption(order: &Order) -> bool {
```

**Shorthands:** `pvnc.req` = `requirement` · `pvnc.dnc` = `do-not-change` · `pvnc.inv` = `invariant` · `pvnc.see` = `see-also`

---

## Key reference

| Key | Block format | Inline format | Description |
| --- | ------------ | ------------- | ----------- |
| `requirement` | `requirement: ID (system, date)` | `pvnc.req:` | Work item that drove this code |
| `reason` | `reason: ...` | `pvnc.reason:` | Human-readable explanation |
| `source` | `source: ...` | `pvnc.source:` | Authorship — `human`, `ai.claude`, `ai.copilot`, … |
| `invariant` | `invariant: ...` | `pvnc.inv:` | A rule that must never be violated |
| `do-not-change` | `do-not-change: ...` | `pvnc.dnc:` | Load-bearing complexity — triggers a warning on edit |
| `see-also` | `see-also: ...` | `pvnc.see:` | Cross-references: file paths or ticket IDs (comma-separated) |

### `requirement` value format

```text
requirement: ID (system, date)
```

| Part | Description |
| ---- | ----------- |
| `ID` | Work item identifier, e.g. `USER-1042` |
| `system` | Optional — `jira`, `github`, `ado`, or `linear` |
| `date` | Optional — ISO date or quarter, e.g. `2024-Q1` |

### `source` values

| Value | Meaning |
| ----- | ------- |
| `human` | Written by a person |
| `ai.claude` | Generated by Claude |
| `ai.copilot` | Generated by GitHub Copilot |
| `ai.codex` | Generated by OpenAI Codex |
| `ai.gemini` | Generated by Gemini |
| `ai.cursor` | Generated by Cursor |
| `ai.other` | Any other AI tool |

The `source` key enables an **AI vs human authorship metric** across the
codebase — searchable in the Provenance panel.

---

## Features

### Syntax highlighting

Keys, requirement IDs, reason text, `source` values, and `do-not-change`
entries each render distinctly — composing naturally with any VS Code colour
theme. Both the block and inline formats are highlighted.

### AI vs human authorship metric

The `source` key tracks who — or what — wrote each annotated block. The
Provenance panel aggregates this for opened files by default, and across the
workspace when you run **Analyze Workspace**. That makes the split between
human-written, AI-generated, and unknown-source code visible without forcing a
full repository scan on startup. Gutter icons reinforce this per-line: a teal
chip for AI, an orange person for human, a gray shield when unspecified.

### Gutter icons

A small icon appears in the editor gutter next to every annotated line,
colour-coded by authorship (see above).

### Explorer badges

Explorer file badges are available as an opt-in setting. They are shown only for
files Provenance already knows about — opened files, edited files, or files from
an explicit **Analyze Workspace** run. AI-authored files use `▲`, human-authored
files use `■`, and mixed files use `◆`. Unknown-source and unindexed files are
left unmarked.

### Hover tooltips

Hovering over an annotated method or block surfaces its full annotation
content, including authorship and cross-references. Multiple blocks are shown
as a numbered timeline.

### Do-not-change warnings

Editing code immediately after a `do-not-change:` (or `pvnc.dnc:`) annotation
shows a non-blocking warning:

> This block is marked do-not-change (HMRC compliance — audited 2024-03). Proceed with intention.

### Provenance panel

The **Provenance** sidebar panel starts with a lazy index of opened files, then
updates as files are opened or edited. Use **Analyze Workspace** from the panel
toolbar to run a deterministic full scan and collect workspace-wide metrics:
files with provenance, files with AI-authored content, estimated AI-authored
code lines, unknown-source annotations, and `do-not-change` counts. Use the
**search icon** to filter by requirement ID, system, author, reason, or any
other field. Click any entry to jump to that line.

### Add annotation command

**Command Palette → `Provenance: Add annotation`** scaffolds a block at the
cursor, prompting for requirement ID, ticket system, reason, and authorship.
The block is wrapped in the correct comment style for the active language.

### Set up AI assistant instructions

**Command Palette → `Provenance: Set up AI assistant instructions`** writes
standing instructions into your workspace for every major AI coding assistant:

| File | Agent |
| ---- | ----- |
| `CLAUDE.md` | Claude Code |
| `.github/copilot-instructions.md` | GitHub Copilot |
| `.cursorrules` | Cursor |

Existing files are updated rather than overwritten — the block is appended
only if it is not already present.

---

## Configuration

```jsonc
{
  // Show gutter icons next to annotated lines (default: true)
  // Icon varies by authorship: teal chip = AI, orange person = human, shield = unknown
  "provenance.gutterIcons": true,

  // Show opt-in Explorer badges for known files only (default: false)
  "provenance.explorerFileBadges": false,

  // Warn when editing code guarded by do-not-change (default: true)
  "provenance.warnOnDoNotChange": true,

  // Lines below an annotation treated as guarded (default: 30)
  "provenance.guardedRangeLines": 30,

  // Ticket system connections (reserved for hover enrichment in a future release)
  "provenance.ticketSystems": {
    "jira":   { "baseUrl": "https://yourcompany.atlassian.net", "apiToken": "" },
    "ado":    { "organisation": "yourorg", "pat": "" },
    "github": { "owner": "your-org", "repo": "your-repo", "token": "" }
  }
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
3. Never remove or rewrite existing annotations.
4. Never remove or simplify code marked with do-not-change without explicit instruction.
5. Always include a source: key identifying the authorship of the new code.
```

---

## Supported languages

Python · TypeScript · JavaScript · Java · C# · C/C++ · Rust · Go · Ruby · PHP · Kotlin · Swift · and any other language with line or block comments

Both the `<pvnc>` / `<provenance>` block and `pvnc.*` inline formats are
parser-agnostic — they work in any file regardless of comment style.

---

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

---

## Licence

MIT © 2026 Pedro Ribeiro
