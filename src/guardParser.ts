/**
 * <pvnc>
 *     reason: Parse pvnc.guard_start / pvnc.guard_end markers into structured GuardRegion objects for use by gutter, watcher, hover, and tree providers
 *     source: ai.claude
 * </pvnc>
 */
import * as vscode from 'vscode';
import { AiContextAnnotation, GuardRegion, TextDocumentLike } from './types';

const GUARD_START_RE = /^[ \t]*(?:[#*]|\/\/)\s*pvnc\.guard_start\s*:\s*(\S+)/;
const GUARD_END_RE   = /^[ \t]*(?:[#*]|\/\/)\s*pvnc\.guard_end\s*:\s*(\S+)/;

const cache = new Map<string, { version: number; regions: GuardRegion[] }>();

export function parseGuards(doc: TextDocumentLike, annotations: AiContextAnnotation[]): GuardRegion[] {
  if (doc.languageId === 'markdown') return [];

  const cacheKey = doc.uri.toString();
  const cached = cache.get(cacheKey);
  if (cached?.version === doc.version) return cached.regions;

  const lineCount = doc.lineCount;

  // Collect raw start/end positions.
  interface RawMarker { kind: 'start' | 'end'; blockId: string; line: number }
  const markers: RawMarker[] = [];

  for (let i = 0; i < lineCount; i++) {
    const text = doc.lineAt(i).text;
    const ms = GUARD_START_RE.exec(text);
    if (ms) { markers.push({ kind: 'start', blockId: ms[1], line: i }); continue; }
    const me = GUARD_END_RE.exec(text);
    if (me) { markers.push({ kind: 'end', blockId: me[1], line: i }); }
  }

  // Pair starts with ends. Open a stack per block ID, flag malformed on mismatch.
  const openStack = new Map<string, number[]>(); // blockId -> stack of start lines
  const regions: GuardRegion[] = [];

  for (const marker of markers) {
    if (marker.kind === 'start') {
      if (!openStack.has(marker.blockId)) openStack.set(marker.blockId, []);
      const stack = openStack.get(marker.blockId)!;
      if (stack.length > 0) {
        // Nested guard — flag the previous unclosed one as malformed and start fresh.
        regions.push(makeRegion(marker.blockId, stack.pop()!, undefined, true, annotations));
      }
      stack.push(marker.line);
    } else {
      const stack = openStack.get(marker.blockId);
      if (!stack?.length) {
        // End with no matching start — flag it so the gutter shows a warning on this line.
        regions.push({ blockId: marker.blockId, startLine: marker.line, endLine: undefined, isMalformed: true, isOrphanedEnd: true });
        continue;
      }
      const startLine = stack.pop()!;
      regions.push(makeRegion(marker.blockId, startLine, marker.line, false, annotations));
    }
  }

  // Any remaining open starts are malformed (missing end).
  for (const [blockId, stack] of openStack) {
    for (const startLine of stack) {
      regions.push(makeRegion(blockId, startLine, undefined, true, annotations));
    }
  }

  regions.sort((a, b) => a.startLine - b.startLine);
  cache.set(cacheKey, { version: doc.version, regions });
  return regions;
}

function makeRegion(
  blockId: string,
  startLine: number,
  endLine: number | undefined,
  isMalformed: boolean,
  annotations: AiContextAnnotation[],
): GuardRegion {
  // Associate a pvnc annotation whose block ends immediately before guard_start.
  const associated = annotations.find(
    a => a.annotationEndLine >= startLine - 3 && a.annotationEndLine < startLine,
  );
  return { blockId, startLine, endLine, isMalformed, associatedAnnotation: associated };
}

export function invalidateGuardCache(uri: vscode.Uri): void {
  cache.delete(uri.toString());
}

/** Return the guard region that contains the given line (interior lines only, not the markers). */
export function findGuardForLine(line: number, regions: GuardRegion[]): GuardRegion | undefined {
  return regions.find(
    r => r.endLine !== undefined && line > r.startLine && line < r.endLine,
  );
}

/** Return the guard region whose start or end marker is on the given line. */
export function findGuardMarkerAtLine(line: number, regions: GuardRegion[]): GuardRegion | undefined {
  return regions.find(r => r.startLine === line || r.endLine === line);
}
