# Provenance — standing instructions

This project uses the `provenance` annotation convention to embed traceability
directly into source code. Follow these rules on every code change, without
being asked.

## When modifying existing code

1. Read all `<pvnc>` / `<provenance>` blocks that annotate the code you are
   about to change before making any edits.
2. After making the change, add a **new** `<pvnc>` block immediately before
   the affected line or method. Never replace or remove existing blocks.
3. The new block must include:
   - `requirement:` — use the ticket/issue ID the user mentions, or `UNKNOWN` if
     none is given.
   - `reason:` — one sentence describing *why* the change was made (not what).
   - `source:` — `human`, `ai.claude`, `ai.copilot`, etc.
4. If the changed code must not be simplified in future, add `do-not-change:` with
   a short justification.

## When adding new code

Add a `<pvnc>` block immediately before the new function, method, or
logical block. Same fields as above.

## Annotation format

```python
"""
<pvnc>
    requirement: TICKET-123 (github)
    reason: Plain English explanation of why this code exists or changed
    source: ai.claude
</pvnc>
"""
```

Adjust the comment style to match the language (`/** */` for Java/TS/JS,
`# ...` for Ruby/shell, etc.). Always indent the keys by 4 spaces inside the
tags. Both `<pvnc>` and `<provenance>` are valid tag names.

## What not to do

- Do not remove or rewrite existing `<pvnc>` / `<provenance>` blocks.
- Do not add annotations to lines you did not change.
- Do not remove or simplify code marked with `do-not-change` without explicit instruction.
