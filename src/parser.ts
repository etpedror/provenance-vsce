import * as vscode from 'vscode';
import { AiContextAnnotation, AiContextBlock, Requirement, TextDocumentLike } from './types';

// ── XML block format ──────────────────────────────────────────────────────────

// Opening tag must be the first meaningful content on its line (after optional
// whitespace and comment markers). This prevents matching tags inside string
// literals or template expressions in source code.
const OUTER_RE = /^[ \t]*[*#/]*[ \t]*<(?:pvnc|provenance)>([\s\S]*?)<\/(?:pvnc|provenance)>/gm;
const LINE_RE = /^[ \t*#/]*?([\w-]+):\s*(.*)/gm;
const REQ_VALUE_RE = /^(\S+)(?:\s+\(([^,)]+?)(?:,\s*([^)]+?))?\))?/;
const BETWEEN_RE = /^[\s"'`*#/|\\!;.,\-()[\]{}@]*$/;

// ── Inline pvnc format ────────────────────────────────────────────────────────

// Matches: # pvnc.req: VALUE  or  // pvnc.source: VALUE  etc.
const PVNC_LINE_RE = /^[ \t]*(?:[#*]|\/\/)\s*pvnc\.([\w-]+):\s*(.*)/;

/** Known non-ticket keys inside a <pvnc> block or pvnc.* inline annotation. */
export const KNOWN_KEYS = ['reason', 'invariant', 'do-not-change', 'source', 'see-also'] as const;
export type KnownKey = typeof KNOWN_KEYS[number];

// Normalise pvnc shorthand keys to canonical names.
// Returns the canonical key for known fields, the raw key for ticket systems, null to discard.
function normalisePvncKey(raw: string): string | null {
  switch (raw) {
    case 'reason':         return 'reason';
    case 'source':         return 'source';
    case 'do-not-change':
    case 'dnc':            return 'do-not-change';
    case 'invariant':
    case 'inv':            return 'invariant';
    case 'see-also':
    case 'see':            return 'see-also';
    // Backward compat: old requirement: ID (system) syntax
    case 'req':
    case 'requirement':    return 'requirement';
    // Unknown key → ticket system name (e.g. pvnc.github, pvnc.jira, pvnc.confluence)
    default:               return raw;
  }
}

// ── Shared accumulator ────────────────────────────────────────────────────────

interface BlockAccumulator {
  requirements: Requirement[];
  reasons: string[];
  invariants: string[];
  doNotChange: string | undefined;
  source: string | undefined;
  seeAlso: string[];
}

function newAccumulator(): BlockAccumulator {
  return { requirements: [], reasons: [], invariants: [], doNotChange: undefined, source: undefined, seeAlso: [] };
}

function applyKeyValue(acc: BlockAccumulator, key: string, value: string): void {
  switch (key) {
    case 'reason':
      if (value) acc.reasons.push(value);
      break;
    case 'invariant':
      if (value) acc.invariants.push(value);
      break;
    case 'do-not-change':
      acc.doNotChange = value;
      break;
    case 'source':
      if (value) acc.source = value;
      break;
    case 'see-also':
      if (value) acc.seeAlso.push(...value.split(',').map(s => s.trim()).filter(Boolean));
      break;
    case 'requirement': {
      // Backward compat: requirement: ID (system, date)
      const rv = REQ_VALUE_RE.exec(value);
      if (rv) acc.requirements.push({ id: rv[1], system: rv[2], date: rv[3] });
      break;
    }
    default:
      // Any other key is a ticket system reference: github: 1, jira: PROJ-42, confluence: page/path
      if (value) acc.requirements.push({ id: value.trim(), system: key });
  }
}

function accToBlock(acc: BlockAccumulator, startLine: number, endLine: number): AiContextBlock {
  return {
    requirements: acc.requirements,
    reasons: acc.reasons,
    invariants: acc.invariants,
    doNotChange: acc.doNotChange,
    source: acc.source,
    seeAlso: acc.seeAlso,
    startLine,
    endLine,
  };
}

// ── XML block parser ──────────────────────────────────────────────────────────

interface RawBlock {
  block: AiContextBlock;
  startOffset: number;
  endOffset: number;
}

function parseBlockContent(
  inner: string,
  startOffset: number,
  endOffset: number,
  doc: TextDocumentLike,
): AiContextBlock {
  const acc = newAccumulator();
  LINE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = LINE_RE.exec(inner)) !== null) {
    applyKeyValue(acc, m[1], m[2].trim());
  }
  return accToBlock(acc, doc.positionAt(startOffset).line, doc.positionAt(endOffset).line);
}

function parseXmlAnnotations(text: string, doc: TextDocumentLike): AiContextAnnotation[] {
  const rawBlocks: RawBlock[] = [];
  OUTER_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = OUTER_RE.exec(text)) !== null) {
    const startOffset = match.index;
    const endOffset = match.index + match[0].length;
    rawBlocks.push({ block: parseBlockContent(match[1], startOffset, endOffset, doc), startOffset, endOffset });
  }

  // Each XML block is self-delimiting — no grouping. Each becomes its own annotation
  // so gutter icons and source categories are independent per block.
  return rawBlocks.map(({ block }) => ({
    blocks: [block],
    annotationStartLine: block.startLine,
    annotationEndLine: block.endLine,
    guardedStartLine: block.endLine + 1,
    guardedEndLine: block.endLine + 30, // recalculated after merge
    hasDoNotChange: block.doNotChange !== undefined,
  }));
}

// ── Inline pvnc parser ────────────────────────────────────────────────────────

interface PvncRun {
  block: AiContextBlock;
  startLine: number;
  endLine: number;
  startOffset: number;
  endOffset: number;
}

function parsePvncAnnotations(text: string, doc: TextDocumentLike): AiContextAnnotation[] {
  const lineCount = doc.lineCount;

  // Pass 1: collect individual pvnc runs (consecutive pvnc.* comment lines).
  const runs: PvncRun[] = [];
  let i = 0;
  while (i < lineCount) {
    if (!PVNC_LINE_RE.test(doc.lineAt(i).text)) { i++; continue; }

    const runStart = i;
    const acc = newAccumulator();
    while (i < lineCount) {
      const m = PVNC_LINE_RE.exec(doc.lineAt(i).text);
      if (!m) break;
      const key = normalisePvncKey(m[1]);
      if (key) applyKeyValue(acc, key, m[2].trim());
      i++;
    }
    const runEnd = i - 1;
    runs.push({
      block: accToBlock(acc, runStart, runEnd),
      startLine: runStart,
      endLine: runEnd,
      startOffset: doc.offsetAt(new vscode.Position(runStart, 0)),
      endOffset: doc.offsetAt(new vscode.Position(runEnd, doc.lineAt(runEnd).text.length)),
    });
  }

  // Pass 2: merge adjacent runs separated only by whitespace / comment noise,
  // exactly as the XML parser merges consecutive <pvnc> blocks.
  const annotations: AiContextAnnotation[] = [];
  let j = 0;
  while (j < runs.length) {
    const group: AiContextBlock[] = [runs[j].block];
    let lastEndOffset = runs[j].endOffset;

    while (j + 1 < runs.length) {
      const between = text.slice(lastEndOffset, runs[j + 1].startOffset);
      if (BETWEEN_RE.test(between)) {
        j++;
        group.push(runs[j].block);
        lastEndOffset = runs[j].endOffset;
      } else {
        break;
      }
    }

    const annotStart = group[0].startLine;
    const annotEnd = group[group.length - 1].endLine;
    annotations.push({
      blocks: group,
      annotationStartLine: annotStart,
      annotationEndLine: annotEnd,
      guardedStartLine: annotEnd + 1,
      guardedEndLine: annotEnd + 30, // recalculated after merge
      hasDoNotChange: group.some(b => b.doNotChange !== undefined),
    });
    j++;
  }

  return annotations;
}

// ── Cache + public API ────────────────────────────────────────────────────────

const cache = new Map<string, { version: number; annotations: AiContextAnnotation[] }>();

export function parseDocument(doc: TextDocumentLike): AiContextAnnotation[] {
  if (doc.languageId === 'markdown') return [];

  const cacheKey = doc.uri.toString();
  const cached = cache.get(cacheKey);
  if (cached?.version === doc.version) return cached.annotations;

  const text = doc.getText();

  // Merge XML blocks and pvnc inline annotations, sorted by start line.
  const all = [...parseXmlAnnotations(text, doc), ...parsePvncAnnotations(text, doc)].sort(
    (a, b) => a.annotationStartLine - b.annotationStartLine,
  );

  const guardedRange = vscode.workspace
    .getConfiguration('provenance')
    .get<number>('guardedRangeLines', 30);

  // Recalculate guardedEndLine so zones never overlap each other.
  for (let i = 0; i < all.length; i++) {
    const nextStart = all[i + 1]?.annotationStartLine ?? (all[i].annotationEndLine + guardedRange + 1);
    all[i] = { ...all[i], guardedEndLine: Math.min(all[i].annotationEndLine + guardedRange, nextStart - 1) };
  }

  cache.set(cacheKey, { version: doc.version, annotations: all });
  return all;
}

export function invalidateCache(uri: vscode.Uri): void {
  cache.delete(uri.toString());
}
