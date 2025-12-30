import * as vscode from 'vscode';
import { logInfo } from '../utils/logger';
import { getConfig } from '../utils/config';
import { clearAllDecorations } from './suggestionRenderer';
import { clearSuggestions } from './suggestionStore';
import { startClipboardPolling } from '../managers/clipboardManager';
import { editHistoryManager } from '../managers/editHistoryManager';
import { clearAcceptingSuggestion, isAcceptingSuggestion } from './suggestionCommands';
import { suggestionManager } from './suggestionManager';

export function registerAutoSuggestionTrigger(disposables: vscode.Disposable[]) {
	const localDisposables: vscode.Disposable[] = [];

    // Initialization after startup - Trigger cursor line suggestions with slight delay
    const startupTimeout = setTimeout(() => {
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor && getConfig().isCurrentEnabled()) {
            vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');
        }
    }, 2000); // Initialize after 2 seconds

	localDisposables.push(new vscode.Disposable(() => clearTimeout(startupTimeout)));

	// Initial trigger (when document is opened)
	localDisposables.push(
		vscode.window.onDidChangeActiveTextEditor(editor => {
			if (!editor) return;
			
			const scheme = editor.document.uri.scheme;
			if (scheme !== 'file' && scheme !== 'untitled') return;

			logInfo('Active text editor changed, initializing cotab');
			if (getConfig().isCurrentEnabled()) {
				setTimeout(() => {
					vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');
				}, 200);
			}
		})
	);

	// Track previous active editor
	let previousActiveEditor: vscode.TextEditor | undefined = vscode.window.activeTextEditor;
	
	localDisposables.push(
		vscode.window.onDidChangeActiveTextEditor(editor => {
			//console.log('onDidChangeActiveTextEditor triggered:', editor ? editor.document.uri.toString() : 'no editor');
			
			// If previous editor exists and new editor is different, clear decorations for previous editor
			if (previousActiveEditor && (!editor || editor.document.uri.toString() !== previousActiveEditor.document.uri.toString())) {
				//console.log('Clearing decorations for previous editor:', previousActiveEditor.document.uri.toString());
				clearAllDecorations(previousActiveEditor);
			}
			
			if (!editor) {
				previousActiveEditor = undefined;
				return;
			}
			
			suggestionManager?.cancelCurrentRequest();
			clearSuggestions(editor.document.uri);
			clearAllDecorations(editor);
			
			previousActiveEditor = editor;
		})
	);

	let prevPos: vscode.Position | undefined = undefined;
	localDisposables.push(
		vscode.window.onDidChangeTextEditorSelection(e => {
			const editor = e.textEditor;
			
			const scheme = editor.document.uri.scheme;
			if (scheme !== 'file' && scheme !== 'untitled') return;

			// Only process if selection actually changed (prevents infinite loops)
			if (prevPos && prevPos.isEqual(editor.selection.active)) {
				//console.log('Skipping onDidChangeTextEditorSelection due to no position change');
				return;
			}
			
			// Discard all candidates for any selection change
			prevPos = editor.selection.active;

			// After startup, VS Code incorrectly determines it always has focus, so start with cursor detection.
			startClipboardPolling();

			// Update cursor line cache (cache saved to reference text before editing)
			editHistoryManager.updateLineCache(editor.document, editor.selection.active, editor.selection.anchor);

			if (! isAcceptingSuggestion())
			{
				suggestionManager?.cancelCurrentRequest();
				clearSuggestions(editor.document.uri);
				clearAllDecorations(editor);
				
				// Execute completion if auto trigger is enabled
				if (getConfig().isCurrentEnabled()) {
					setTimeout(() => {
						vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');
					}, 0);
				}
			}
		})
	);

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const onExec = (vscode.commands as any).onDidExecuteCommand;
	if (onExec) {
		localDisposables.push(
			onExec((e: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
				const cmd = e?.command as string | undefined;
				if (!cmd) return;
				const editor = vscode.window.activeTextEditor;
				if (!editor) return;
				// Exclude setContext command (prevents infinite loops)
				if (cmd === 'setContext') return;
				
				// Clear decorations immediately in any case
				if (
					cmd === 'editor.action.inlineSuggest.hide' ||
					cmd === 'editor.action.inlineSuggest.trigger' ||
					cmd === 'type' ||
					cmd === 'deleteLeft' ||
					cmd === 'deleteRight' ||
					cmd === 'paste' ||
					cmd === 'cut' ||
					cmd === 'acceptSelectedSuggestion' ||
					cmd === 'editor.action.inlineSuggest.commit'
				) {
					if (editor && !isAcceptingSuggestion()) {
						suggestionManager?.cancelCurrentRequest();
						clearSuggestions(editor.document.uri);
						clearAllDecorations(editor);
					}
				}
				// 
				if (
					cmd === 'editor.action.inlineSuggest.hide' ||
					cmd === 'type' ||
					cmd === 'deleteLeft' ||
					cmd === 'deleteRight' ||
					cmd === 'paste' ||
					cmd === 'cut'
				) {
					clearAcceptingSuggestion();
				}
			})
		);
	}

	// Clear decorations when window focus state changes
	localDisposables.push(
		vscode.window.onDidChangeWindowState(e => {
			//console.log('onDidChangeWindowState triggered:', { focused: e.focused });
			// Clear decorations when window loses focus
			if (!e.focused) {
				// Clear decorations for all open editors
				vscode.window.visibleTextEditors.forEach(editor => {
					//console.log('Clearing decorations for visible editor:', editor.document.uri.toString());
					clearAllDecorations(editor);
				});
			}
		})
	);

	disposables.push(...localDisposables);
}