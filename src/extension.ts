import * as vscode from 'vscode';
import { AiContextHoverProvider } from './providers/hoverProvider';
import { GutterProvider } from './providers/gutterProvider';
import { DoNotChangeWatcher } from './providers/doNotChangeWatcher';
import { AiContextCompletionProvider, TRIGGER_CHARACTERS } from './providers/completionProvider';
import { AnnotationTreeProvider } from './providers/annotationTreeProvider';
import { addAnnotation } from './commands/addAnnotation';
import { setupInstructions } from './commands/setupInstructions';
import { invalidateCache } from './parser';

export function activate(context: vscode.ExtensionContext): void {
  // Hover provider — language-agnostic (pattern matches all files).
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(
      { scheme: 'file', pattern: '**/*' },
      new AiContextHoverProvider(),
    ),
  );

  // Completion provider — suggests allowed keys inside <pvnc> blocks.
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      { scheme: 'file', pattern: '**/*' },
      new AiContextCompletionProvider(),
      ...TRIGGER_CHARACTERS,
    ),
  );

  // Gutter icons alongside every annotated line.
  context.subscriptions.push(new GutterProvider(context));

  // Warning when editing code guarded by <do-not-change>.
  context.subscriptions.push(new DoNotChangeWatcher());

  // Sidebar annotations panel.
  const treeProvider = new AnnotationTreeProvider();
  const treeView = vscode.window.createTreeView('provenance.annotationsView', {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });
  treeProvider.setTreeView(treeView);
  context.subscriptions.push(
    treeView,
    vscode.window.registerFileDecorationProvider(treeProvider),
    { dispose: () => treeProvider.dispose() },
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('provenance.refreshAnnotations', () =>
      treeProvider.refresh(),
    ),
    vscode.commands.registerCommand('provenance.analyzeWorkspace', () =>
      treeProvider.analyzeWorkspace(),
    ),
    vscode.commands.registerCommand('provenance.filterAnnotations', async () => {
      const query = await vscode.window.showInputBox({
        prompt: 'Filter annotations',
        placeHolder: 'requirement ID, system, reason text…',
        value: '',
      });
      if (query !== undefined) treeProvider.setFilter(query);
    }),
    vscode.commands.registerCommand('provenance.clearFilter', () =>
      treeProvider.clearFilter(),
    ),
  );

  // Refresh the panel when files change.
  /*
   * <pvnc>
   *     requirement: UNKNOWN
   *     reason: Debounce tree refresh on keystrokes — indexDocument is cheap (cached parse) but _onChange.fire triggers a full tree re-render on every keystroke without this
   *     source: ai.claude
   * </pvnc>
   */
  let changeRefreshTimer: ReturnType<typeof setTimeout> | undefined;
  context.subscriptions.push(
    { dispose: () => clearTimeout(changeRefreshTimer) },
    vscode.workspace.onDidOpenTextDocument(doc => {
      treeProvider.indexDocument(doc);
      treeProvider.refresh();
    }),
    vscode.workspace.onDidChangeTextDocument(e => {
      treeProvider.indexDocument(e.document);
      clearTimeout(changeRefreshTimer);
      changeRefreshTimer = setTimeout(() => treeProvider.refresh(), 300);
    }),
    vscode.workspace.onDidSaveTextDocument(doc => {
      treeProvider.indexDocument(doc);
      treeProvider.refresh();
    }),
    vscode.workspace.onDidCreateFiles(() => treeProvider.refresh()),
    vscode.workspace.onDidDeleteFiles(e => {
      e.files.forEach(uri => {
        invalidateCache(uri);
        treeProvider.removeDocument(uri);
      });
      treeProvider.refresh();
    }),
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('provenance.explorerFileBadges')) {
        treeProvider.refreshDecorations();
      }
    }),
  );

  // Scaffold command: Provenance: Add annotation
  context.subscriptions.push(
    vscode.commands.registerCommand('provenance.addAnnotation', addAnnotation),
  );

  // Setup command: write AI assistant instruction files for all agents
  context.subscriptions.push(
    vscode.commands.registerCommand('provenance.setupInstructions', setupInstructions),
  );

  // Keep the parse cache coherent when a file is closed or deleted.
  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument(doc => invalidateCache(doc.uri)),
  );
}

export function deactivate(): void {
  // VS Code disposes subscriptions automatically.
}
