import * as vscode from 'vscode';
import { getConfig } from './config';
import path from 'path';

export interface EditorContext {
	filePath: string;	// fullpath
	fileName: string;	// only filename
	relativePath: string;	// relative path from workspace
	documentUri: string;	// document uri
	languageId: string;	// language id
	version: number;	// document version
	documentText: string;	// document full text
	aroundFromLine: number;	// Number of lines to retrieve before cursor position (LLM inference target range)\n Recommended: 0 (Setting to 0 makes LLM output start from cursor line to stabilize completion)
	aroundToLine: number;		// End line of surrounding code
	aroundMergeToLine: number;	// End line of surrounding code used during merge (edit target range)\nRecommended: cotab.aroundAfterLines + LLM output lines (~10) + about 5 lines
	aroundCacheFromLine: number;	// Start line of surrounding code for cache utilization.\nIf cursor position doesn't exceed this line, source code in User Prompt won't be updated, enabling effective Prompt Cache usage.
	aroundCacheToLine: number;	// End line of surrounding code for cache utilization.\nIf cursor position doesn't exceed this line, source code in User Prompt won't be updated, enabling effective Prompt Cache usage.
	cursorLine: number;    // Cursor line number (0-based)
	cursorCharacter: number; // Cursor character position (0-based)
}

export function getEditorContext(
	document: vscode.TextDocument,
	position: vscode.Position
): EditorContext | null {
	const toLine = (offset: number) => {
		return Math.max(0, Math.min(document.lineCount - 1, position.line + offset));
	};
	
	try {
		const config = getConfig();

		return {
			filePath: document.uri.fsPath,
			fileName: path.basename(document.uri.fsPath),
			relativePath: vscode.workspace.asRelativePath(document.uri),
			documentUri: document.uri.toString(),
			languageId: document.languageId,
			version: document.version,
			documentText: document.getText().replace(/\r\n/g, '\n').replace(/\r/g, '\n'),
			aroundFromLine: toLine(-config.aroundBeforeLines),
			aroundToLine: toLine(config.aroundAfterLines),
			aroundMergeToLine: toLine(config.aroundMergeAfterLines),
			aroundCacheFromLine: toLine(-config.aroundCacheBeforeLines),
			aroundCacheToLine: toLine(config.aroundCacheAfterLines),
			cursorLine: position.line,
			cursorCharacter: position.character,
		};
	} catch {
		return null;
	}
}



