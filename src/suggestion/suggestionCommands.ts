import * as vscode from 'vscode';
import { getMergedSuggestions, clearSuggestions, getSuggestions } from './suggestionStore';
import { clearAllDecorations, renderSuggestions, reRenderSuggestions } from './suggestionRenderer';
import { logInfo, logDebug, logWarning, logError } from '../utils/logger';
import { suggestionManager } from './suggestionManager';
import { computeCharDiff } from '../diff/charDiff';
import { statusBarManager } from '../ui/statusBarManager';
import { editHistoryManager } from '../managers/editHistoryManager';

// Flag to prevent duplicate processing
let isProcessingSuggestion = false;
let isAcceptingSuggestionFlag = false;

export function isAcceptingSuggestion() {
    return isAcceptingSuggestionFlag;
}
export function clearAcceptingSuggestion() {
    isAcceptingSuggestionFlag = false;
}

export function registerSuggestionCommands(disposables: vscode.Disposable[]) {
	disposables.push(
		vscode.commands.registerCommand('cotab.acceptSuggestion', acceptSuggestionCmd),
		vscode.commands.registerCommand('cotab.acceptFirstLineSuggestion', acceptFirstLineSuggestionCmd),
		vscode.commands.registerCommand('cotab.clearSuggestions', clearAllSuggestionsCmd),
		vscode.commands.registerCommand('cotab.cancelSuggestions', () => suggestionManager.cancelCurrentRequest()),
	);
}

// export async function nextSuggestionCmd() {
// 	const editor = vscode.window.activeTextEditor;
// 	if (!editor) return;
// 	const docUri = editor.document.uri;
// 	const currLine = editor.selection.active.line;
// 	const next = getSuggestions(docUri).edits.find(s => s.line === currLine);
// 	if (!next) {
// 		vscode.window.setStatusBarMessage('No more suggestions', 2000);
// 		return;
// 	}
// 	await jumpToSuggestion(editor, next.line);
// }

function addRejectHistory(editor: vscode.TextEditor) {
    logDebug('******************* addRejectHistory');
	const suggestions = getSuggestions(editor.document.uri);
	const firstEdit = suggestions.edits[0];
	if (editHistoryManager && firstEdit) {
		const document = editor.document;
		const targetLine = firstEdit.line;
		let originalLineText = '';
		if (0 <= targetLine && targetLine < document.lineCount) {
			originalLineText = document.lineAt(targetLine).text;
		}
		const newLineText = (firstEdit.newText ?? '').split('\n')[0] ?? '';
		const rangeLine = document.lineCount === 0
			? 0
			: Math.min(Math.max(targetLine, 0), Math.max(document.lineCount - 1, 0));
		const range = new vscode.Range(
			new vscode.Position(rangeLine, 0),
			new vscode.Position(rangeLine, originalLineText.length)
		);
		editHistoryManager.addEdit({
			type: 'reject',
			sourceOriginalText: originalLineText,
			originalText: originalLineText,
			newText: newLineText,
			range,
			document,
			timestamp: Date.now(),
		});
	}
}

export async function clearAllSuggestionsCmd() {
	const editor = vscode.window.activeTextEditor;
	if (!editor) return;

    // add history
    addRejectHistory(editor);

    // cancel completion
    suggestionManager.cancelCurrentRequest();

    // clear suggestion
	clearSuggestions(editor.document.uri);
	clearAllDecorations(editor);

	// hide inline suggestion
	try {
        // 
		await vscode.commands.executeCommand('editor.action.inlineSuggest.hide');
	} catch (error) {
		logDebug(`Failed to hide inline suggestion: ${error}`);
	}
}

export async function acceptSuggestionCmd() {
    await acceptSuggestionCmdInternal();
}

export async function acceptSuggestionCmdInternal(isFullAccept: boolean = true) {
	const editor = vscode.window.activeTextEditor;
	if (!editor) return;

	// Do nothing if already processing
	if (! isProcessingSuggestion) {
	    isProcessingSuggestion = true;
        const success = await acceptSuggestionInternal(isFullAccept);
        isProcessingSuggestion = false;

        if (success) {
            logDebug('Accepting suggestion successfully');
            return;
        }
    }

    // fallback system tab command
	await vscode.commands.executeCommand('tab');
}

export async function acceptFirstLineSuggestionCmd() {
    await acceptSuggestionCmdInternal(false);
}

// async function jumpToSuggestion(editor: vscode.TextEditor, line: number) {
// 	const position = new vscode.Position(line, 0);
// 	editor.selection = new vscode.Selection(position, position);
// 	await vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');
// 	editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.Default);

// 	renderSuggestions(editor);
// }

async function acceptSuggestionInternal(isFullAccept: boolean) {
	const editor = vscode.window.activeTextEditor;
	if (!editor) return false;

	const docUri = editor.document.uri;
	const mergedData = getMergedSuggestions(docUri, isFullAccept);
	if (mergedData.edits.size == 0) {
        return false;
    }
	logDebug(`Accepting ${mergedData.edits.size} suggestions`);
    
    const wsEdit = new vscode.WorkspaceEdit();
    let lastEditedLine = -1;
    let lastEditedPosition = -1;
    
    // Apply integrated edits for each line
    // First, group suggestions from consecutive lines
    const sortedLines = Array.from(mergedData.edits.keys()).sort((a, b) => a - b);
    const groupedEdits: Array<{startLine: number,
                            endLine: number,
                            text: string,
                            type: 'add' | 'delete' | 'change'}> = [];
    
    let currentGroup: {startLine: number,
                        endLine: number,
                        text: string,
                        type: 'add' | 'delete' | 'change'
                    } | null = null;
    
    for (const line of sortedLines) {
        const suggestions = mergedData.edits.get(line)!;
        const newTextLines = suggestions.map(s => s.newText).join('\n').split('\n');
        
        logDebug(`Processing ${suggestions.length} suggestions for line ${line}`);
        logDebug(`Original line: "${editor.document.lineAt(line).text}"`);
        logDebug(`New text lines: ${newTextLines.length} lines`);
        
        if (currentGroup === null) {
            // Start new group
            currentGroup = {
                startLine: line,
                endLine: line,
                text: suggestions.map(s => s.newText).join('\n'),
                type: suggestions[0].type
            };
        /*
        } else if (line === currentGroup.endLine + 1) {
            // For consecutive or adjacent lines, add to group
            currentGroup.endLine = line;
            currentGroup.text += '\n' + suggestions.map(s => s.newText).join('\n');
        */
        } else {
            // For non-consecutive lines, save current group and start new group
            groupedEdits.push(currentGroup);
            currentGroup = {
                startLine: line,
                endLine: line,
                text: suggestions.map(s => s.newText).join('\n'),
                type: suggestions[0].type
            };
        }
    }
    
    // Add last group
    if (currentGroup !== null) {
        groupedEdits.push(currentGroup);
    }
    
    // Whether there are suggestions not yet applied
    let hasUnappliedSuggestion = false;

    // Apply grouped edits
    for (const group of groupedEdits) {
        const startPos = new vscode.Position(group.startLine, 0);
        const endPos = editor.document.lineAt(group.endLine).range.end;
        const range = new vscode.Range(startPos, endPos);
        
        if (group.type === 'add') {
            wsEdit.insert(docUri, startPos, group.text + '\n');
        } else if (group.type === 'delete') {
            wsEdit.delete(docUri, range);
        } else {
            wsEdit.replace(docUri, range, group.text);
        }

        const groupLines = group.text.split('\n');
        if (lastEditedLine === -1) {
            lastEditedLine = Math.max(lastEditedLine, group.startLine + groupLines.length - 1);
            lastEditedPosition = Math.max(lastEditedPosition, groupLines[groupLines.length - 1].length);

            if (group.type == 'change') {
                const orgLastLineText = editor.document.lineAt(group.endLine);
                const newlastLineText = groupLines[groupLines.length - 1];
                const diffSegments = computeCharDiff(orgLastLineText.text, newlastLineText);
                for (const seg of diffSegments) {
                    if (seg.type === 'delete') {
                        lastEditedPosition = seg.newIdx;
                    }
                    else if (seg.type === 'add') {
                        lastEditedPosition = seg.newIdx + seg.text.length;
                    }
                }
            }
        }

        // If cut off midway, only first line
        if (! isFullAccept || !mergedData.isStopped) {
            if (1 < groupedEdits.length) {
                //hasUnappliedSuggestion = true;
            }
            break;
        }
    }
    
    try {
        // Pre-check document state
        if (editor.document.isClosed) {
            logError("Cannot apply edit: document is closed");
            return;
        }
        
        // Add debug information
        logDebug(`Applying edit for ${mergedData.edits.size} suggestions`);
        logDebug(`Document URI: ${docUri.toString()}`);
        logDebug(`Document is dirty: ${editor.document.isDirty}`);
        logDebug(`Document is closed: ${editor.document.isClosed}`);
        
        // Detailed edit content log
        for (const edit of wsEdit.entries()) {
            logDebug(`Edit: ${edit[0].toString()} - ${edit[1].length} changes`);
            for (const change of edit[1]) {
                logDebug(`  Range: ${change.range.start.line}:${change.range.start.character} - ${change.range.end.line}:${change.range.end.character}`);
                logDebug(`  Text: "${change.newText}"`);
                
                // Range validity check
                const doc = editor.document;
                if (doc.lineCount <= change.range.start.line || doc.lineCount <= change.range.end.line) {
                    logError(`  INVALID RANGE: Line count is ${doc.lineCount}, but range goes to line ${Math.max(change.range.start.line, change.range.end.line)}`);
                }
                
                // Log current line content
                if (change.range.start.line < doc.lineCount) {
                    const currentLine = doc.lineAt(change.range.start.line).text;
                    logDebug(`  Current line content: "${currentLine}"`);
                }
            }
        }
        
        isAcceptingSuggestionFlag = true;
        const success = await vscode.workspace.applyEdit(wsEdit);
        if (!success) {
            logError("applyEdit failed but no exception was thrown.");
            // Add detailed information on failure
            logError(`Document state: ${JSON.stringify({
                isDirty: editor.document.isDirty,
                isClosed: editor.document.isClosed,
                lineCount: editor.document.lineCount,
                uri: editor.document.uri.toString()
            })}`);
        } else {
            logInfo("applyEdit succeeded");
            
            // Log state after edit application
            logDebug(`Document line count after edit: ${editor.document.lineCount}`);
            logDebug(`Last edited line: ${lastEditedLine}`);
            
            // Log area around edited region
            if (0 <= lastEditedLine) {
                const contextLines = 3;
                const startLogLine = Math.max(0, lastEditedLine - contextLines);
                const endLogLine = Math.min(editor.document.lineCount - 1, lastEditedLine + contextLines);
                
                logDebug("Document content after edit:");
                for (let i = startLogLine; i <= endLogLine; i++) {
                    const lineText = editor.document.lineAt(i).text;
                    const marker = i === lastEditedLine ? ">>> " : "    ";
                    logDebug(`${marker}Line ${i}: "${lineText}"`);
                }
            }
        }
    } catch (error) {
        logError(`applyEdit threw an exception: ${error}`);
        // Add detailed error information
        logError(`Error details: ${JSON.stringify({
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            documentState: {
                isDirty: editor.document.isDirty,
                isClosed: editor.document.isClosed,
                lineCount: editor.document.lineCount
            }
        })}`);
    }

    if (!hasUnappliedSuggestion) {
        clearSuggestions(docUri);
    }
    
    // Move cursor to position where edit difference exists
    if (0 <= lastEditedLine) {
        const newEditor = vscode.window.activeTextEditor;
        if (newEditor && newEditor.document.uri.toString() === docUri.toString()) {
            const targetPosition = 0 <= lastEditedPosition
                ? new vscode.Position(lastEditedLine, lastEditedPosition)
                : new vscode.Position(lastEditedLine, 0);
            newEditor.selection = new vscode.Selection(targetPosition, targetPosition);
            newEditor.revealRange(new vscode.Range(targetPosition, targetPosition), vscode.TextEditorRevealType.Default);
        }
    }

    if (!hasUnappliedSuggestion) {
        await renderSuggestions(editor);
    }
    else{
        await reRenderSuggestions(editor, 1);
    }
    
    vscode.window.setStatusBarMessage('Suggestions applied', 1500);

    return true;
}
