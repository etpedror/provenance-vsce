import * as vscode from 'vscode';
import { parseDocument } from '../parser';
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
  md.supportHtml = false;
  md.isTrusted = true;

  const count = ann.blocks.length;
  md.appendMarkdown(count > 1 ? `**ai-context** — ${count} entries\n\n` : `**ai-context**\n\n`);
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
    md.appendMarkdown(`**⚠ Do not change:** ${label}\n\n`);
  }

  if (block.source) {
    const icon = block.source.startsWith('ai.') ? '🤖' : '👤';
    md.appendMarkdown(`**Authored by:** ${icon} \`${block.source}\`\n\n`);
  }

  if (block.seeAlso.length > 0) {
    md.appendMarkdown(`**See also:** ${block.seeAlso.map(r => `\`${r}\``).join(', ')}\n\n`);
  }
}
