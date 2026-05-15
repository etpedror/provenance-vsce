# Security Policy

## Supported Versions

Only the latest release receives security updates.

| Version | Supported |
| ------- | --------- |
| Latest  | ✅        |
| Older   | ❌        |

## Reporting a Vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Report them privately via GitHub's [Security Advisories](https://github.com/etpedror/provenance-vsce/security/advisories/new) feature. You can expect an acknowledgement within 48 hours and a fix or mitigation within 14 days, depending on severity.

## Scope

Provenance is a VS Code extension that parses source files and writes instruction files to your workspace. The main areas of concern are:

- **Workspace writes** — the `Set up AI assistant instructions` command writes files (`CLAUDE.md`, `.cursorrules`, `.github/copilot-instructions.md`) into your workspace. It only appends to existing files and never overwrites content.
- **File scanning** — the extension reads source files in your workspace to find annotations. It does not transmit any data externally.
- **No network calls** — the extension makes no outbound network requests. Ticket system configuration (`provenance.ticketSystems`) is reserved for a future release and is not active.
- **Code Guard removal command** — the `Provenance: Remove guard` command writes only to the VS Code output channel and clipboard. It does not modify any source files.
