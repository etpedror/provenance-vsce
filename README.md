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
linked to live ticket data.

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

GitHub issues are fetched using your existing VS Code GitHub login — no token
setup required. Other systems require a PAT stored in VS Code's encrypted secret
storage (see workspace config below).

### Gutter icons

A small icon appears in the editor gutter next to every annotated line,
colour-coded by authorship: teal chip for AI, orange person for human, gray
shield when unspecified.

### Do-not-change warnings

Editing code immediately after a `do-not-change:` annotation shows a
non-blocking warning. The annotation is also highlighted in red in the hover
tooltip to make it unmissable.

### Provenance panel

The **Provenance** sidebar panel starts with a lazy index of opened files, then
updates as files are opened or edited. Use **Analyze Workspace** to run a full
scan and collect workspace-wide metrics: files with provenance, AI vs human
authorship split, estimated annotated code lines, and `do-not-change` counts.
Use the **search icon** to filter by ticket ID, system, author, or reason text.
Click any entry to jump to that line.

### Explorer badges

Opt-in file badges in the Explorer show authorship at a glance: `▲` for
AI-authored, `■` for human-authored, `◆` for mixed. Only shown for files
Provenance has already indexed.

### Add annotation command

**Command Palette → `Provenance: Add annotation`** scaffolds a block at the
cursor, prompting for ticket ID, system, reason, and authorship. The block is
wrapped in the correct comment style for the active language. Autocomplete
suggests all configured ticket system keys inside blocks and after `pvnc.`.

### Set up workspace config

**Command Palette → `Provenance: Set up workspace config`** creates
`.pvnc/config.json` interactively, walking you through your ticket system
details. For GitHub, owner and repo are auto-detected from the git remote.
Commit this file so all team members share the same configuration.

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

  // Lines below an annotation treated as guarded (default: 30)
  "provenance.guardedRangeLines": 30
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
