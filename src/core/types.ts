import * as vscode from 'vscode';

/**
 * Shared node type for the TreeView.
 */
export type TreeNode = ScanFolderNode | FolderNode | WorkspaceNode;

/**
 * Scan folder node (root level).
 */
export interface ScanFolderNode {
  type: 'scanFolder';
  /** Folder display name (last segment of the path). */
  name: string;
  /** Absolute folder path. */
  path: string;
  /** Workspaces and subfolders detected under this folder. */
  children: TreeNode[];
  /** Problems encountered while scanning this folder tree. */
  problems?: string[];
}

/**
 * Folder node (subfolder).
 */
export interface FolderNode {
  type: 'folder';
  /** Folder display name. */
  name: string;
  /** Absolute folder path. */
  path: string;
  /** Folder depth from scan folder root (1 = child, 2 = grandchild). */
  depth: number;
  /** Child nodes (folder or workspace). */
  children: TreeNode[];
}

/**
 * Workspace node.
 */
export interface WorkspaceNode {
  type: 'workspace';
  /** Workspace display name (name property or file name). */
  name: string;
  /** Absolute path to the workspace file. */
  path: string;
  /** Node depth from scan folder root (1 = child, 2 = grandchild). */
  depth: number;
  /** Workspace file URI. */
  uri: vscode.Uri;
}

/**
 * User settings stored in VS Code configuration.
 */
export interface WorkspaceManagerConfig {
  /** Array of scan folder paths. */
  scanFolders: string[];
  /** Exclude patterns (glob). */
  excludePatterns: string[];
}

/**
 * Default configuration values.
 */
export const DEFAULT_CONFIG: WorkspaceManagerConfig = {
  scanFolders: [],
  excludePatterns: [
    '**/node_modules',
    '**/.git',
    '**/.vscode'
  ]
};
