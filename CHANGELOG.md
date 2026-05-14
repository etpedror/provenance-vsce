# Changelog

All notable changes to this project will be documented in this file.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.1.0] — 2025-05-14

### Added

- **`<ai-context>` annotation convention** — language-agnostic `key: value` format
  embedded inside doc comments or string literals.
- **Syntax highlighting** — injection grammar covering Python, TypeScript, JavaScript,
  Java, C#, Rust, Go, and more. Keys, requirement IDs, and `do-not-change` entries
  each render distinctly within any colour theme.
- **Gutter icons** — small icon in the editor gutter next to every annotated line.
- **Hover tooltips** — surfaces requirement IDs, reasons, invariants, and
  `do-not-change` warnings on hover. Multiple blocks shown as a numbered timeline.
- **Do-not-change warnings** — non-blocking warning when editing code immediately
  following a `do-not-change:` annotation.
- **Annotations sidebar** — Activity Bar panel listing every `<ai-context>` block
  in the workspace, grouped by file, with click-to-navigate.
- **Annotation search** — filter the sidebar by requirement ID, system, reason text,
  or invariant content.
- **`ai-context: Add annotation` command** — scaffolds a correctly-structured block
  at the cursor, prompting for ID, system, and reason. Wraps in the correct comment
  style for the active language.
- **`ai-context: Set up AI assistant instructions` command** — writes standing
  instructions for Claude Code (`CLAUDE.md`), GitHub Copilot
  (`.github/copilot-instructions.md`), and Cursor (`.cursorrules`) into the
  workspace. Appends to existing files rather than overwriting them; skips files
  that already contain the block.
