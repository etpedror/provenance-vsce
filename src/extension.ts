import * as vscode from 'vscode';
import { AiContextHoverProvider } from './providers/hoverProvider';
import { GutterProvider } from './providers/gutterProvider';
import { DoNotChangeWatcher } from './providers/doNotChangeWatcher';
import { AiContextCompletionProvider, TRIGGER_CHARACTERS } from './providers/completionProvider';
import { AnnotationTreeProvider } from './providers/annotationTreeProvider';
import { addAnnotation } from './commands/addAnnotation';
import { resetInstructions, removeInstructions, setupInstructions } from './commands/setupInstructions';
import { setupPvncConfig } from './commands/setupPvncConfig';
import { removeGuard } from './commands/removeGuard';
import { runCodeGuardCheck } from './commands/runCodeGuardCheck';
import { logContribution, LogContributionArgs } from './commands/logContribution';
import { invalidateCache } from './parser';
import { invalidateGuardCache } from './guardParser';
import { loadPvncConfig } from './pvncConfig';
import { clearTicketCache, initTicketFetcher } from './ticketFetcher';
import { GuardGutterProvider } from './providers/guardGutterProvider';
import { GuardWatcher } from './providers/guardWatcher';
import { GuardSaveWatcher } from './providers/guardSaveWatcher';
import { initStore, getStore } from './contributions/store';
import { installGitHooks } from './contributions/gitHooks';

export function activate(context: vscode.ExtensionContext): void {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';

  // Initialise the contribution store and git hooks on every activation.
  if (workspaceRoot) {
    try {
      const store = initStore(workspaceRoot);
      context.subscriptions.push({ dispose: () => store.dispose() });
    } catch { /* non-fatal */ }
    try { installGitHooks(workspaceRoot); } catch { /* non-fatal */ }
  }

  const pvncConfig = loadPvncConfig(workspaceRoot);

  const outputChannel = vscode.window.createOutputChannel('Provenance');
  context.subscriptions.push(outputChannel);
  initTicketFetcher(outputChannel);

  // Hover provider — language-agnostic (pattern matches all files).
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(
      { scheme: 'file', pattern: '**/*' },
      new AiContextHoverProvider(pvncConfig),
    ),
  );

  // Completion provider — suggests allowed keys inside <pvnc> blocks.
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      { scheme: 'file', pattern: '**/*' },
      new AiContextCompletionProvider(pvncConfig),
      ...TRIGGER_CHARACTERS,
    ),
  );

  // Gutter icons alongside every annotated line.
  context.subscriptions.push(new GutterProvider(context));

  // Warning when editing code guarded by <do-not-change>.
  context.subscriptions.push(new DoNotChangeWatcher());

  // Code Guard: gutter shield icons + region tint + edit warning.
  context.subscriptions.push(new GuardGutterProvider(context));
  context.subscriptions.push(new GuardWatcher());
  context.subscriptions.push(new GuardSaveWatcher());

  // Sidebar annotations panel.
  const treeProvider = new AnnotationTreeProvider();
  const treeView = vscode.window.createTreeView('provenance.annotationsView', {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });
  treeProvider.setTreeView(treeView);
  context.subscriptions.push(
    treeView,
    { dispose: () => treeProvider.dispose() },
  );

  // Refresh the contributions section whenever the store picks up external changes.
  getStore()?.on('updated', () => treeProvider.refresh());

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
      if (e.affectsConfiguration('provenance')) {
        treeProvider.refresh();
      }
    }),
    vscode.workspace.onDidChangeTextDocument(e => {
      if (e.document.uri.fsPath.endsWith('.pvnc/config.json')) clearTicketCache();
    }),
  );

  // Scaffold command: Provenance: Add annotation
  context.subscriptions.push(
    vscode.commands.registerCommand('provenance.addAnnotation', () => addAnnotation(pvncConfig)),
  );

  // Setup command: write AI assistant instruction files for all agents
  context.subscriptions.push(
    vscode.commands.registerCommand('provenance.setupInstructions', setupInstructions),
  );

  // Reset command: force-refresh the inline instructions block in all agent instruction files
  context.subscriptions.push(
    vscode.commands.registerCommand('provenance.resetInstructions', resetInstructions),
  );

  // Remove command: strip the Provenance instructions block from all agent instruction files
  context.subscriptions.push(
    vscode.commands.registerCommand('provenance.removeInstructions', removeInstructions),
  );

  // Contribution logging: AI agents call this to record their activity.
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'provenance.logContribution',
      (args: LogContributionArgs) => logContribution(args),
    ),
  );

  // Setup command: create .pvnc/config.json for this workspace
  context.subscriptions.push(
    vscode.commands.registerCommand('provenance.setupPvncConfig', setupPvncConfig),
  );

  // Code Guard: scaffold pvnc.guard_removed commit message
  context.subscriptions.push(
    vscode.commands.registerCommand('provenance.removeGuard', (blockId?: string) =>
      removeGuard(blockId),
    ),
  );

  // Code Guard: run the diff check against the remote base branch
  context.subscriptions.push(
    vscode.commands.registerCommand('provenance.runCodeGuardCheck', runCodeGuardCheck),
  );

  // Keep the parse cache coherent when a file is closed or deleted.
  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument(doc => {
      invalidateCache(doc.uri);
      invalidateGuardCache(doc.uri);
    }),
  );
}

export function deactivate(): void {
  // VS Code disposes subscriptions automatically.
}
