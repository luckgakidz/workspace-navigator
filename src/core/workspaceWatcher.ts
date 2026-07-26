import * as vscode from 'vscode';

/**
 * Watches workspace file changes.
 */
export class WorkspaceWatcher implements vscode.Disposable {
  private watchers: vscode.FileSystemWatcher[] = [];
  private _onDidChange = new vscode.EventEmitter<void>();
  
  /**
   * Event fired when workspace files are created, changed, or deleted.
   */
  readonly onDidChange: vscode.Event<void> = this._onDidChange.event;

  /**
   * Update watched folders.
   * @param folders New watched folders
   */
  updateWatchedFolders(folders: string[]): void {
    // Dispose all existing watchers
    this.disposeWatchers();

    // Create watchers for each folder
    for (const folderPath of folders) {
      try {
        const watcher = this.createWatcher(folderPath);
        this.watchers.push(watcher);
      } catch (error) {
        console.error(`WorkspaceWatcher: Failed to create watcher for: ${folderPath}`, error);
        // Error handling: log the error and continue
      }
    }
  }

  /**
   * Create a FileSystemWatcher for the given folder.
   * @param folderPath Folder path
   * @returns FileSystemWatcher
   */
  private createWatcher(folderPath: string): vscode.FileSystemWatcher {
    try {
      const folderUri = vscode.Uri.file(folderPath);
      const pattern = new vscode.RelativePattern(folderUri, '**/*.code-workspace');
      
      const watcher = vscode.workspace.createFileSystemWatcher(pattern);
      
      watcher.onDidCreate(() => {
        this._onDidChange.fire();
      });

      watcher.onDidChange(() => {
        this._onDidChange.fire();
      });
      
      watcher.onDidDelete(() => {
        this._onDidChange.fire();
      });

      return watcher;
    } catch (error) {
      throw new Error(`Failed to create FileSystemWatcher for ${folderPath}: ${error}`);
    }
  }

  /**
    * Dispose all watchers.
   */
  private disposeWatchers(): void {
    for (const watcher of this.watchers) {
      try {
        watcher.dispose();
      } catch (error) {
        console.warn('Failed to dispose watcher:', error);
      }
    }
    this.watchers = [];
  }

  /**
    * Release resources.
   */
  dispose(): void {
    this.disposeWatchers();
    this._onDidChange.dispose();
  }
}

