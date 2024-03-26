import * as vscode from 'vscode';
import { AWFS } from './fileSystemProvider';

export function activate(context: vscode.ExtensionContext) {

	const awfs = new AWFS();
	context.subscriptions.push(vscode.workspace.registerFileSystemProvider('awfs', awfs, { isCaseSensitive: true }));

	let disposable = vscode.commands.registerCommand('awfs.workspaceInit', _ => {
		awfs.info().then((name) => {
			vscode.workspace.updateWorkspaceFolders(0, 0, { uri: vscode.Uri.parse('awfs:/'), name: "AWFS: " + name });
		}).catch((error) => {
			vscode.window.showErrorMessage(error ? error : 'unknown error');
		});
	});

	context.subscriptions.push(disposable);	
}

export function deactivate() {
	
}
