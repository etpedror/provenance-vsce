import * as vscode from 'vscode';
import { parseDocument } from './parser';
import { AiContextAnnotation, AiContextBlock, TextDocumentLike } from './types';

export type SourceCategory = 'ai' | 'human' | 'unknown';

export interface DocumentMetrics {
  uri: vscode.Uri;
  lineCount: number;
  codeLineCount: number;
  annotatedLineCount: number;
  aiLineCount: number;
  humanLineCount: number;
  unknownLineCount: number;
  annotationCount: number;
  blockCount: number;
  aiBlockCount: number;
  humanBlockCount: number;
  unknownBlockCount: number;
  doNotChangeCount: number;
  missingRequirementCount: number;
  missingReasonCount: number;
  hasProvenance: boolean;
  hasAi: boolean;
  hasHuman: boolean;
  hasUnknown: boolean;
}

export interface WorkspaceMetrics {
  scannedFileCount: number;
  provenanceFileCount: number;
  aiFileCount: number;
  humanFileCount: number;
  mixedFileCount: number;
  unknownFileCount: number;
  totalCodeLineCount: number;
  annotatedLineCount: number;
  aiLineCount: number;
  humanLineCount: number;
  unknownLineCount: number;
  annotationCount: number;
  blockCount: number;
  doNotChangeCount: number;
  missingRequirementCount: number;
  missingReasonCount: number;
}

export function getBlockCategory(block: AiContextBlock): SourceCategory {
  const source = block.source;
  if (!source) return 'unknown';
  if (source.startsWith('ai.')) return 'ai';
  if (source === 'human') return 'human';
  return 'unknown';
}

export function getAnnotationCategory(annotation: AiContextAnnotation): SourceCategory {
  const sourced = [...annotation.blocks].reverse().find(block => block.source);
  return sourced ? getBlockCategory(sourced) : 'unknown';
}

export function computeDocumentMetrics(
  document: TextDocumentLike,
  annotations = parseDocument(document),
): DocumentMetrics {
  const lineCategories = new Map<number, SourceCategory>();
  let aiBlockCount = 0;
  let humanBlockCount = 0;
  let unknownBlockCount = 0;
  let doNotChangeCount = 0;
  let missingRequirementCount = 0;
  let missingReasonCount = 0;

  for (const annotation of annotations) {
    const category = getAnnotationCategory(annotation);
    for (let line = annotation.guardedStartLine; line <= annotation.guardedEndLine; line++) {
      lineCategories.set(line, category);
    }

    for (const block of annotation.blocks) {
      switch (getBlockCategory(block)) {
        case 'ai':
          aiBlockCount++;
          break;
        case 'human':
          humanBlockCount++;
          break;
        case 'unknown':
          unknownBlockCount++;
          break;
      }
      if (block.doNotChange !== undefined) doNotChangeCount++;
      if (block.requirements.length === 0) missingRequirementCount++;
      if (block.reasons.length === 0) missingReasonCount++;
    }
  }

  let codeLineCount = 0;
  let annotatedLineCount = 0;
  let aiLineCount = 0;
  let humanLineCount = 0;
  let unknownLineCount = 0;

  for (let line = 0; line < document.lineCount; line++) {
    if (!isCountableCodeLine(document.lineAt(line).text)) continue;

    codeLineCount++;
    const category = lineCategories.get(line);
    if (!category) continue;

    annotatedLineCount++;
    switch (category) {
      case 'ai':
        aiLineCount++;
        break;
      case 'human':
        humanLineCount++;
        break;
      case 'unknown':
        unknownLineCount++;
        break;
    }
  }

  const blockCount = annotations.reduce((sum, annotation) => sum + annotation.blocks.length, 0);

  return {
    uri: document.uri,
    lineCount: document.lineCount,
    codeLineCount,
    annotatedLineCount,
    aiLineCount,
    humanLineCount,
    unknownLineCount,
    annotationCount: annotations.length,
    blockCount,
    aiBlockCount,
    humanBlockCount,
    unknownBlockCount,
    doNotChangeCount,
    missingRequirementCount,
    missingReasonCount,
    hasProvenance: annotations.length > 0,
    hasAi: aiBlockCount > 0,
    hasHuman: humanBlockCount > 0,
    hasUnknown: unknownBlockCount > 0,
  };
}

export function emptyWorkspaceMetrics(): WorkspaceMetrics {
  return {
    scannedFileCount: 0,
    provenanceFileCount: 0,
    aiFileCount: 0,
    humanFileCount: 0,
    mixedFileCount: 0,
    unknownFileCount: 0,
    totalCodeLineCount: 0,
    annotatedLineCount: 0,
    aiLineCount: 0,
    humanLineCount: 0,
    unknownLineCount: 0,
    annotationCount: 0,
    blockCount: 0,
    doNotChangeCount: 0,
    missingRequirementCount: 0,
    missingReasonCount: 0,
  };
}

export function aggregateWorkspaceMetrics(documents: Iterable<DocumentMetrics>): WorkspaceMetrics {
  const total = emptyWorkspaceMetrics();

  for (const doc of documents) {
    total.scannedFileCount++;
    if (doc.hasProvenance) total.provenanceFileCount++;
    if (doc.hasAi) total.aiFileCount++;
    if (doc.hasHuman) total.humanFileCount++;
    if (doc.hasUnknown) total.unknownFileCount++;
    if (doc.hasAi && doc.hasHuman) total.mixedFileCount++;

    total.totalCodeLineCount += doc.codeLineCount;
    total.annotatedLineCount += doc.annotatedLineCount;
    total.aiLineCount += doc.aiLineCount;
    total.humanLineCount += doc.humanLineCount;
    total.unknownLineCount += doc.unknownLineCount;
    total.annotationCount += doc.annotationCount;
    total.blockCount += doc.blockCount;
    total.doNotChangeCount += doc.doNotChangeCount;
    total.missingRequirementCount += doc.missingRequirementCount;
    total.missingReasonCount += doc.missingReasonCount;
  }

  return total;
}

function isCountableCodeLine(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (/^<\/?(?:pvnc|provenance)>$/.test(trimmed)) return false;
  if (/^(?:[#*]|\/\/)\s*pvnc\.[\w-]+:/.test(trimmed)) return false;
  if (/^(?:[#*]|\/\/)?\s*(requirement|reason|invariant|do-not-change|source|see-also):/.test(trimmed)) return false;
  return true;
}
