import * as vscode from 'vscode';
import { TreeNode, WorkspaceNode } from '../core/types';

type WorkspaceLookup = {
  findWorkspaceByPath(workspacePath: string): Promise<WorkspaceNode | undefined>;
};

type WorkspaceTreeView = Pick<vscode.TreeView<TreeNode>, 'reveal'>;
type ShowInformationMessage = (message: string) => PromiseLike<string | undefined>;

/**
 * Reveal and select the currently open .code-workspace file in the TreeView.
 * @param workspaceLookup Provider used to find the workspace node
 * @param treeView Workspace TreeView instance
 * @param currentWorkspacePath Currently open .code-workspace file path
 * @param showInformationMessage Information-message function (replaceable for tests)
 */
export async function revealCurrentWorkspace(
  workspaceLookup: WorkspaceLookup,
  treeView: WorkspaceTreeView,
  currentWorkspacePath: string | undefined,
  showInformationMessage: ShowInformationMessage = message => vscode.window.showInformationMessage(message)
): Promise<void> {
  if (!currentWorkspacePath) {
    await showInformationMessage('現在、.code-workspace ファイルは開かれていません。');
    return;
  }

  const workspaceNode = await workspaceLookup.findWorkspaceByPath(currentWorkspacePath);
  if (!workspaceNode) {
    await showInformationMessage('現在のワークスペースはスキャン対象に含まれていません。');
    return;
  }

  await treeView.reveal(workspaceNode, {
    select: true,
    focus: true
  });
}
