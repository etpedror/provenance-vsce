import * as vscode from 'vscode';
import * as path from 'path';
import { parseDocument } from '../parser';
import { parseGuards } from '../guardParser';
import { AiContextAnnotation, AiContextBlock, GuardRegion, TextDocumentLike } from '../types';
import { RawTextDocument } from '../rawTextDocument';
import {
  DocumentMetrics,
  WorkspaceMetrics,
  aggregateWorkspaceMetrics,
  computeDocumentMetrics,
} from '../metrics';
import { getStore } from '../contributions/store';

// ---------- tree node types ----------

type SectionKind = 'metrics' | 'annotations' | 'guards' | 'contributions';

export class SectionNode extends vscode.TreeItem {
  readonly kind = 'section';

  constructor(
    readonly section: SectionKind,
    label: string,
    description: string,
    icon: string,
  ) {
    super(label, vscode.TreeItemCollapsibleState.Expanded);
    this.description = description;
    this.iconPath = new vscode.ThemeIcon(icon);
    this.contextValue = `provenanceSection.${section}`;
  }
}

export class FileNode extends vscode.TreeItem {
  readonly kind = 'file';

  constructor(
    readonly uri: vscode.Uri,
    readonly blocks: BlockRef[],
    readonly metrics: DocumentMetrics,
  ) {
    super(path.basename(uri.fsPath), vscode.TreeItemCollapsibleState.Expanded);
    this.resourceUri = uri;
    this.description = path.relative(
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '',
      path.dirname(uri.fsPath),
    );
    this.tooltip = uri.fsPath;
    this.iconPath = fileIcon(metrics);
    this.contextValue = 'provenanceFile';
  }
}

export class MetricsNode extends vscode.TreeItem {
  readonly kind = 'metrics';

  constructor(label: string, description?: string, icon = 'graph') {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = description;
    this.iconPath = new vscode.ThemeIcon(icon);
    this.contextValue = 'provenanceMetrics';
  }
}

export class BlockNode extends vscode.TreeItem {
  readonly kind = 'block';

  constructor(
    readonly uri: vscode.Uri,
    readonly annotation: AiContextAnnotation,
    readonly block: AiContextBlock,
  ) {
    const reqId = block.requirements.map(r => r.id).join(', ') || '(no requirement)';
    const preview = block.reasons[0] ?? block.invariants[0] ?? block.doNotChange ?? '';

    super(reqId, vscode.TreeItemCollapsibleState.None);
    this.description = preview;
    this.tooltip = buildTooltip(block);
    this.contextValue = block.doNotChange !== undefined ? 'provenanceDoNotChange' : 'provenanceBlock';

    this.iconPath =
      block.doNotChange !== undefined
        ? new vscode.ThemeIcon('warning', new vscode.ThemeColor('editorWarning.foreground'))
        : block.requirements[0]?.system
          ? new vscode.ThemeIcon('tag')
          : new vscode.ThemeIcon('circle-small');

    this.command = {
      command: 'vscode.open',
      title: 'Go to annotation',
      arguments: [
        uri,
        {
          selection: new vscode.Range(
            annotation.annotationStartLine, 0,
            annotation.annotationStartLine, 0,
          ),
          preserveFocus: false,
        } satisfies vscode.TextDocumentShowOptions,
      ],
    };
  }
}

export class GuardNode extends vscode.TreeItem {
  readonly kind = 'guard';

  constructor(
    readonly uri: vscode.Uri,
    readonly region: GuardRegion,
  ) {
    const label = region.blockId;
    super(label, vscode.TreeItemCollapsibleState.None);

    const file = path.basename(uri.fsPath);
    const endDesc = region.endLine !== undefined ? `–${region.endLine + 1}` : '–?';
    this.description = `${file}:${region.startLine + 1}${endDesc}`;
    this.tooltip = buildGuardTooltip(region);

    this.iconPath = region.isMalformed
      ? new vscode.ThemeIcon('warning', new vscode.ThemeColor('editorWarning.foreground'))
      : new vscode.ThemeIcon('shield');

    this.contextValue = region.isMalformed ? 'provenanceGuardMalformed' : 'provenanceGuard';

    this.command = {
      command: 'vscode.open',
      title: 'Go to guard',
      arguments: [
        uri,
        {
          selection: new vscode.Range(region.startLine, 0, region.startLine, 0),
          preserveFocus: false,
        } satisfies vscode.TextDocumentShowOptions,
      ],
    };
  }
}

export class ContributionSourceNode extends vscode.TreeItem {
  readonly kind = 'contributionSource';

  constructor(
    readonly source: string,
    events: number,
    lines: number,
  ) {
    super(source, vscode.TreeItemCollapsibleState.Collapsed);
    this.description = `${events} event${events !== 1 ? 's' : ''} · ${lines} lines`;
    this.iconPath = new vscode.ThemeIcon(source.startsWith('ai.') ? 'chip' : 'shield');
    this.contextValue = 'provenanceContributionSource';
  }
}

export class ContributionFileNode extends vscode.TreeItem {
  readonly kind = 'contributionFile';

  constructor(
    readonly file: string,
    events: number,
    lines: number,
    workspaceRoot: string,
  ) {
    super(path.basename(file), vscode.TreeItemCollapsibleState.None);
    this.description = `${events} event${events !== 1 ? 's' : ''} · ${lines} lines`;
    this.tooltip = file;
    this.iconPath = vscode.ThemeIcon.File;
    this.contextValue = 'provenanceContributionFile';

    const absPath = path.join(workspaceRoot, file);
    this.command = {
      command: 'vscode.open',
      title: 'Open file',
      arguments: [vscode.Uri.file(absPath)],
    };
  }
}

type TreeNode = SectionNode | FileNode | BlockNode | MetricsNode | GuardNode | ContributionSourceNode | ContributionFileNode;

interface BlockRef {
  annotation: AiContextAnnotation;
  block: AiContextBlock;
}

function buildGuardTooltip(region: GuardRegion): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.appendMarkdown(`**Guard:** \`${region.blockId}\`\n\n`);
  if (region.isMalformed) {
    md.appendMarkdown(`⚠ Malformed — missing \`pvnc.guard_end\`\n\n`);
  }
  if (region.associatedAnnotation) {
    const reqs = region.associatedAnnotation.blocks.flatMap(b => b.requirements);
    if (reqs.length > 0) {
      md.appendMarkdown(`**Requirement:** ${reqs.map(r => `\`${r.id}\``).join(', ')}\n\n`);
    }
  }
  return md;
}

function buildTooltip(block: AiContextBlock): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  for (const req of block.requirements) {
    const parts = [`\`${req.id}\``];
    if (req.system) parts.push(`*(${req.system})*`);
    if (req.date) parts.push(`— ${req.date}`);
    md.appendMarkdown(`**Requirement:** ${parts.join(' ')}\n\n`);
  }
  for (const r of block.reasons)    md.appendMarkdown(`**Reason:** ${r}\n\n`);
  for (const i of block.invariants) md.appendMarkdown(`**Invariant:** ${i}\n\n`);
  if (block.doNotChange !== undefined) {
    md.appendMarkdown(`**Do not change:** ${block.doNotChange || 'no reason given'}\n\n`);
  }
  return md;
}

function fileIcon(metrics: DocumentMetrics): vscode.ThemeIcon {
  if (metrics.hasAi && metrics.hasHuman) return new vscode.ThemeIcon('symbol-misc');
  if (metrics.hasAi) return new vscode.ThemeIcon('chip');
  if (metrics.hasHuman) return new vscode.ThemeIcon('person');
  if (metrics.hasUnknown) return new vscode.ThemeIcon('shield');
  return vscode.ThemeIcon.File;
}

// ---------- provider ----------

export class AnnotationTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly _onChange = new vscode.EventEmitter<TreeNode | undefined>();
  readonly onDidChangeTreeData = this._onChange.event;

  private filter = '';
  private treeView: vscode.TreeView<TreeNode> | undefined;
  private readonly indexed = new Map<string, IndexedDocument>();
  private workspaceWasAnalyzed = false;

  constructor() {
    vscode.workspace.textDocuments.forEach(doc => this.indexDocument(doc));
  }

  setTreeView(view: vscode.TreeView<TreeNode>): void {
    this.treeView = view;
    this.updateMessage();
  }

  refresh(): void {
    this._onChange.fire(undefined);
  }

  indexDocument(document: TextDocumentLike): void {
    if (document.uri.scheme !== 'file') return;

    const annotations = parseDocument(document);
    const guards = parseGuards(document, annotations);
    const metrics = computeDocumentMetrics(document, annotations, guards);
    const blocks = annotations.flatMap(annotation =>
      annotation.blocks.map(block => ({ annotation, block })),
    );

    this.indexed.set(document.uri.toString(), {
      uri: document.uri,
      annotations,
      blocks,
      metrics,
      guards,
    });
    this.updateMessage();
  }

  removeDocument(uri: vscode.Uri): void {
    this.indexed.delete(uri.toString());
    this.updateMessage();
    this.refresh();
  }

  async analyzeWorkspace(): Promise<void> {
    const uris = await vscode.workspace.findFiles(
      sourceIncludeGlob(),
      sourceExcludeGlob(),
    );

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Analyzing provenance',
        cancellable: false,
      },
      /*
       * <pvnc>
       *     requirement: UNKNOWN
       *     reason: Avoid loading workspace files into VS Code editor buffers — use fs.readFile so memory usage stays constant regardless of workspace size
       *     source: ai.claude
       * </pvnc>
       */
      async progress => {
        progress.report({ message: `Scanning ${uris.length} files` });

        const openByUri = new Map(
          vscode.workspace.textDocuments.map(d => [d.uri.toString(), d]),
        );

        let completed = 0;
        for (const uri of uris) {
          try {
            const doc: TextDocumentLike =
              openByUri.get(uri.toString()) ??
              new RawTextDocument(uri, await vscode.workspace.fs.readFile(uri));
            this.indexDocument(doc);
          } catch {
            // Ignore unreadable files; the source glob already avoids common binaries.
          }

          completed++;
          if (completed % 50 === 0 || completed === uris.length) {
            progress.report({ message: `${completed}/${uris.length} files` });
          }
        }
      },
    );

    this.workspaceWasAnalyzed = true;
    this.updateMessage();
    this.refresh();

    const metrics = this.workspaceMetrics();
    vscode.window.showInformationMessage(
      `Provenance: analyzed ${metrics.scannedFileCount} files; ${metrics.provenanceFileCount} have provenance, ${metrics.aiFileCount} include AI-authored content.`,
    );
  }

  setFilter(query: string): void {
    this.filter = query.toLowerCase().trim();
    this.refresh();
    this.updateMessage();
  }

  clearFilter(): void {
    this.setFilter('');
  }

  getTreeItem(node: TreeNode): vscode.TreeItem {
    return node;
  }

  async getChildren(node?: TreeNode): Promise<TreeNode[]> {
    if (node instanceof SectionNode) {
      if (node.section === 'metrics')       return this.buildMetricNodes();
      if (node.section === 'guards')        return this.buildGuardNodes();
      if (node.section === 'contributions') return this.buildContributionSourceNodes();
      return this.buildFileNodes();
    }

    if (node instanceof FileNode) {
      return node.blocks.map(ref => new BlockNode(node.uri, ref.annotation, ref.block));
    }
    if (node instanceof ContributionSourceNode) {
      return this.buildContributionFileNodes(node.source);
    }
    if (node instanceof MetricsNode || node instanceof GuardNode || node instanceof ContributionFileNode) {
      return [];
    }

    const sections: TreeNode[] = [
      this.buildMetricsSection(),
      this.buildAnnotationsSection(),
    ];

    const guardSection = this.buildGuardsSection();
    if (guardSection) sections.push(guardSection);

    const contribSection = this.buildContributionsSection();
    if (contribSection) sections.push(contribSection);

    return sections;
  }

  private buildMetricsSection(): SectionNode {
    const metrics = this.workspaceMetrics();
    const scope = this.workspaceWasAnalyzed ? 'workspace scan' : 'opened files only';
    return new SectionNode('metrics', 'Metrics', `${metrics.scannedFileCount} files, ${scope}`, 'graph');
  }

  private buildAnnotationsSection(): SectionNode {
    const metrics = this.workspaceMetrics();
    return new SectionNode(
      'annotations',
      'Annotations',
      `${metrics.provenanceFileCount} files, ${metrics.annotationCount} annotations`,
      'list-tree',
    );
  }

  private buildGuardsSection(): SectionNode | undefined {
    const metrics = this.workspaceMetrics();
    if (metrics.guardCount === 0) return undefined;
    const malformedNote = metrics.malformedGuardCount > 0 ? `, ${metrics.malformedGuardCount} malformed` : '';
    return new SectionNode(
      'guards',
      'Guards',
      `${metrics.guardCount} regions${malformedNote}`,
      'shield',
    );
  }

  private buildGuardNodes(): GuardNode[] {
    const nodes: GuardNode[] = [];
    for (const entry of this.indexed.values()) {
      for (const region of entry.guards) {
        nodes.push(new GuardNode(entry.uri, region));
      }
    }
    return nodes.sort((a, b) => {
      const fc = a.uri.fsPath.localeCompare(b.uri.fsPath);
      return fc !== 0 ? fc : a.region.startLine - b.region.startLine;
    });
  }

  private buildMetricNodes(): MetricsNode[] {
    const metrics = this.workspaceMetrics();
    const scope = this.workspaceWasAnalyzed ? 'workspace scan' : 'opened files only';

    return [
      new MetricsNode(`Indexed ${metrics.scannedFileCount} files`, scope, this.workspaceWasAnalyzed ? 'database' : 'eye'),
      new MetricsNode(
        `Provenance files: ${formatCount(metrics.provenanceFileCount, metrics.scannedFileCount)}`,
        `${metrics.annotationCount} annotations, ${metrics.blockCount} blocks`,
        'symbol-key',
      ),
      new MetricsNode(
        `AI files: ${formatCount(metrics.aiFileCount, metrics.scannedFileCount)}`,
        `${formatCount(metrics.aiLineCount, metrics.totalCodeLineCount)} estimated code lines`,
        'chip',
      ),
      new MetricsNode(
        `Human files: ${formatCount(metrics.humanFileCount, metrics.scannedFileCount)}`,
        `${formatCount(metrics.humanLineCount, metrics.totalCodeLineCount)} estimated code lines`,
        'person',
      ),
      new MetricsNode(
        `Unknown source: ${formatCount(metrics.unknownFileCount, metrics.scannedFileCount)}`,
        `${metrics.missingRequirementCount} missing requirements, ${metrics.missingReasonCount} missing reasons`,
        'shield',
      ),
      new MetricsNode(
        `Do-not-change blocks: ${metrics.doNotChangeCount}`,
        `${formatCount(metrics.annotatedLineCount, metrics.totalCodeLineCount)} lines under provenance`,
        'warning',
      ),
      new MetricsNode(
        `Guard regions: ${metrics.guardCount}`,
        metrics.guardCount > 0
          ? `${metrics.documentedGuardCount} documented, ${metrics.malformedGuardCount} malformed`
          : 'no Code Guard regions found',
        'shield',
      ),
    ];
  }

  private buildContributionsSection(): SectionNode | undefined {
    const store = getStore();
    if (!store) return undefined;

    const { bySource } = store.getSummary();
    const totalEvents = Object.values(bySource).reduce((s, v) => s + v.events, 0);
    if (totalEvents === 0) return undefined;

    const aiSources = Object.keys(bySource).filter(s => s.startsWith('ai.'));
    const totalLines = Object.values(bySource).reduce((s, v) => s + v.lines, 0);
    const desc = aiSources.length > 0
      ? `${aiSources.length} AI source${aiSources.length !== 1 ? 's' : ''} · ${totalLines} lines`
      : `${totalEvents} events`;

    return new SectionNode('contributions', 'Contributions', desc, 'chip');
  }

  private buildContributionSourceNodes(): ContributionSourceNode[] {
    const store = getStore();
    if (!store) return [];

    const { bySource } = store.getSummary();
    return Object.entries(bySource)
      .sort(([, a], [, b]) => b.lines - a.lines)
      .map(([source, { events, lines }]) => new ContributionSourceNode(source, events, lines));
  }

  private buildContributionFileNodes(source: string): ContributionFileNode[] {
    const store = getStore();
    if (!store) return [];

    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
    const events = store.getBySource(source);

    const byFile = new Map<string, { events: number; lines: number }>();
    for (const e of events) {
      const cur = byFile.get(e.file) ?? { events: 0, lines: 0 };
      byFile.set(e.file, { events: cur.events + 1, lines: cur.lines + (e.lines_delta ?? 0) });
    }

    return [...byFile.entries()]
      .sort(([, a], [, b]) => b.lines - a.lines)
      .map(([file, { events, lines }]) => new ContributionFileNode(file, events, lines, root));
  }

  private buildFileNodes(): FileNode[] {
    const fileNodes: FileNode[] = [];

    for (const entry of this.indexed.values()) {
      if (!entry.blocks.length) continue;

      const matched = this.filter ? entry.blocks.filter(ref => this.matches(ref.block)) : entry.blocks;
      if (!matched.length) continue;

      fileNodes.push(new FileNode(entry.uri, matched, entry.metrics));
    }

    return fileNodes.sort((a, b) => a.uri.fsPath.localeCompare(b.uri.fsPath));
  }

  private matches(block: AiContextBlock): boolean {
    const q = this.filter;
    return (
      block.requirements.some(r =>
        r.id.toLowerCase().includes(q) ||
        (r.system?.toLowerCase().includes(q) ?? false) ||
        (r.date?.toLowerCase().includes(q) ?? false),
      ) ||
      block.reasons.some(r => r.toLowerCase().includes(q)) ||
      block.invariants.some(i => i.toLowerCase().includes(q)) ||
      (block.doNotChange?.toLowerCase().includes(q) ?? false) ||
      (block.source?.toLowerCase().includes(q) ?? false) ||
      block.seeAlso.some(ref => ref.toLowerCase().includes(q))
    );
  }

  private workspaceMetrics(): WorkspaceMetrics {
    return aggregateWorkspaceMetrics([...this.indexed.values()].map(entry => entry.metrics));
  }

  private updateMessage(): void {
    if (!this.treeView) return;
    if (this.filter) {
      this.treeView.message = `Filter: ${this.filter}`;
      return;
    }

    const metrics = this.workspaceMetrics();
    this.treeView.message = this.workspaceWasAnalyzed
      ? `Workspace analyzed: ${metrics.scannedFileCount} files`
      : `Lazy index: ${metrics.scannedFileCount} opened files. Run Analyze Workspace for full metrics.`;
  }

  dispose(): void {
    this._onChange.dispose();
  }
}

interface IndexedDocument {
  uri: vscode.Uri;
  annotations: AiContextAnnotation[];
  blocks: BlockRef[];
  metrics: DocumentMetrics;
  guards: GuardRegion[];
}

function sourceIncludeGlob(): string {
  return '**/*.{js,jsx,ts,tsx,mjs,cjs,py,rb,go,rs,java,cs,c,cc,cpp,h,hpp,kt,kts,swift,php,sh,bash,zsh,fish,yml,yaml,json,jsonc,toml,xml,html,css,scss,less,md,mdx}';
}

function sourceExcludeGlob(): string {
  return '{**/node_modules/**,**/.git/**,**/out/**,**/dist/**,**/build/**,**/coverage/**,**/.next/**,**/.cache/**,**/vendor/**,**/*.vsix,**/package-lock.json,**/yarn.lock,**/pnpm-lock.yaml}';
}

function formatCount(value: number, total: number): string {
  if (total <= 0) return `${value} / 0 (0%)`;
  return `${value} / ${total} (${Math.round((value / total) * 100)}%)`;
}

