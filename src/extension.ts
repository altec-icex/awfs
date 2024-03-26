import * as vscode from 'vscode';
import { AWFS } from './fileSystemProvider';

export function activate(context: vscode.ExtensionContext) {

	const awfs = new AWFS();
	context.subscriptions.push(vscode.workspace.registerFileSystemProvider('awfs', awfs, { isCaseSensitive: true }));

	let disposable = vscode.commands.registerCommand('awfs.workspaceInit', _ => {
		awfs.reconnect().then(() => {
			vscode.workspace.updateWorkspaceFolders(0, 0, { uri: vscode.Uri.parse('awfs:/'), name: "AWFS" });
		});
	});

	context.subscriptions.push(disposable);	
}

export function deactivate() {
	
}
