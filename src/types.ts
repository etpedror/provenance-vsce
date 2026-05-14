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
