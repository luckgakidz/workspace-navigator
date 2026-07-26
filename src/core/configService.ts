import * as vscode from 'vscode';
import { DEFAULT_CONFIG, WorkspaceManagerConfig } from './types';

export class ConfigService {
  private readonly section = 'workspaceManager';

  getConfig(): WorkspaceManagerConfig {
    const config = vscode.workspace.getConfiguration(this.section);

    return {
      scanFolders: config.get<string[]>('scanFolders', DEFAULT_CONFIG.scanFolders),
      excludePatterns: config.get<string[]>('excludePatterns', DEFAULT_CONFIG.excludePatterns)
    };
  }

  getScanFolders(): string[] {
    return this.getConfig().scanFolders;
  }

  getExcludePatterns(): string[] {
    return this.getConfig().excludePatterns;
  }

  async updateScanFolders(folders: string[]): Promise<void> {
    const config = vscode.workspace.getConfiguration(this.section);
    await config.update('scanFolders', folders, vscode.ConfigurationTarget.Global);
  }

  onDidChangeSettings(handler: (event: vscode.ConfigurationChangeEvent) => void): vscode.Disposable {
    return vscode.workspace.onDidChangeConfiguration(event => {
      if (this.affectsSettings(event)) {
        handler(event);
      }
    });
  }

  private affectsSettings(event: vscode.ConfigurationChangeEvent): boolean {
    return event.affectsConfiguration(`${this.section}.scanFolders`) ||
      event.affectsConfiguration(`${this.section}.excludePatterns`);
  }
}
