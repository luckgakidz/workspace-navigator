import * as vscode from 'vscode';
import { WorkspaceTreeDataProvider } from './providers/workspaceTreeDataProvider';
import { WorkspaceWatcher } from './core/workspaceWatcher';
import { ConfigService } from './core/configService';
import { TreeNode, WorkspaceNode } from './core/types';
import { 
  openWorkspace, 
  openWorkspaceInNewWindow, 
  addScanFolder,
  removeScanFolder,
  openSettings 
} from './commands/openWorkspace';
import { revealCurrentWorkspace } from './commands/revealCurrentWorkspace';

// This method is called when your extension is activated
export function activate(context: vscode.ExtensionContext) {
  console.log('Workspace Manager extension is now active!');

  const configService = new ConfigService();

  // Create the WorkspaceWatcher
  const watcher = new WorkspaceWatcher();

  // Create the TreeDataProvider
  const treeDataProvider = new WorkspaceTreeDataProvider(configService);

  // Register the TreeView
  const treeView = vscode.window.createTreeView('workspaceManagerView', {
    treeDataProvider: treeDataProvider,
    showCollapseAll: true
  });

  // Refresh the TreeView when files change
  const watcherListener = watcher.onDidChange(() => {
    treeDataProvider.refresh();
  });

  // Set initial watched folders
  watcher.updateWatchedFolders(configService.getScanFolders());

  // Watch for configuration changes
  const configListener = configService.onDidChangeSettings(() => {
    treeDataProvider.refresh();
    watcher.updateWatchedFolders(configService.getScanFolders());
  });

  const getSelectedWorkspaceNode = (): WorkspaceNode | undefined => {
    const selection = treeView.selection;
    if (selection && selection.length > 0 && selection[0].type === 'workspace') {
      return selection[0];
    }
    return undefined;
  };

  const getSelectedScanFolderNode = () => {
    const selection = treeView.selection;
    if (selection && selection.length > 0 && selection[0].type === 'scanFolder') {
      return selection[0];
    }
    return undefined;
  };

  const expandAllNodes = async (element?: TreeNode): Promise<void> => {
    const children = await treeDataProvider.getChildren(element);

    for (const child of children) {
      if (child.type === 'scanFolder' || child.type === 'folder') {
        await treeView.reveal(child, { expand: true, focus: false, select: false });
        await expandAllNodes(child);
      }
    }
  };

  // Register commands
  const commands = [
    vscode.commands.registerCommand('workspaceManager.openWorkspace', (arg?: any) => {
      // If invoked from the menu, use the TreeView selection
      return openWorkspace(arg ?? getSelectedWorkspaceNode());
    }),
    vscode.commands.registerCommand('workspaceManager.openWorkspaceInNewWindow', (arg?: any) => {
      // If invoked from the menu, use the TreeView selection
      return openWorkspaceInNewWindow(arg ?? getSelectedWorkspaceNode());
    }),
    vscode.commands.registerCommand('workspaceManager.refresh', () => treeDataProvider.refresh()),
    vscode.commands.registerCommand('workspaceManager.revealCurrentWorkspace', () => {
      return revealCurrentWorkspace(treeDataProvider, treeView, vscode.workspace.workspaceFile?.fsPath);
    }),
    vscode.commands.registerCommand('workspaceManager.expandAll', () => expandAllNodes()),
    vscode.commands.registerCommand('workspaceManager.addScanFolder', addScanFolder),
    vscode.commands.registerCommand('workspaceManager.removeScanFolder', (arg?: any) => {
      return removeScanFolder(arg ?? getSelectedScanFolderNode());
    }),
    vscode.commands.registerCommand('workspaceManager.openSettings', openSettings)
  ];

  // Register all disposables
  context.subscriptions.push(
    treeView,
    treeDataProvider,
    watcher,
    watcherListener,
    configListener,
    ...commands
  );
}

// This method is called when your extension is deactivated
export function deactivate() {}
