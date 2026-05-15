/**
 * <pvnc>
 *     requirement: UNKNOWN
 *     reason: Decouple parser and metrics from vscode.TextDocument so workspace scan can use raw file bytes without opening editor buffers
 *     source: ai.claude
 * </pvnc>
 */
export interface TextDocumentLike {
  readonly uri: import('vscode').Uri;
  readonly version: number;
  readonly languageId: string;
  readonly lineCount: number;
  getText(): string;
  lineAt(line: number): { readonly text: string };
  positionAt(offset: number): { readonly line: number; readonly character: number };
  offsetAt(position: { readonly line: number; readonly character: number }): number;
}

export interface Requirement {
  id: string;
  system?: string;
  date?: string;
}

export interface AiContextBlock {
  requirements: Requirement[];
  reasons: string[];
  invariants: string[];
  /** undefined = tag absent; string = reason attribute value (may be empty) */
  doNotChange?: string;
  /** Authorship: "human", "ai.claude", "ai.copilot", "ai.codex", etc. */
  source?: string;
  /** Cross-references: file paths, requirement IDs, or both. */
  seeAlso: string[];
  startLine: number;
  endLine: number;
}

export interface GuardRegion {
  blockId: string;
  /** Line index of pvnc.guard_start */
  startLine: number;
  /** Line index of pvnc.guard_end — undefined if malformed (missing end) */
  endLine: number | undefined;
  /** True when end is missing or when a nested guard is detected */
  isMalformed: boolean;
  /**
   * True when this region represents an orphaned guard_end (end marker with no
   * matching start). startLine holds the orphaned end's line for decoration.
   */
  isOrphanedEnd?: boolean;
  /** Annotation whose block ends on the line immediately before startLine */
  associatedAnnotation?: AiContextAnnotation;
}

export interface AiContextAnnotation {
  /** Consecutive <pvnc> blocks that form one logical annotation. */
  blocks: AiContextBlock[];
  /** Line range covering all blocks in this annotation. */
  annotationStartLine: number;
  annotationEndLine: number;
  /** First line of the code guarded by this annotation. */
  guardedStartLine: number;
  /** Conservative last line of guarded code (capped at next annotation or +30). */
  guardedEndLine: number;
  /** True if any block carries a <do-not-change> tag. */
  hasDoNotChange: boolean;
}
