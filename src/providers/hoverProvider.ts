import * as vscode from 'vscode';
import { parseDocument } from '../parser';
import { findGuardMarkerAtLine, parseGuards } from '../guardParser';
import { AiContextAnnotation, AiContextBlock } from '../types';
import { PvncConfig } from '../pvncConfig';
import { fetchTicket } from '../ticketFetcher';

/**
 * <pvnc>
 *     requirement: UNKNOWN
 *     reason: Restrict hover tooltip to the annotation comment lines only — showing it over guarded code was intrusive and unhelpful
 *     source: ai.claude
 * </pvnc>
 */
export class AiContextHoverProvider implements vscode.HoverProvider {
  constructor(private readonly config: PvncConfig) {}

  /**
   * <pvnc>
   *     requirement: UNKNOWN
   *     reason: Enrich requirement lines with live ticket title and state fetched from the configured ticket system
   *     source: ai.claude
   * </pvnc>
   */
  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.Hover | undefined> {
    const annotations = parseDocument(document);

    // Guard marker hover takes precedence over annotation hover.
    if (vscode.workspace.getConfiguration('provenance.codeGuard').get<boolean>('enabled', true)) {
      const regions = parseGuards(document, annotations);
      const guardAtLine = findGuardMarkerAtLine(position.line, regions);
      if (guardAtLine) {
        return buildGuardHover(guardAtLine);
      }
    }

    for (const ann of annotations) {
      if (
        position.line >= ann.annotationStartLine &&
        position.line <= ann.annotationEndLine
      ) {
        return buildHover(ann, this.config);
      }
    }

    return undefined;
  }
}

async function buildHover(ann: AiContextAnnotation, config: PvncConfig): Promise<vscode.Hover> {
  const md = new vscode.MarkdownString('', true);
  md.supportHtml = true;
  md.isTrusted = true;

  const count = ann.blocks.length;
  md.appendMarkdown(count > 1 ? `**provenance** — ${count} entries\n\n` : `**provenance**\n\n`);
  md.appendMarkdown('---\n\n');

  for (let i = 0; i < ann.blocks.length; i++) {
    if (count > 1) md.appendMarkdown(`**Entry ${i + 1} of ${count}**\n\n`);
    await appendBlock(md, ann.blocks[i], config);
    if (i < ann.blocks.length - 1) md.appendMarkdown('---\n\n');
  }

  return new vscode.Hover(md);
}

async function appendBlock(md: vscode.MarkdownString, block: AiContextBlock, config: PvncConfig): Promise<void> {
  for (const req of block.requirements) {
    const parts: string[] = [req.id];
    if (req.system) parts.push(`*(${req.system})*`);
    if (req.date) parts.push(`— ${req.date}`);

    const ticket = await fetchTicket(req.id, req.system, config);
    if (ticket) {
      const badge = ticket.state === 'open' ? '🟢' : '🔴';
      parts.push(`— [${ticket.title}](${ticket.url}) ${badge}`);
    }

    md.appendMarkdown(`**Requirement:** ${parts.join(' ')}\n\n`);
  }

  for (const reason of block.reasons) {
    md.appendMarkdown(`**Reason:** ${reason}\n\n`);
  }

  for (const inv of block.invariants) {
    md.appendMarkdown(`**Invariant:** ${inv}\n\n`);
  }

  if (block.doNotChange !== undefined) {
    const label = block.doNotChange || 'no reason given';
    md.appendMarkdown(
      `<div style="border-left: 3px solid #e74c3c; padding-left: 8px; color: #e74c3c;">\n\n` +
      `**🚫 DO NOT CHANGE** — ${label}\n\n` +
      `</div>\n\n`,
    );
  }

  if (block.source) {
    const icon = block.source.startsWith('ai.') ? '🤖' : '👤';
    md.appendMarkdown(`**Authored by:** ${icon} \`${block.source}\`\n\n`);
  }

  if (block.seeAlso.length > 0) {
    md.appendMarkdown(`**See also:** ${block.seeAlso.map(r => `\`${r}\``).join(', ')}\n\n`);
  }
}

function buildGuardHover(region: import('../types').GuardRegion): vscode.Hover {
  const md = new vscode.MarkdownString('', true);
  md.supportHtml = true;
  md.isTrusted = true;

  md.appendMarkdown(`**🛡 Code Guard** — \`${region.blockId}\`\n\n`);
  md.appendMarkdown('---\n\n');

  if (region.isMalformed) {
    const msg = region.isOrphanedEnd
      ? `**⚠ Orphaned guard_end** — no matching \`pvnc.guard_start: ${region.blockId}\` found.\n\nCheck for a typo in the block ID or the \`pvnc.guard_start:\` keyword.`
      : `**⚠ Malformed guard** — no matching \`pvnc.guard_end: ${region.blockId}\` found.\n\nCheck for a typo in the block ID or the \`pvnc.guard_end:\` keyword.`;
    md.appendMarkdown(
      `<div style="border-left: 3px solid #e74c3c; padding-left: 8px; color: #e74c3c;">\n\n` +
      `${msg}\n\n` +
      `</div>\n\n`,
    );
  } else {
    md.appendMarkdown(
      `<div style="border-left: 3px solid #E8A838; padding-left: 8px;">\n\n` +
      `This region is protected. Modifications require a preceding \`pvnc.guard_removed\` commit.\n\n` +
      `</div>\n\n`,
    );

    if (region.associatedAnnotation) {
      const blocks = region.associatedAnnotation.blocks;
      const reqs = blocks.flatMap(b => b.requirements);
      if (reqs.length > 0) {
        md.appendMarkdown(`**Linked requirement:** ${reqs.map(r => `\`${r.id}\`${r.system ? ` *(${r.system})*` : ''}`).join(', ')}\n\n`);
      }
      const reasons = blocks.flatMap(b => b.reasons);
      if (reasons.length > 0) {
        md.appendMarkdown(`**Reason:** ${reasons[0]}\n\n`);
      }
    }

    md.appendMarkdown(`Run **Provenance: Remove guard** to scaffold the removal commit message.`);
  }

  return new vscode.Hover(md);
}
