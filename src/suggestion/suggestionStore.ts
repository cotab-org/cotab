import * as vscode from 'vscode';
import { LineDiff } from '../diff/lineDiffUtils';
import { clearAcceptingSuggestion } from './suggestionCommands';

export interface LineEdit {
	line: number;
	newText: string;
	type: 'add' | 'delete' | 'change';
	
	editedLine?: number;
}

export interface SuggestionData {
	originalDiffOperations: LineDiff[];
	edits: LineEdit[];
	checkCompleteLine: number;
	isStopped: boolean;
	isDispOverwrite: boolean;
	isNoHighligh: boolean;
	isForceOverlay: boolean;
	isNoItalic: boolean;
}

export interface MergedSuggestionData {
	originalDiffOperations: LineDiff[];
	edits: Map<number, LineEdit[]>;
	checkCompleteLine: number;
	isStopped: boolean;
	isDispOverwrite: boolean;
	isNoHighligh: boolean;
	isForceOverlay: boolean;
	isNoItalic: boolean;
}

const store = new Map<string, SuggestionData>();

const defaultSuggestionData: SuggestionData = {
	originalDiffOperations: [],
	edits: [],
	checkCompleteLine: -1,
	isStopped: false,
	isDispOverwrite: false,
	isNoHighligh: false,
	isForceOverlay: false,
	isNoItalic: false,
};

function toKey(uri: vscode.Uri | string): string {
	return typeof uri === 'string' ? uri : uri.toString();
}

export function setSuggestions(uri: vscode.Uri | string, data: SuggestionData): void {
	store.set(toKey(uri), data);
}

export function getSuggestions(uri: vscode.Uri | string): SuggestionData {
	return store.get(toKey(uri)) ?? defaultSuggestionData;
}

export function getMergedSuggestions(uri: vscode.Uri | string, isFullAccept: boolean): MergedSuggestionData {
	// Group edits for the same line
	const lineGroups = new Map<number, LineEdit[]>();

	const data = getSuggestions(uri);
	for (const s of data.edits) {
		if (!lineGroups.has(s.line)) {
			lineGroups.set(s.line, []);
		}
		lineGroups.get(s.line)!.push(s);

		// accept only first line
		if (!isFullAccept || ! data.isStopped) {
			break;
		}
	}

	return {
		originalDiffOperations: data.originalDiffOperations,
		edits: lineGroups,
		checkCompleteLine: data.checkCompleteLine,
		isStopped: data.isStopped,
		isDispOverwrite: data.isDispOverwrite,
		isNoHighligh: data.isNoHighligh,
		isForceOverlay: data.isForceOverlay,
		isNoItalic: data.isNoItalic,
	};
}

export function clearSuggestions(uri: vscode.Uri | string) {
	clearAcceptingSuggestion();
	
	const key = toKey(uri);
	
	// Do nothing if suggestions don't exist (suppresses unnecessary event chains)
	if (!store.has(key)) {
		return;
	}
	
	store.delete(key);
	//logDebug('******************* clearSuggestions');
}
