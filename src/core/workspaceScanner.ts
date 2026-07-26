import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { minimatch } from 'minimatch';
import { TreeNode, ScanFolderNode, FolderNode, WorkspaceNode } from './types';
import { normalizePathForComparison } from './pathUtils';

/**
 * Scans for workspace files.
 */
export class WorkspaceScanner {
  /**
   * Scan the given folders to find workspaces.
   * @param scanFolders Array of folder paths to scan
   * @param excludePatterns Array of glob patterns to exclude
   * @returns Array of ScanFolderNode results
   */
  async scan(scanFolders: string[], excludePatterns: string[]): Promise<ScanFolderNode[]> {
    const results: ScanFolderNode[] = [];
    const visitedScanFolders = new Set<string>();

    for (const folderPath of scanFolders) {
      const comparisonPath = normalizePathForComparison(folderPath);
      if (visitedScanFolders.has(comparisonPath)) {
        continue;
      }
      visitedScanFolders.add(comparisonPath);
      results.push(await this.scanFolder(folderPath, excludePatterns));
    }

    return results;
  }

  private async scanFolder(folderPath: string, excludePatterns: string[]): Promise<ScanFolderNode> {
    const normalizedPath = path.normalize(folderPath);
    const displayName = path.basename(normalizedPath) || normalizedPath;
    const problems: string[] = [];
    let children: TreeNode[] = [];

    try {
      const stats = await fs.promises.stat(normalizedPath);
      if (!stats.isDirectory()) {
        problems.push('設定されたパスはフォルダーではありません。');
      } else {
        const workspaceFiles = await this.collectWorkspaceFiles(normalizedPath, excludePatterns, problems);
        children = await this.buildTreeFromPaths(normalizedPath, workspaceFiles);
      }
    } catch (error) {
      console.warn(`WorkspaceScanner: Cannot access folder: ${folderPath}`, error);
      problems.push(`フォルダーにアクセスできません: ${this.getErrorMessage(error)}`);
    }

    return {
      type: 'scanFolder',
      name: displayName,
      path: normalizedPath,
      children,
      problems: problems.length > 0 ? problems : undefined
    };
  }

  /**
  * Recursively collect .code-workspace files under the given folder.
   * @param rootPath Root folder path
   * @param excludePatterns Array of glob patterns to exclude
  * @returns Array of detected workspace file paths
   */
  private async collectWorkspaceFiles(
    rootPath: string,
    excludePatterns: string[],
    problems: string[]
  ): Promise<string[]> {
    const workspaceFiles: string[] = [];
    const visitedPaths = new Set<string>(); // For symlink loop detection

    const scanDirectory = async (dirPath: string): Promise<void> => {
      try {
        // Detect symlink loops
        const realPath = await fs.promises.realpath(dirPath);
        if (visitedPaths.has(realPath)) {
          console.warn(`WorkspaceScanner: Symlink loop detected: ${dirPath}`);
          return;
        }
        visitedPaths.add(realPath);

        const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(dirPath, entry.name);
          const relativePath = path.relative(rootPath, fullPath);

          // Check if it matches an exclude pattern
          if (this.shouldExclude(relativePath, excludePatterns)) {
            continue;
          }

          if (entry.isDirectory()) {
            await scanDirectory(fullPath);
          } else if (entry.isFile() && entry.name.endsWith('.code-workspace')) {
            workspaceFiles.push(fullPath);
          }
        }
      } catch (error) {
        // Skip inaccessible directories
        console.warn(`WorkspaceScanner: Cannot read directory: ${dirPath}`, error);
        problems.push(`${dirPath}: ${this.getErrorMessage(error)}`);
      }
    };

    await scanDirectory(rootPath);
    return workspaceFiles;
  }

  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  /**
   * Check whether a path matches an exclude pattern.
   * @param relativePath Path relative to the root
   * @param excludePatterns Array of exclude patterns
   * @returns Whether the path should be excluded
   */
  private shouldExclude(relativePath: string, excludePatterns: string[]): boolean {
    // Normalize to POSIX form (minimatch expects POSIX style)
    const normalizedPath = relativePath.split(path.sep).join('/');
    
    for (const pattern of excludePatterns) {
      if (minimatch(normalizedPath, pattern, { dot: true })) {
        return true;
      }
    }
    return false;
  }

  /**
   * Build a tree structure from workspace file paths.
   * @param rootPath Root folder path
   * @param workspaceFiles Array of workspace file paths
   * @returns Array of tree nodes
   */
  async buildTreeFromPaths(rootPath: string, workspaceFiles: string[]): Promise<TreeNode[]> {
    // Map of folder structure
    const folderMap = new Map<string, FolderNode>();
    const rootChildren: TreeNode[] = [];

    for (const filePath of workspaceFiles) {
      const relativePath = path.relative(rootPath, filePath);
      const parts = relativePath.split(path.sep);
      const fileName = parts.pop()!;

      // Create a workspace node
      const workspaceNode: WorkspaceNode = {
        type: 'workspace',
        name: await this.getWorkspaceName(filePath),
        path: filePath,
        depth: parts.length + 1,
        uri: vscode.Uri.file(filePath)
      };

      if (parts.length === 0) {
        // Workspace at the root
        rootChildren.push(workspaceNode);
      } else {
        // Workspace inside a subfolder
        let currentPath = rootPath;
        let parentChildren: TreeNode[] = rootChildren;

        for (const [index, part] of parts.entries()) {
          currentPath = path.join(currentPath, part);
          const folderKey = currentPath;

          let folderNode = folderMap.get(folderKey);
          if (!folderNode) {
            folderNode = {
              type: 'folder',
              name: part,
              path: currentPath,
              depth: index + 1,
              children: []
            };
            folderMap.set(folderKey, folderNode);
            parentChildren.push(folderNode);
          }
          parentChildren = folderNode.children;
        }

        parentChildren.push(workspaceNode);
      }
    }

    // Sort folders and child nodes
    return this.sortNodes(rootChildren);
  }

  /**
   * Get the display name from a workspace file.
   * @param filePath Workspace file path
   * @returns Display name (name property or file name)
   */
  async getWorkspaceName(filePath: string): Promise<string> {
    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      const workspace = JSON.parse(content);
      if (workspace.name && typeof workspace.name === 'string') {
        return workspace.name;
      }
    } catch {
      // Ignore JSON parse and file read errors
    }
    return path.basename(filePath, '.code-workspace');
  }

  /**
   * Sort nodes (folders before workspaces, alphabetical within each group).
   * @param nodes Nodes to sort
   * @returns Sorted nodes
   */
  sortNodes(nodes: TreeNode[]): TreeNode[] {
    const sorted = [...nodes].sort((a, b) => {
      // Folders first
      const aIsFolder = a.type === 'folder' || a.type === 'scanFolder';
      const bIsFolder = b.type === 'folder' || b.type === 'scanFolder';
      
      if (aIsFolder && !bIsFolder) {
        return -1;
      }
      if (!aIsFolder && bIsFolder) {
        return 1;
      }
      
      // Same type: sort by name (case-insensitive)
      return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    });

    // Recursively sort child nodes
    for (const node of sorted) {
      if ((node.type === 'folder' || node.type === 'scanFolder') && node.children.length > 0) {
        node.children = this.sortNodes(node.children);
      }
    }

    return sorted;
  }

  /**
   * Filter the tree by removing empty folders.
   * @param nodes Array of nodes
   * @returns Filtered nodes
   */
  filterEmptyFolders(nodes: TreeNode[]): TreeNode[] {
    return nodes.filter(node => {
      if (node.type === 'folder') {
        // Recursively filter child folders
        node.children = this.filterEmptyFolders(node.children);
        // Keep only folders with children
        return node.children.length > 0;
      }
      // Always keep workspaces
      return true;
    });
  }
}
