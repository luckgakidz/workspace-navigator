import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { removeScanFolder } from '../commands/openWorkspace';
import { revealCurrentWorkspace } from '../commands/revealCurrentWorkspace';
import { WorkspaceScanner } from '../core/workspaceScanner';
import { ScanFolderNode, TreeNode, WorkspaceNode } from '../core/types';
import { isSameFileSystemPath } from '../core/pathUtils';
import { WorkspaceTreeDataProvider } from '../providers/workspaceTreeDataProvider';
import { WorkspaceTreeItemFactory } from '../providers/workspaceTreeItemFactory';

suite('WorkspaceScanner', () => {
	let tempRoot: string;

	setup(async () => {
		tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'workspace-navigator-test-'));
	});

	teardown(async () => {
		await fs.promises.rm(tempRoot, { recursive: true, force: true });
	});

	test('ワークスペースを階層化し、除外パターンを適用する', async () => {
		const projectDirectory = path.join(tempRoot, 'projects');
		const excludedDirectory = path.join(tempRoot, 'excluded');
		await fs.promises.mkdir(projectDirectory, { recursive: true });
		await fs.promises.mkdir(excludedDirectory, { recursive: true });

		await fs.promises.writeFile(
			path.join(projectDirectory, 'project.code-workspace'),
			JSON.stringify({ name: '表示名' }),
			'utf-8'
		);
		await fs.promises.writeFile(
			path.join(tempRoot, 'root.code-workspace'),
			JSON.stringify({ folders: [] }),
			'utf-8'
		);
		await fs.promises.writeFile(
			path.join(excludedDirectory, 'hidden.code-workspace'),
			JSON.stringify({ folders: [] }),
			'utf-8'
		);

		const scanner = new WorkspaceScanner();
		const result = await scanner.scan([tempRoot], ['**/excluded']);

		assert.strictEqual(result.length, 1);
		assert.deepStrictEqual(result[0].children.map(node => node.name), ['projects', 'root']);

		const projectNode = result[0].children[0];
		assert.strictEqual(projectNode.type, 'folder');
		if (projectNode.type === 'folder') {
			assert.strictEqual(projectNode.children.length, 1);
			assert.strictEqual(projectNode.children[0].name, '表示名');
		}
	});

	test('不正なJSONではファイル名を表示名として使用する', async () => {
		const workspacePath = path.join(tempRoot, 'fallback.code-workspace');
		await fs.promises.writeFile(workspacePath, '{ invalid json', 'utf-8');

		const scanner = new WorkspaceScanner();
		assert.strictEqual(await scanner.getWorkspaceName(workspacePath), 'fallback');
	});

	test('アクセスできないスキャンフォルダーをエラー付きノードとして返す', async () => {
		const missingPath = path.join(tempRoot, 'missing');
		const scanner = new WorkspaceScanner();

		const result = await scanner.scan([missingPath], []);

		assert.strictEqual(result.length, 1);
		assert.strictEqual(result[0].path, missingPath);
		assert.strictEqual(result[0].children.length, 0);
		assert.ok(result[0].problems?.[0].includes('アクセスできません'));
	});

	test('同じスキャンフォルダーの表記違いを重複させない', async () => {
		const scanner = new WorkspaceScanner();
		const result = await scanner.scan([tempRoot, `${tempRoot}${path.sep}`], []);

		assert.strictEqual(result.length, 1);
	});
});

suite('Path utilities', () => {
	test('区切り文字や相対要素を正規化して比較する', () => {
		const basePath = path.join(os.tmpdir(), 'workspace-navigator-path');
		assert.ok(isSameFileSystemPath(basePath, path.join(basePath, '.')));
	});

	test('Windowsでは大文字小文字を区別せず比較する', function () {
		if (process.platform !== 'win32') {
			this.skip();
		}

		assert.ok(isSameFileSystemPath('C:\\Workspaces\\Sample', 'c:\\workspaces\\sample'));
	});
});

suite('Scan folder commands', () => {
	let tempRoot: string;

	setup(async () => {
		tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'workspace-navigator-command-'));
	});

	teardown(async () => {
		await fs.promises.rm(tempRoot, { recursive: true, force: true });
	});

	const createScanFolderNode = (folderPath: string): ScanFolderNode => ({
		type: 'scanFolder',
		name: path.basename(folderPath),
		path: folderPath,
		children: []
	});

	test('確認後に対象だけを設定から削除し、実フォルダーは残す', async () => {
		const targetFolder = path.join(tempRoot, 'target');
		const otherFolder = path.join(tempRoot, 'other');
		await fs.promises.mkdir(targetFolder);
		let updatedFolders: string[] | undefined;
		const configService = {
			getScanFolders: () => [`${targetFolder}${path.sep}`, otherFolder],
			updateScanFolders: async (folders: string[]) => {
				updatedFolders = folders;
			}
		};

		await removeScanFolder(createScanFolderNode(targetFolder), configService, async () => true);

		assert.deepStrictEqual(updatedFolders, [otherFolder]);
		assert.ok((await fs.promises.stat(targetFolder)).isDirectory());
	});

	test('確認をキャンセルした場合は設定を更新しない', async () => {
		const targetFolder = path.join(tempRoot, 'target');
		let updateCount = 0;
		const configService = {
			getScanFolders: () => [targetFolder],
			updateScanFolders: async () => {
				updateCount += 1;
			}
		};

		await removeScanFolder(createScanFolderNode(targetFolder), configService, async () => false);

		assert.strictEqual(updateCount, 0);
	});
});

suite('WorkspaceTreeDataProvider', () => {
	test('スキャン中の複数更新要求を1回の追補スキャンへ集約する', async () => {
		let scanCount = 0;
		let notifyFirstScanStarted!: () => void;
		let releaseFirstScan!: () => void;
		const firstScanStarted = new Promise<void>(resolve => {
			notifyFirstScanStarted = resolve;
		});
		const firstScanGate = new Promise<void>(resolve => {
			releaseFirstScan = resolve;
		});
		const scanner = {
			scan: async () => {
				scanCount += 1;
				if (scanCount === 1) {
					notifyFirstScanStarted();
					await firstScanGate;
				}
				return [];
			}
		};
		const configService = {
			getConfig: () => ({ scanFolders: [], excludePatterns: [] })
		};
		const provider = new WorkspaceTreeDataProvider(configService, scanner);

		const firstRefresh = provider.refresh();
		await firstScanStarted;
		const secondRefresh = provider.refresh();
		const thirdRefresh = provider.refresh();
		releaseFirstScan();

		await Promise.all([firstRefresh, secondRefresh, thirdRefresh]);
		assert.strictEqual(scanCount, 2);
		provider.dispose();
	});

	test('現在のワークスペースを深い階層からパスで検索する', async () => {
		const workspaceNode: WorkspaceNode = {
			type: 'workspace',
			name: 'Current',
			path: path.join('C:', 'workspaces', 'nested', 'current.code-workspace'),
			depth: 2,
			uri: vscode.Uri.file(path.join('C:', 'workspaces', 'nested', 'current.code-workspace'))
		};
		const scanner = {
			scan: async (): Promise<ScanFolderNode[]> => [{
				type: 'scanFolder',
				name: 'workspaces',
				path: path.join('C:', 'workspaces'),
				children: [{
					type: 'folder',
					name: 'nested',
					path: path.join('C:', 'workspaces', 'nested'),
					depth: 1,
					children: [workspaceNode]
				}]
			}]
		};
		const configService = {
			getConfig: () => ({ scanFolders: [], excludePatterns: [] })
		};
		const provider = new WorkspaceTreeDataProvider(configService, scanner);

		const result = await provider.findWorkspaceByPath(workspaceNode.path);

		assert.strictEqual(result, workspaceNode);
		provider.dispose();
	});
});

suite('Current workspace reveal command', () => {
	const workspaceNode: WorkspaceNode = {
		type: 'workspace',
		name: 'Current',
		path: path.join('C:', 'workspaces', 'current.code-workspace'),
		depth: 1,
		uri: vscode.Uri.file(path.join('C:', 'workspaces', 'current.code-workspace'))
	};

	test('現在のワークスペースを選択してフォーカスする', async () => {
		let revealedElement: TreeNode | undefined;
		let revealOptions: Parameters<vscode.TreeView<TreeNode>['reveal']>[1];
		const treeView: Pick<vscode.TreeView<TreeNode>, 'reveal'> = {
			reveal: async (element, options) => {
				revealedElement = element;
				revealOptions = options;
			}
		};

		await revealCurrentWorkspace(
			{ findWorkspaceByPath: async () => workspaceNode },
			treeView,
			workspaceNode.path,
			async () => undefined
		);

		assert.strictEqual(revealedElement, workspaceNode);
		assert.deepStrictEqual(revealOptions, { select: true, focus: true });
	});

	test('.code-workspaceを開いていない場合は検索せず案内する', async () => {
		let lookupCount = 0;
		let revealCount = 0;
		let message: string | undefined;
		const treeView: Pick<vscode.TreeView<TreeNode>, 'reveal'> = {
			reveal: async () => {
				revealCount += 1;
			}
		};

		await revealCurrentWorkspace(
			{
				findWorkspaceByPath: async () => {
					lookupCount += 1;
					return workspaceNode;
				}
			},
			treeView,
			undefined,
			async value => {
				message = value;
				return undefined;
			}
		);

		assert.strictEqual(lookupCount, 0);
		assert.strictEqual(revealCount, 0);
		assert.strictEqual(message, '現在、.code-workspace ファイルは開かれていません。');
	});

	test('現在のワークスペースが一覧外の場合は案内する', async () => {
		let revealCount = 0;
		let message: string | undefined;
		const treeView: Pick<vscode.TreeView<TreeNode>, 'reveal'> = {
			reveal: async () => {
				revealCount += 1;
			}
		};

		await revealCurrentWorkspace(
			{ findWorkspaceByPath: async () => undefined },
			treeView,
			workspaceNode.path,
			async value => {
				message = value;
				return undefined;
			}
		);

		assert.strictEqual(revealCount, 0);
		assert.strictEqual(message, '現在のワークスペースはスキャン対象に含まれていません。');
	});
});

suite('WorkspaceTreeItemFactory', () => {
	const createWorkspaceNode = (workspacePath: string): WorkspaceNode => ({
		type: 'workspace',
		name: 'Sample',
		path: workspacePath,
		depth: 1,
		uri: vscode.Uri.file(workspacePath)
	});

	test('現在開いているワークスペースに成功アイコンを表示する', () => {
		const factory = new WorkspaceTreeItemFactory();
		const workspacePath = path.join('C:', 'workspaces', 'sample.code-workspace');

		const item = factory.createWorkspaceTreeItem(createWorkspaceNode(workspacePath), workspacePath);

		assert.ok(item.iconPath instanceof vscode.ThemeIcon);
		assert.strictEqual(item.iconPath.id, 'pass-filled');
	});

	test('TreeItemコマンドへワークスペースURIを渡す', () => {
		const factory = new WorkspaceTreeItemFactory();
		const workspacePath = path.join('C:', 'workspaces', 'sample.code-workspace');
		const node = createWorkspaceNode(workspacePath);

		const item = factory.createWorkspaceTreeItem(node);

		assert.strictEqual(item.command?.command, 'workspaceManager.openWorkspace');
		assert.deepStrictEqual(item.command?.arguments, [node.uri]);
	});

	test('スキャン問題を警告アイコンと説明で表示する', () => {
		const factory = new WorkspaceTreeItemFactory();
		const item = factory.createScanFolderTreeItem({
			type: 'scanFolder',
			name: 'missing',
			path: 'C:\\missing',
			children: [],
			problems: ['フォルダーにアクセスできません']
		});

		assert.ok(item.iconPath instanceof vscode.ThemeIcon);
		assert.strictEqual(item.iconPath.id, 'warning');
		assert.strictEqual(item.description, 'スキャンエラー 1件');
	});
});

suite('Extension manifest', () => {
	test('現在のワークスペースを表示するコマンドをビュータイトルに配置する', () => {
		const manifestPath = path.resolve(__dirname, '..', '..', 'package.json');
		const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as {
			contributes?: {
				commands?: Array<{ command: string; title?: string; icon?: string }>;
				menus?: {
					'view/title'?: Array<{ command: string; when?: string; group?: string }>;
				};
			};
		};
		const command = manifest.contributes?.commands
			?.find(item => item.command === 'workspaceManager.revealCurrentWorkspace');
		const menu = manifest.contributes?.menus?.['view/title']
			?.find(item => item.command === 'workspaceManager.revealCurrentWorkspace');

		assert.deepStrictEqual(command, {
			command: 'workspaceManager.revealCurrentWorkspace',
			title: '現在のワークスペースを表示',
			icon: '$(target)',
			category: 'Workspace Manager'
		});
		assert.deepStrictEqual(menu, {
			command: 'workspaceManager.revealCurrentWorkspace',
			when: 'view == workspaceManagerView',
			group: 'navigation@2'
		});
	});

	test('ワークスペース行には新しいウィンドウで開くボタンだけを表示する', () => {
		const manifestPath = path.resolve(__dirname, '..', '..', 'package.json');
		const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as {
			contributes?: {
				menus?: {
					'view/item/context'?: Array<{ command: string; group?: string }>;
				};
			};
		};
		const inlineCommands = manifest.contributes?.menus?.['view/item/context']
			?.filter(item => item.group?.startsWith('inline'))
			.map(item => item.command);

		assert.deepStrictEqual(inlineCommands, ['workspaceManager.openWorkspaceInNewWindow']);
	});

	test('スキャンフォルダーにだけ削除コンテキストメニューを表示する', () => {
		const manifestPath = path.resolve(__dirname, '..', '..', 'package.json');
		const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as {
			contributes?: {
				menus?: {
					'view/item/context'?: Array<{ command: string; when?: string }>;
				};
			};
		};
		const removeMenu = manifest.contributes?.menus?.['view/item/context']
			?.find(item => item.command === 'workspaceManager.removeScanFolder');

		assert.strictEqual(
			removeMenu?.when,
			'view == workspaceManagerView && viewItem == scanFolder'
		);
	});
});
