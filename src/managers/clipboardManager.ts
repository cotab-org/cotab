import * as vscode from 'vscode';
import { editHistoryManager } from './editHistoryManager';
import { logDebug } from '../utils/logger';

export function registerClipboardDetection(
	disposables: vscode.Disposable[],
	options?: { pollIntervalMs?: number }
) {
	const clipboardManager = new ClipboardManager(options?.pollIntervalMs);
	disposables.push(clipboardManager);

	startClipboardPolling = () => clipboardManager.start();
}

// Right after startup, VS Code is incorrectly determined to always have focus, so start with cursor detection.
export let startClipboardPolling: () => void = () => {};

/**
 * Manage clipboard
 * 
 * Since VS Code doesn't have a way to directly get copied content,
 * poll clipboard content to detect changes.
 * 
 * notice: Limit to only content copied in editor to avoid using content copied outside editor.
 */
class ClipboardManager implements vscode.Disposable {
	private readonly disposables: vscode.Disposable[] = [];
	
	private lastText = '';
	private interval: NodeJS.Timeout | undefined;
	private prevActiveTextEditor: vscode.TextEditor | undefined;

	constructor(private readonly pollIntervalMs = 2000) {
		// When window focus changes
		this.disposables.push(
			vscode.window.onDidChangeWindowState(state => {
				if (state.focused && vscode.window.activeTextEditor) {
					this.start();
				} else {
					// Process once right before focus is lost to avoid detecting copies outside editor.
					this.processClipboardOnce(true, this.prevActiveTextEditor);
					this.stop();
				}
				this.prevActiveTextEditor = vscode.window.activeTextEditor;
			})
		);

		// When active editor changes
		this.disposables.push(
			vscode.window.onDidChangeActiveTextEditor(() => {
				this.processClipboardOnce(true, this.prevActiveTextEditor);
				this.prevActiveTextEditor = vscode.window.activeTextEditor;
			})
		);
	}

	// notice: Right after startup, VS Code is incorrectly determined to always have focus, so this function is called with cursor detection.
	public async start() {
		if (this.interval) return;

		logDebug('Clipboard polling started');
		this.lastText = '';
		await this.processClipboardOnce(true); // Use current content as baseline

		this.interval = setInterval(() => {
			this.processClipboardOnce(false);
		}, this.pollIntervalMs);
	}

	public stop() {
		if (!this.interval) return;
		logDebug('Clipboard polling stopped');
		clearInterval(this.interval);
		this.interval = undefined;
	}

	public dispose() {
		this.stop();
		this.disposables.forEach(d => d.dispose());
	}

	private async readClipboardText(): Promise<string> {
		try {
			return await vscode.env.clipboard.readText();
		} catch (e) {
			console.error('Clipboard read error', e);
			return '';
		}
	}

	private async processClipboardOnce(
		isCacheOnly: boolean,
		activeTextEditor?: vscode.TextEditor
	) {
		const clipboardText = await this.readClipboardText();

		// First time: cache current value and exit
		if (this.lastText === '') {
			this.lastText = clipboardText;
			return;
		}

		// Exit if no changes
		if (clipboardText === this.lastText) {
			return;
		}

		// Detect changes
		this.lastText = clipboardText;

		if (isCacheOnly || !vscode.window.state.focused) {
			return;
		}

		// Determine target editor for editing
		activeTextEditor = activeTextEditor ?? vscode.window.activeTextEditor;
		if (!activeTextEditor) return;

		const scheme = activeTextEditor.document.uri.scheme;
		if (scheme !== 'file' && scheme !== 'untitled') return;

		// Add to history
		editHistoryManager.addEdit({
			type: 'copy',
			sourceOriginalText: clipboardText,
			originalText: clipboardText,
			newText: clipboardText,
			range: new vscode.Range(0, 0, 0, 0),
			document: activeTextEditor.document,
			timestamp: Date.now(),
		});
	}
}
