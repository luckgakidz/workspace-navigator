import * as vscode from 'vscode';
import { ScanFolderNode, WorkspaceNode } from '../core/types';
import { ConfigService } from '../core/configService';
import { isSameFileSystemPath } from '../core/pathUtils';

type ScanFolderConfigService = Pick<ConfigService, 'getScanFolders' | 'updateScanFolders'>;
type ConfirmScanFolderRemoval = (node: ScanFolderNode) => PromiseLike<boolean>;

/**
 * Convert a URI or a serialized URI object to vscode.Uri.
 * TreeView command.arguments are serialized/deserialized, so a plain object
 * may be passed instead of a vscode.Uri instance.
 */
type SerializedUri = { scheme: string; path: string; fsPath?: string };
type WorkspaceArgument = vscode.Uri | SerializedUri | WorkspaceNode;

function isWorkspaceNode(value: unknown): value is WorkspaceNode {
  return !!value && typeof value === 'object' && 'uri' in value;
}

function isSerializedUri(value: unknown): value is SerializedUri {
  return !!value && typeof value === 'object' && 'scheme' in value && 'path' in value;
}

function deserializeUri(value: SerializedUri): vscode.Uri {
  if (value.scheme === 'file' && value.fsPath) {
    return vscode.Uri.file(value.fsPath);
  }
  return vscode.Uri.parse(`${value.scheme}:${value.path}`);
}

function resolveWorkspaceUri(arg?: WorkspaceArgument): vscode.Uri {
  if (!arg) {
    throw new Error('No workspace selected');
  }

  const uriValue = isWorkspaceNode(arg) ? arg.uri : arg;

  if (uriValue instanceof vscode.Uri) {
    return uriValue;
  }

  if (isSerializedUri(uriValue)) {
    return deserializeUri(uriValue);
  }

  throw new Error('Invalid workspace argument');
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * Open a workspace in the current window.
 * @param uri Workspace file URI (or a serialized URI object)
 */
export async function openWorkspace(arg?: WorkspaceArgument): Promise<void> {
  try {
    const resolvedUri = resolveWorkspaceUri(arg);
    await vscode.commands.executeCommand('vscode.openFolder', resolvedUri);
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to open workspace: ${getErrorMessage(error)}`);
  }
}

/**
 * Open a workspace in a new window.
 * @param uri Workspace file URI (or a serialized URI object)
 */
export async function openWorkspaceInNewWindow(arg?: WorkspaceArgument): Promise<void> {
  try {
    const resolvedUri = resolveWorkspaceUri(arg);
    await vscode.commands.executeCommand('vscode.openFolder', resolvedUri, { forceNewWindow: true });
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to open workspace in new window: ${getErrorMessage(error)}`);
  }
}

/**
 * Add a scan folder.
 */
export async function addScanFolder(): Promise<void> {
  const result = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: 'Add Scan Folder',
    title: 'Select a folder to scan for .code-workspace files'
  });

  if (!result || result.length === 0) {
    return;
  }

  const folderPath = result[0].fsPath;
  const configService = new ConfigService();
  const scanFolders = configService.getScanFolders();

  // Prevent duplicates
  if (scanFolders.some(configuredPath => isSameFileSystemPath(configuredPath, folderPath))) {
    vscode.window.showInformationMessage('This folder is already in the scan list.');
    return;
  }

  // Add the new folder
  const updatedFolders = [...scanFolders, folderPath];
  await configService.updateScanFolders(updatedFolders);
  vscode.window.showInformationMessage(`Added scan folder: ${folderPath}`);
}

/**
 * Confirm removal of a scan folder from the extension settings.
 * This operation never deletes the folder or files from the file system.
 * @param node Scan folder selected in the TreeView
 * @returns Whether the user confirmed the removal
 */
async function confirmScanFolderRemoval(node: ScanFolderNode): Promise<boolean> {
  const removeAction = '設定から削除';
  const selectedAction = await vscode.window.showWarningMessage(
    `スキャンフォルダー「${node.name}」を削除しますか？`,
    {
      modal: true,
      detail: 'Workspace Navigator の設定からのみ削除します。実際のフォルダーやファイルは削除されません。'
    },
    removeAction
  );

  return selectedAction === removeAction;
}

/**
 * Remove a scan folder from the extension settings.
 * @param node Scan folder selected in the TreeView
 * @param configService Configuration service (replaceable for tests)
 * @param confirmRemoval Confirmation function (replaceable for tests)
 */
export async function removeScanFolder(
  node?: ScanFolderNode,
  configService: ScanFolderConfigService = new ConfigService(),
  confirmRemoval: ConfirmScanFolderRemoval = confirmScanFolderRemoval
): Promise<void> {
  if (!node || node.type !== 'scanFolder') {
    return;
  }

  if (!await confirmRemoval(node)) {
    return;
  }

  const scanFolders = configService.getScanFolders();
  const updatedFolders = scanFolders.filter(folderPath => !isSameFileSystemPath(folderPath, node.path));

  if (updatedFolders.length === scanFolders.length) {
    return;
  }

  await configService.updateScanFolders(updatedFolders);
}

/**
 * Open settings.
 */
export async function openSettings(): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.openSettings', 'workspaceManager');
}

/**
 * Refresh the TreeView.
 * @param provider TreeDataProvider refresh function
 */
