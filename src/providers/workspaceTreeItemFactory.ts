import * as vscode from 'vscode';
import { FolderNode, ScanFolderNode, WorkspaceNode } from '../core/types';
import { isSameFileSystemPath } from '../core/pathUtils';

export class WorkspaceTreeItemFactory {
  createScanFolderTreeItem(node: ScanFolderNode): vscode.TreeItem {
    const collapsibleState = node.children.length > 0
      ? vscode.TreeItemCollapsibleState.Expanded
      : vscode.TreeItemCollapsibleState.None;

    const treeItem = new vscode.TreeItem(node.name, collapsibleState);
    const problemCount = node.problems?.length ?? 0;
    treeItem.iconPath = problemCount > 0
      ? new vscode.ThemeIcon('warning', new vscode.ThemeColor('problemsWarningIcon.foreground'))
      : new vscode.ThemeIcon('root-folder');
    treeItem.tooltip = problemCount > 0
      ? `${node.path}\n${node.problems?.join('\n')}`
      : node.path;
    treeItem.contextValue = 'scanFolder';
    treeItem.description = problemCount > 0
      ? `スキャンエラー ${problemCount}件`
      : node.children.length === 0 ? 'ワークスペースなし' : undefined;

    return treeItem;
  }

  createFolderTreeItem(node: FolderNode): vscode.TreeItem {
    const collapsibleState = node.children.length > 0
      ? vscode.TreeItemCollapsibleState.Collapsed
      : vscode.TreeItemCollapsibleState.None;

    const treeItem = new vscode.TreeItem(node.name, collapsibleState);
    if (node.depth === 1) {
      treeItem.iconPath = new vscode.ThemeIcon('folder');
    }
    treeItem.tooltip = node.path;
    treeItem.contextValue = 'folder';

    return treeItem;
  }

  createWorkspaceTreeItem(node: WorkspaceNode, currentWorkspaceFilePath?: string): vscode.TreeItem {
    const treeItem = new vscode.TreeItem(node.name, vscode.TreeItemCollapsibleState.None);

    const isCurrentWorkspace = currentWorkspaceFilePath
      ? isSameFileSystemPath(currentWorkspaceFilePath, node.path)
      : false;

    if (isCurrentWorkspace) {
      treeItem.iconPath = new vscode.ThemeIcon('pass-filled', new vscode.ThemeColor('testing.iconPassed'));
    } else if (node.depth === 1) {
      treeItem.iconPath = new vscode.ThemeIcon('symbol-folder');
    }

    treeItem.tooltip = node.path;
    treeItem.contextValue = 'workspace';
    treeItem.command = {
      command: 'workspaceManager.openWorkspace',
      title: 'Open Workspace',
      arguments: [node.uri]
    };

    return treeItem;
  }
}
