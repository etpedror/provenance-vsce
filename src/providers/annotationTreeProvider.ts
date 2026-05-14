import * as vscode from 'vscode';
import * as path from 'path';
import { parseDocument } from '../parser';
import { AiContextAnnotation, AiContextBlock, TextDocumentLike } from '../types';
import { RawTextDocument } from '../rawTextDocument';
import {
  DocumentMetrics,
  WorkspaceMetrics,
  aggregateWorkspaceMetrics,
  computeDocumentMetrics,
} from '../metrics';

// ---------- tree node types ----------

type SectionKind = 'metrics' | 'annotations';

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

type TreeNode = SectionNode | FileNode | BlockNode | MetricsNode;

interface BlockRef {
  annotation: AiContextAnnotation;
  block: AiContextBlock;
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

export class AnnotationTreeProvider implements vscode.TreeDataProvider<TreeNode>, vscode.FileDecorationProvider {
  private readonly _onChange = new vscode.EventEmitter<TreeNode | undefined>();
  readonly onDidChangeTreeData = this._onChange.event;
  private readonly _onDidChangeFileDecorations = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
  readonly onDidChangeFileDecorations = this._onDidChangeFileDecorations.event;

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
    const metrics = computeDocumentMetrics(document, annotations);
    const blocks = annotations.flatMap(annotation =>
      annotation.blocks.map(block => ({ annotation, block })),
    );

    this.indexed.set(document.uri.toString(), {
      uri: document.uri,
      annotations,
      blocks,
      metrics,
    });
    this.updateMessage();
    this._onDidChangeFileDecorations.fire(document.uri);
  }

  removeDocument(uri: vscode.Uri): void {
    this.indexed.delete(uri.toString());
    this.updateMessage();
    this._onDidChangeFileDecorations.fire(uri);
    this.refresh();
  }

  refreshDecorations(): void {
    this._onDidChangeFileDecorations.fire(undefined);
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    const enabled = vscode.workspace
      .getConfiguration('provenance')
      .get<boolean>('explorerFileBadges', false);

    if (!enabled) return undefined;

    const entry = this.indexed.get(uri.toString());
    if (!entry?.metrics.hasProvenance) return undefined;

    return explorerDecoration(entry.metrics);
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
      return node.section === 'metrics'
        ? this.buildMetricNodes()
        : this.buildFileNodes();
    }

    if (node instanceof FileNode) {
      return node.blocks.map(ref => new BlockNode(node.uri, ref.annotation, ref.block));
    }
    if (node instanceof MetricsNode) {
      return [];
    }

    return [
      this.buildMetricsSection(),
      this.buildAnnotationsSection(),
    ];
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
    ];
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
    this._onDidChangeFileDecorations.dispose();
  }
}

interface IndexedDocument {
  uri: vscode.Uri;
  annotations: AiContextAnnotation[];
  blocks: BlockRef[];
  metrics: DocumentMetrics;
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

function explorerDecoration(metrics: DocumentMetrics): vscode.FileDecoration | undefined {
  if (metrics.hasAi && metrics.hasHuman) {
    return new vscode.FileDecoration(
      '◆',
      'Provenance: mixed AI and human-authored content',
      new vscode.ThemeColor('provenance.explorerMixedForeground'),
    );
  }

  if (metrics.hasAi) {
    return new vscode.FileDecoration(
      '▲',
      'Provenance: AI-authored content',
      new vscode.ThemeColor('provenance.explorerAiForeground'),
    );
  }

  if (metrics.hasHuman) {
    return new vscode.FileDecoration(
      '■',
      'Provenance: human-authored content',
      new vscode.ThemeColor('provenance.explorerHumanForeground'),
    );
  }

  return undefined;
}
