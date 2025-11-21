import * as vscode from 'vscode';
import path from 'path';
import { getConfig } from './config';
import { largeFileManager } from '../managers/largeFileManager';

export interface EditorDocumentText {
	fullText: string;	// Full document text
	trancatedTop: string;	// Truncated top part of document text
	trancatedCursor: string;	// Truncated cursor context text
	position: vscode.Position;
	trancationDocumentTextLen: number;
	trancationPositionStart: number;
}

export interface EditorContext {
	filePath: string;	// fullpath
	fileName: string;	// only filename
	relativePath: string;	// relative path from workspace
	documentUri: string;	// document uri
	languageId: string;	// language id
	version: number;	// document version
	document: vscode.TextDocument; // Reference to the original text document for context and diagnostics
	documentText: EditorDocumentText;	// document text
	aroundFromLine: number;	// Number of lines to retrieve before cursor position (LLM inference target range)\n Recommended: 0 (Setting to 0 makes LLM output start from cursor line to stabilize completion)
	aroundToLine: number;		// End line of surrounding code
	aroundMergeToLine: number;	// End line of surrounding code used during merge (edit target range)\nRecommended: cotab.aroundAfterLines + LLM output lines (~10) + about 5 lines
	aroundCacheFromLine: number;	// Start line of surrounding code for cache utilization.\nIf cursor position doesn't exceed this line, source code in User Prompt won't be updated, enabling effective Prompt Cache usage.
	aroundCacheToLine: number;	// End line of surrounding code for cache utilization.\nIf cursor position doesn't exceed this line, source code in User Prompt won't be updated, enabling effective Prompt Cache usage.
	aroundLatestAddBeforeLines: number;
	aroundLatestAddAfterLines: number;
	cursorLine: number;    // Cursor line number (0-based)
	cursorCharacter: number; // Cursor character position (0-based)
	isTrancatedCode(): boolean;	// Code truncated for length
	getSurroundingCodeBlocks(): {
		sourceCode: string[];
		trancatedSourceCode: string[];
		sourceCodeStartLine: number;
		sourceCodeValidLen: number;
		latestBeforeOutsideLines: string[];
		latestAroundSnippetLines: string[];
		latestAfterOutsideLines: string[];
		latestFirstLineCode: string;
	};
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
			document: document,
			documentText: largeFileManager.getDocumentText(document, position),
			aroundFromLine: toLine(-config.aroundBeforeLines),
			aroundToLine: toLine(config.aroundAfterLines),
			aroundMergeToLine: toLine(config.aroundMergeAfterLines),
			aroundCacheFromLine: toLine(-config.aroundCacheBeforeLines),
			aroundCacheToLine: toLine(config.aroundCacheAfterLines),
			aroundLatestAddBeforeLines: config.aroundLatestAddBeforeLines,
			aroundLatestAddAfterLines: config.aroundLatestAddAfterLines,
			cursorLine: position.line,
			cursorCharacter: position.character,
			isTrancatedCode(): boolean {
				return 0 < this.documentText.trancationDocumentTextLen;
			},
			getSurroundingCodeBlocks(): {
				sourceCode: string[];
				trancatedSourceCode: string[];
				sourceCodeStartLine: number;
				sourceCodeValidLen: number;
				latestBeforeOutsideLines: string[];
				latestAroundSnippetLines: string[];
				latestAfterOutsideLines: string[];
				latestFirstLineCode: string;
			} {
				const sourceCode = this.documentText.fullText.split('\n');
				const trancatedSourceCode = this.documentText.trancatedCursor.split('\n');
				let latestFirstLineCode = '';
				for(let i = 0; i < 5; i++) {
					latestFirstLineCode = sourceCode[Math.min(this.cursorLine + i, sourceCode.length - 1)].trim();
					if (latestFirstLineCode !== '') {
						break;
					}
				}
				return {
					sourceCode,
					trancatedSourceCode,
					sourceCodeStartLine: this.documentText.trancationPositionStart,
					sourceCodeValidLen: this.documentText.trancationDocumentTextLen,
					latestBeforeOutsideLines: sourceCode.slice(0, this.aroundFromLine),
					latestAroundSnippetLines: sourceCode.slice(this.aroundFromLine, this.aroundToLine),
					latestAfterOutsideLines: sourceCode.slice(this.aroundToLine),
					latestFirstLineCode,
				};
			}
		};
	} catch {
		return null;
	}
}



