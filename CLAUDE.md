# Provenance extension — development instructions

## Provenance — standing instructions

This project uses the `provenance` annotation convention to embed traceability
directly into source code. Follow these rules on every code change, without
being asked.

## When modifying existing code

1. Read all `<pvnc>` / `<provenance>` blocks that annotate the code you are
   about to change before making any edits.
2. After making the change, add a **new** `<pvnc>` block immediately before
   the affected line or method. Never replace or remove existing blocks.
3. The new block must include:
   - A ticket reference using the system name as the key: `github: 123`,
     `jira: PROJ-42`, `ado: 45678`. If no ticket exists, omit the ticket line.
   - `reason:` — one sentence describing *why* the change was made (not what).
   - `source:` — `human`, `ai.claude`, `ai.copilot`, etc.
4. If the changed code must not be simplified in future, add `do-not-change:` with
   a short justification.

## When adding new code

Add a `<pvnc>` block immediately before the new function, method, or
logical block. Same fields as above.

## Annotation format

```typescript
/**
 * <pvnc>
 *     github: 123
 *     reason: Plain English explanation of why this code exists or changed
 *     source: ai.claude
 * </pvnc>
 */
```

Any ticket system name is a valid key (`jira`, `ado`, `linear`, `confluence`, …).
Adjust the comment style to match the language (`/** */` for Java/TS/JS,
`# ...` for Ruby/shell, etc.). Always indent the keys by 4 spaces inside the
tags. Both `<pvnc>` and `<provenance>` are valid tag names.

## What not to do

- Do not remove or rewrite existing `<pvnc>` / `<provenance>` blocks.
- Do not add annotations to lines you did not change.
- Do not remove or simplify code marked with `do-not-change` without explicit instruction.

## Code Guard rules

1. Never modify code between `pvnc.guard_start` and `pvnc.guard_end` markers.
2. If asked to modify a guarded region, inform the user and request explicit
   confirmation referencing the block ID before proceeding.
3. If proceeding with permission, generate a `pvnc.guard_removed` commit message
   as the first step before making any change:
   `pvnc.guard_removed: <block-id> : <reason>`
4. When replacing a guard after removal, generate a new `pvnc.guard_start`/`pvnc.guard_end`
   block with a new block ID and an accompanying `<pvnc>` annotation.
