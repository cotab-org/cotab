import * as vscode from 'vscode';
import { setSuggestions, clearSuggestions, SuggestionData } from './suggestionStore';
import { renderSuggestions, clearAllDecorations } from './suggestionRenderer';

/**
 * Updates suggestions and decorations, and returns whether completion of the cursor line is finished.
 */
export function updateSuggestionsAndDecorations(
    documentUri: vscode.Uri,
	suggestionData: SuggestionData,
): { isCompletedFirstLine: boolean, inlineCompletionItems: vscode.InlineCompletionItem[]} {
    const activeEditor = vscode.window.activeTextEditor;

	if (!suggestionData.edits.length) {
		clearSuggestions(documentUri);
        if (activeEditor && activeEditor.document.uri.toString() === documentUri.toString()) {
			clearAllDecorations(activeEditor);
		}
		return {isCompletedFirstLine:false, inlineCompletionItems:[]};
	}
    
	setSuggestions(documentUri, suggestionData);

    let isCompletedFirstLine = false;
	let inlineCompletionItems: vscode.InlineCompletionItem[] = [];
    if (activeEditor && activeEditor.document.uri.toString() === documentUri.toString()) {
        const { inlineCompletionItems: items, isCompletedFirstLine: isFirst } = renderSuggestions(activeEditor);
		isCompletedFirstLine = isFirst;
        if (items.length) {
            inlineCompletionItems = items;
        }
    }
    return {isCompletedFirstLine: isCompletedFirstLine, inlineCompletionItems};
}

// Function to calculate character display width (tab stop aware version)
export function getVisualWidth(text: string, tabSize: number, startColumn: number): {newText: string, width: number} {
	let width = 0;
	let column = startColumn;
	let newText = "";
	for (const char of text) {
		if (char === '\t') {
			const spacesToNextTab = tabSize - (column % tabSize);
			width += spacesToNextTab;
			column += spacesToNextTab;
			newText += '\u00A0'.repeat(spacesToNextTab);
		} else if (
			0xFF < char.charCodeAt(0) ||
			(0x3040 <= char.charCodeAt(0) && char.charCodeAt(0) <= 0x309F) || // Hiragana
			(0x30A0 <= char.charCodeAt(0) && char.charCodeAt(0) <= 0x30FF) || // Katakana
			(0x4E00 <= char.charCodeAt(0) && char.charCodeAt(0) <= 0x9FFF)    // Kanji
		) {
			width += 2;
			column += 2;
			newText += char;
		} else {
			width += 1;
			column += 1;
			newText += char;
		}
	}
	return {newText, width};	
}
