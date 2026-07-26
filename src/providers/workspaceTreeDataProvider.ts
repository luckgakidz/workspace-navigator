import * as vscode from 'vscode';
import { TreeNode, ScanFolderNode, FolderNode, WorkspaceNode } from '../core/types';
import { WorkspaceScanner } from '../core/workspaceScanner';
import { ConfigService } from '../core/configService';
import { isSameFileSystemPath } from '../core/pathUtils';
import { WorkspaceTreeItemFactory } from './workspaceTreeItemFactory';

/**
 * TreeView data provider.
 */
export class WorkspaceTreeDataProvider implements vscode.TreeDataProvider<TreeNode>, vscode.Disposable {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<TreeNode | undefined | void> = this._onDidChangeTreeData.event;

  private scanner: Pick<WorkspaceScanner, 'scan'>;
  private configService: Pick<ConfigService, 'getConfig'>;
  private treeItemFactory: WorkspaceTreeItemFactory;
  private scanFolders: ScanFolderNode[] = [];
  private hasLoaded = false;
  private loadPromise: Promise<void> | undefined;
  private reloadRequested = false;

  constructor(
    configService: Pick<ConfigService, 'getConfig'>,
    scanner: Pick<WorkspaceScanner, 'scan'> = new WorkspaceScanner()
  ) {
    this.scanner = scanner;
    this.configService = configService;
    this.treeItemFactory = new WorkspaceTreeItemFactory();
  }

  /**
   * Get a TreeItem.
   * @param element TreeNode
   * @returns TreeItem
   */
  getTreeItem(element: TreeNode): vscode.TreeItem {
    switch (element.type) {
      case 'scanFolder':
        return this.treeItemFactory.createScanFolderTreeItem(element);
      case 'folder':
        return this.treeItemFactory.createFolderTreeItem(element);
      case 'workspace':
        return this.treeItemFactory.createWorkspaceTreeItem(element, vscode.workspace.workspaceFile?.fsPath);
    }
  }

  /**
   * Get child nodes.
   * @param element Parent node (root if undefined)
   * @returns Array of child nodes
   */
  async getChildren(element?: TreeNode): Promise<TreeNode[]> {
    if (!element) {
      // Root level: return scan folders
      if (!this.hasLoaded) {
        await this.requestLoad();
      }
      return this.scanFolders;
    }

    // Return children for folder nodes
    if (element.type === 'scanFolder' || element.type === 'folder') {
      return element.children;
    }

    // Workspace nodes have no children
    return [];
  }

  /**
   * Get parent node for reveal API support.
   * @param element Child node
   * @returns Parent node or undefined for root
   */
  getParent(element: TreeNode): TreeNode | undefined {
    for (const scanFolder of this.scanFolders) {
      if (scanFolder === element) {
        return undefined;
      }

      const parent = this.findParent(scanFolder, element);
      if (parent) {
        return parent;
      }
    }

    return undefined;
  }

  /**
   * Reload data.
   */
  async refresh(): Promise<void> {
    await this.requestLoad();
    this._onDidChangeTreeData.fire();
  }

  /**
   * Queue a reload. Concurrent requests share one scan and requests received
   * during a scan are coalesced into one additional scan.
   */
  private async requestLoad(): Promise<void> {
    this.reloadRequested = true;

    if (!this.loadPromise) {
      this.loadPromise = this.processLoadQueue();
    }

    await this.loadPromise;
  }

  private async processLoadQueue(): Promise<void> {
    try {
      do {
        this.reloadRequested = false;
        await this.loadData();
        this.hasLoaded = true;
      } while (this.reloadRequested);
    } finally {
      this.loadPromise = undefined;
    }
  }

  /**
   * Load data from configuration.
   */
  private async loadData(): Promise<void> {
    try {
      const { scanFolders, excludePatterns } = this.configService.getConfig();
      this.scanFolders = await this.scanner.scan(scanFolders, excludePatterns);
    } catch (error) {
      console.error('WorkspaceTreeDataProvider: Failed to load data', error);
      vscode.window.showErrorMessage(`Failed to scan workspaces: ${error}`);
      this.scanFolders = [];
    }
  }

  /**
   * Recursively find parent node in the current tree.
   * @param parent Parent candidate
   * @param target Target node
   * @returns Parent node when found
   */
  private findParent(parent: ScanFolderNode | FolderNode, target: TreeNode): TreeNode | undefined {
    for (const child of parent.children) {
      if (child === target) {
        return parent;
      }

      if (child.type === 'scanFolder' || child.type === 'folder') {
        const found = this.findParent(child, target);
        if (found) {
          return found;
        }
      }
    }

    return undefined;
  }

  /**
   * Find a workspace node by its workspace file path.
   * Loads the tree first when it has not been scanned yet.
   * @param workspacePath Absolute path to a .code-workspace file
   * @returns Matching workspace node, or undefined when it is not in the scan results
   */
  async findWorkspaceByPath(workspacePath: string): Promise<WorkspaceNode | undefined> {
    if (!this.hasLoaded) {
      await this.requestLoad();
    }

    return this.findWorkspaceInNodes(this.scanFolders, workspacePath);
  }

  /**
   * Recursively find a workspace node in the current tree.
   * @param nodes Nodes to search
   * @param workspacePath Workspace file path to match
   * @returns Matching workspace node, or undefined
   */
  private findWorkspaceInNodes(nodes: TreeNode[], workspacePath: string): WorkspaceNode | undefined {
    for (const node of nodes) {
      if (node.type === 'workspace') {
        if (isSameFileSystemPath(node.path, workspacePath)) {
          return node;
        }
        continue;
      }

      const found = this.findWorkspaceInNodes(node.children, workspacePath);
      if (found) {
        return found;
      }
    }

    return undefined;
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }

}
